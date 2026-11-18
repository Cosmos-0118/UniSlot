using System.Numerics;

namespace UniSlot.Solver;

/// <summary>A localisable finding: <see cref="Code"/> is a stable key, <see cref="Args"/> its numeric parameters.</summary>
public readonly record struct Insight(string Code, IReadOnlyList<int> Args);

public sealed record LowerBoundReport(
    int MaxCliqueSize,
    int AvailableColors,
    int MinRedStudents,
    int MinClashWeight,
    bool ZeroClashImpossible,
    bool ZeroRedImpossible,
    IReadOnlyList<int[]> CliqueCuts,
    IReadOnlyList<Insight> Insights);

/// <summary>
/// Structural lower bounds that hold for every timetable: student pigeonhole (more courses than usable evenings) and
/// clique pigeonhole (a group of mutually conflicting courses larger than the number of weekdays). They are valid bounds,
/// not solver claims, and are what a proof stage tries to close the gap to.
/// </summary>
public static class LowerBounds
{
    private const int CoreSize = 64;
    private const int CoreNodeBudget = 5000;

    public static LowerBoundReport Compute(SchedulingProblem pr)
    {
        ArgumentNullException.ThrowIfNull(pr);
        int n = pr.CourseCount;
        int colors = pr.WeekdayCount;
        const int restrictedColors = 5;
        var insights = new List<Insight>();

        var graph = new Graph(pr);
        int[] greedy = graph.GreedyMaxClique(graph.AllNodes, 48);
        var core = graph.ExactCliqueOnCore(CoreSize, CoreNodeBudget, graph.AllNodes, out bool exhausted);
        int[] maxClique = core.Length >= greedy.Length ? core : greedy;
        int maxCliqueSize = maxClique.Length > 0 ? maxClique.Length : (pr.EdgeCount > 0 ? 1 : 0);
        if (exhausted) insights.Add(new Insight("clique.budget", []));
        if (maxCliqueSize > colors) insights.Add(new Insight("clique.exceeds", [maxCliqueSize, colors]));
        else if (maxCliqueSize > 0) insights.Add(new Insight("clique.largest", [maxCliqueSize]));

        int minRed = StudentPigeonhole(pr);
        if (minRed > 0) insights.Add(new Insight("red.pigeonhole", [minRed]));

        // Courses that cannot use Saturday only have five evenings.
        int[] restrictedNodes = Enumerable.Range(0, n).Where(c => !pr.IsSaturdayEligible(c)).ToArray();
        int restrictedClique = 0;
        int[] restrictedCliqueNodes = [];
        if (restrictedNodes.Length > 0)
        {
            var mask = graph.MaskOf(restrictedNodes);
            int[] g = graph.GreedyMaxClique(mask, 32);
            int[] e = graph.ExactCliqueOnCore(48, CoreNodeBudget, mask, out _);
            restrictedCliqueNodes = e.Length >= g.Length ? e : g;
            restrictedClique = restrictedCliqueNodes.Length;
            if (restrictedClique > restrictedColors) insights.Add(new Insight("clique.restricted.exceeds", [restrictedClique, restrictedColors]));
        }

        int weightedPacking = 0;
        foreach (var comp in graph.Components())
            weightedPacking += graph.ComponentWeightedLb(comp, colors, 24);
        int single = graph.WeightedCliqueLb(maxClique, colors);
        int restrictedWeighted = graph.WeightedCliqueLb(restrictedCliqueNodes, restrictedColors);
        int unit = Math.Max(MinMonochromePairs(maxCliqueSize, colors), MinMonochromePairs(restrictedClique, restrictedColors));
        int clashLb = Math.Max(Math.Max(unit, single), Math.Max(restrictedWeighted, weightedPacking));
        if (clashLb > unit) insights.Add(new Insight("clash.weighted", [clashLb, unit]));

        bool zeroClash = maxCliqueSize > colors || restrictedClique > restrictedColors || clashLb > 0;
        var cuts = new List<int[]>();
        foreach (var c in new[] { maxClique, restrictedCliqueNodes })
        {
            if (c.Length < 2) continue;
            var sorted = c.OrderBy(x => x).ToArray();
            if (!cuts.Any(o => o.SequenceEqual(sorted))) cuts.Add(sorted);
        }

        return new LowerBoundReport(Math.Max(maxCliqueSize, restrictedClique), colors, minRed, clashLb, zeroClash, minRed > 0 || zeroClash, cuts, insights);
    }

    /// <summary>Minimum number of same-colour pairs when <paramref name="n"/> mutually conflicting vertices use <paramref name="k"/> colours.</summary>
    public static int MinMonochromePairs(int n, int k)
    {
        if (n <= 0 || k <= 0 || n <= k) return 0;
        int baseSize = n / k, rem = n % k, large = baseSize + 1;
        return rem * (large * (large - 1) / 2) + (k - rem) * (baseSize * (baseSize - 1) / 2);
    }

    private static int StudentPigeonhole(SchedulingProblem pr)
    {
        int count = 0;
        bool saturdayOpen = pr.WeekdayCount == 6;
        const int weekdaysWithoutSaturday = 5;
        for (int s = 0; s < pr.StudentCount; s++)
        {
            var courses = pr.StudentCourses(s);
            int feasible;
            if (!saturdayOpen)
            {
                feasible = Math.Min(courses.Length, weekdaysWithoutSaturday);
            }
            else
            {
                int restricted = 0, eligible = 0;
                foreach (int c in courses) { if (pr.IsSaturdayEligible(c)) eligible++; else restricted++; }
                int r = Math.Min(restricted, weekdaysWithoutSaturday);
                feasible = r + Math.Min(eligible, pr.WeekdayCount - r);
            }
            if (courses.Length > feasible) count++;
        }
        return count;
    }

    /// <summary>Bitset adjacency over the course conflict graph with the clique routines the bounds need.</summary>
    private sealed class Graph
    {
        private readonly int _n;
        private readonly int _words;
        private readonly ulong[][] _adj;
        private readonly int[] _degree;
        private readonly Dictionary<long, int> _weights = new();

        public Graph(SchedulingProblem pr)
        {
            _n = pr.CourseCount;
            _words = (_n + 63) >> 6;
            _adj = new ulong[_n][];
            for (int i = 0; i < _n; i++) _adj[i] = new ulong[_words];
            _degree = new int[_n];
            var a = pr.EdgeA; var b = pr.EdgeB; var w = pr.EdgeWeights;
            for (int e = 0; e < a.Length; e++)
            {
                _adj[a[e]][b[e] >> 6] |= 1UL << (b[e] & 63);
                _adj[b[e]][a[e] >> 6] |= 1UL << (a[e] & 63);
                _degree[a[e]]++; _degree[b[e]]++;
                _weights[Key(a[e], b[e])] = w[e];
            }
            AllNodes = new ulong[_words];
            for (int i = 0; i < _n; i++)
                if (_degree[i] > 0) AllNodes[i >> 6] |= 1UL << (i & 63);
        }

        public ulong[] AllNodes { get; }

        public ulong[] MaskOf(IEnumerable<int> nodes)
        {
            var m = new ulong[_words];
            foreach (int v in nodes) if (_degree[v] > 0) m[v >> 6] |= 1UL << (v & 63);
            return m;
        }

        private static long Key(int a, int b) => a < b ? ((long)a << 32) | (uint)b : ((long)b << 32) | (uint)a;
        private int Weight(int a, int b) => _weights.TryGetValue(Key(a, b), out int w) ? w : 0;

        private IEnumerable<int> Members(ulong[] set)
        {
            for (int w = 0; w < _words; w++)
            {
                ulong x = set[w];
                while (x != 0)
                {
                    int bit = BitOperations.TrailingZeroCount(x);
                    yield return (w << 6) + bit;
                    x &= x - 1;
                }
            }
        }

        private int AndCount(ulong[] a, ulong[] b)
        {
            int c = 0;
            for (int w = 0; w < _words; w++) c += BitOperations.PopCount(a[w] & b[w]);
            return c;
        }

        private int[] NodesByDegreeDescending(ulong[] nodes) =>
            Members(nodes).OrderByDescending(v => _degree[v]).ThenBy(v => v).ToArray();

        public int[] GreedyMaxClique(ulong[] nodes, int starts)
        {
            int[] ranked = NodesByDegreeDescending(nodes);
            if (ranked.Length == 0) return [];
            int[] best = [ranked[0]];
            for (int i = 0; i < Math.Min(starts, ranked.Length); i++)
            {
                int[] clique = GreedyFrom(nodes, ranked[i]);
                if (clique.Length > best.Length) best = clique;
            }
            return best;
        }

        private int[] GreedyFrom(ulong[] nodes, int start)
        {
            var clique = new List<int> { start };
            var cand = new ulong[_words];
            for (int w = 0; w < _words; w++) cand[w] = _adj[start][w] & nodes[w];
            while (true)
            {
                int pick = -1, pickShared = -1, pickDegree = -1;
                foreach (int v in Members(cand))
                {
                    int shared = AndCount(cand, _adj[v]);
                    if (shared > pickShared || (shared == pickShared && _degree[v] > pickDegree))
                    {
                        pick = v; pickShared = shared; pickDegree = _degree[v];
                    }
                }
                if (pick < 0) break;
                clique.Add(pick);
                for (int w = 0; w < _words; w++) cand[w] &= _adj[pick][w];
            }
            return [.. clique];
        }

        /// <summary>Bron–Kerbosch with pivoting on the highest-degree nodes (≤ 64). Valid cliques even if the budget runs out.</summary>
        public int[] ExactCliqueOnCore(int maxNodes, int nodeBudget, ulong[] nodes, out bool budgetExhausted)
        {
            int[] core = NodesByDegreeDescending(nodes).Take(Math.Min(maxNodes, CoreSize)).ToArray();
            int m = core.Length;
            var local = new ulong[m];
            for (int i = 0; i < m; i++)
                for (int j = 0; j < m; j++)
                    if (i != j && (_adj[core[i]][core[j] >> 6] >> (core[j] & 63) & 1UL) != 0) local[i] |= 1UL << j;

            ulong best = 0;
            int bestSize = 0, visited = 0;
            bool exhausted = false;

            void Recurse(ulong r, int rSize, ulong p, ulong x)
            {
                if (visited >= nodeBudget) { exhausted = true; return; }
                visited++;
                if (rSize > bestSize) { bestSize = rSize; best = r; }
                if (p == 0 && x == 0) return;
                if (rSize + BitOperations.PopCount(p) <= bestSize) return;
                int pivot = -1, pivotDeg = -1;
                ulong px = p | x;
                while (px != 0)
                {
                    int u = BitOperations.TrailingZeroCount(px);
                    px &= px - 1;
                    int d = BitOperations.PopCount(local[u] & p);
                    if (d > pivotDeg) { pivotDeg = d; pivot = u; }
                }
                ulong candidates = p & ~(pivot >= 0 ? local[pivot] : 0UL);
                while (candidates != 0 && !exhausted)
                {
                    int v = BitOperations.TrailingZeroCount(candidates);
                    candidates &= candidates - 1;
                    Recurse(r | (1UL << v), rSize + 1, p & local[v], x & local[v]);
                    p &= ~(1UL << v);
                    x |= 1UL << v;
                }
            }

            ulong all = m == 64 ? ulong.MaxValue : (1UL << m) - 1;
            Recurse(0, 0, all, 0);
            budgetExhausted = exhausted;
            var result = new List<int>();
            for (int i = 0; i < m; i++) if ((best >> i & 1UL) != 0) result.Add(core[i]);
            return [.. result];
        }

        public int WeightedCliqueLb(int[] clique, int colors)
        {
            int pairs = MinMonochromePairs(clique.Length, colors);
            if (pairs <= 0) return 0;
            var ws = new List<int>();
            for (int i = 0; i < clique.Length; i++)
                for (int j = i + 1; j < clique.Length; j++)
                {
                    int w = Weight(clique[i], clique[j]);
                    if (w > 0) ws.Add(w);
                }
            if (ws.Count < pairs) return pairs;
            ws.Sort();
            int sum = 0;
            for (int i = 0; i < pairs; i++) sum += ws[i];
            return sum;
        }

        public List<ulong[]> Components()
        {
            var seen = new bool[_n];
            var comps = new List<ulong[]>();
            for (int s = 0; s < _n; s++)
            {
                if (seen[s] || _degree[s] == 0) continue;
                var comp = new ulong[_words];
                var stack = new Stack<int>();
                stack.Push(s); seen[s] = true;
                while (stack.Count > 0)
                {
                    int u = stack.Pop();
                    comp[u >> 6] |= 1UL << (u & 63);
                    foreach (int v in Members(_adj[u]))
                        if (!seen[v]) { seen[v] = true; stack.Push(v); }
                }
                comps.Add(comp);
            }
            return comps;
        }

        public int ComponentWeightedLb(ulong[] component, int colors, int starts)
        {
            int[] ranked = NodesByDegreeDescending(component);
            int best = 0, packed = 0;
            var used = new HashSet<long>();
            for (int i = 0; i < Math.Min(starts, ranked.Length); i++)
            {
                int[] clique = GreedyFrom(component, ranked[i]);
                int lb = WeightedCliqueLb(clique, colors);
                best = Math.Max(best, lb);
                var edges = new List<long>();
                bool ok = true;
                for (int a = 0; a < clique.Length && ok; a++)
                    for (int b = a + 1; b < clique.Length; b++)
                    {
                        if (Weight(clique[a], clique[b]) <= 0) continue;
                        long key = Key(clique[a], clique[b]);
                        if (used.Contains(key)) { ok = false; break; }
                        edges.Add(key);
                    }
                if (ok && edges.Count > 0 && lb > 0)
                {
                    packed += lb;
                    foreach (long e in edges) used.Add(e);
                }
            }
            return Math.Max(best, packed);
        }
    }
}
