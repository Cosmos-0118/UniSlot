using System.Diagnostics;
using System.Globalization;
using Google.OrTools.Sat;
using UniSlot.Solver;

namespace UniSlot.Proof;

/// <summary>
/// Exact lexicographic stage on OR-Tools CP-SAT, running in-process (no Python). The annealer's schedule is supplied as a hint and as an
/// upper bound, so the solver only has to prove or improve it. Phase 1 minimises RED students; phase 2 minimises clash weight with RED
/// held at its best known value. A result is only called proven when CP-SAT reports OPTIMAL for that phase.
/// </summary>
public sealed class CpSatProver : IOptimalityProver
{
    private const double RedShare = 0.7;

    public static IOptimalityProver Create() => new CpSatProver();

    public string Name => "CP-SAT";

    public Task<ProofResult> ProveAsync(SchedulingProblem problem, byte[] incumbent, Score incumbentScore, ProofOptions options,
        IProgress<ProofProgress>? progress, CancellationToken cancellationToken) =>
        Task.Run(() => Prove(problem, incumbent, incumbentScore, options, progress, cancellationToken), cancellationToken);

    private ProofResult Prove(SchedulingProblem problem, byte[] incumbent, Score incumbentScore, ProofOptions options,
        IProgress<ProofProgress>? progress, CancellationToken ct)
    {
        var clock = Stopwatch.StartNew();
        var bounds = LowerBounds.Compute(problem);
        double? total = options.TimeLimit?.TotalSeconds;

        byte[] best = incumbent;
        Score bestScore = incumbentScore;
        int redLb = bounds.MinRedStudents;
        int? redUb = incumbentScore.Red;
        bool redProven = incumbentScore.Red <= redLb;
        int? clashLb = bounds.MinClashWeight;
        bool clashProven = false;

        // ---- Phase 1: RED students ---------------------------------------------------------------------------------
        if (!redProven)
        {
            double? budget = total * RedShare;
            var r = Solve(problem, bounds, best, mode: Objective.Red, redCap: bestScore.Red, clashCap: null,
                budget, options, progress, clock, total, ct);
            if (r.Assignment is { } a1) Adopt(problem, a1, ref best, ref bestScore);
            redLb = Math.Max(redLb, r.LowerBound);
            redUb = bestScore.Red;
            redProven = r.Optimal || redLb >= bestScore.Red;
            if (redProven) redLb = Math.Max(redLb, bestScore.Red);
        }
        else
        {
            redLb = Math.Max(redLb, bestScore.Red);
        }

        // ---- Phase 2: clash weight with RED held -------------------------------------------------------------------
        double? remaining = total - clock.Elapsed.TotalSeconds;
        if ((remaining is null || remaining > 0.5) && !ct.IsCancellationRequested)
        {
            var r = Solve(problem, bounds, best, mode: Objective.Clash, redCap: bestScore.Red, clashCap: bestScore.Clash,
                remaining, options, progress, clock, total, ct);
            if (r.Assignment is { } a2) Adopt(problem, a2, ref best, ref bestScore);
            clashLb = Math.Max(clashLb ?? 0, r.LowerBound);
            clashProven = redProven && (r.Optimal || clashLb >= bestScore.Clash);
        }

        progress?.Report(new ProofProgress(1.0, redLb, redUb, clock.Elapsed));
        bool improved = bestScore < incumbentScore;
        var status = redProven && clashProven ? ProofStatus.Optimal : ProofStatus.Feasible;
        return new ProofResult(status, redLb, redUb, redProven, clashLb, clashProven, improved ? best : null, improved ? bestScore : null,
            clock.Elapsed, Name);
    }

    private static void Adopt(SchedulingProblem problem, byte[] candidate, ref byte[] best, ref Score bestScore)
    {
        var ev = Evaluator.Evaluate(problem, candidate);
        if (ev.IsFeasible && ev.Score < bestScore)
        {
            best = candidate;
            bestScore = ev.Score;
        }
    }

    private enum Objective { Red, Clash }

    private sealed record PhaseResult(byte[]? Assignment, bool Optimal, int LowerBound);

    private static PhaseResult Solve(SchedulingProblem pr, LowerBoundReport bounds, byte[] hint, Objective mode, int redCap, int? clashCap,
        double? seconds, ProofOptions options, IProgress<ProofProgress>? progress, Stopwatch clock, double? totalSeconds, CancellationToken ct)
    {
        int n = pr.CourseCount, wd = pr.WeekdayCount;
        var model = new CpModel();
        var day = new IntVar[n];
        for (int c = 0; c < n; c++)
        {
            day[c] = model.NewIntVar(0, pr.AllowedDays(c) - 1, $"d{c}");
            if (pr.FixedDay(c) >= 0) model.Add(day[c] == pr.FixedDay(c));
        }
        for (int g = 0; g < pr.GroupCount; g++)
            model.AddAllDifferent([.. pr.GroupCourses(g).ToArray().Select(c => day[c])]);

        // same-weekday indicator per conflicting pair
        int edges = pr.EdgeCount;
        var same = new BoolVar[edges];
        var ea = pr.EdgeA.ToArray(); var eb = pr.EdgeB.ToArray(); var ew = pr.EdgeWeights.ToArray();
        var pairIndex = new Dictionary<long, int>(edges);
        for (int e = 0; e < edges; e++)
        {
            same[e] = model.NewBoolVar($"s{e}");
            model.Add(day[ea[e]] == day[eb[e]]).OnlyEnforceIf(same[e]);
            model.Add(day[ea[e]] != day[eb[e]]).OnlyEnforceIf(same[e].Not());
            pairIndex[((long)ea[e] << 32) | (uint)eb[e]] = e;
        }

        // clique inequalities: a group of k mutually conflicting courses on c colours has at least minMonochromePairs same-day pairs
        foreach (int[] clique in bounds.CliqueCuts)
        {
            bool anySaturday = clique.Any(pr.IsSaturdayEligible);
            int colors = anySaturday ? wd : Math.Min(wd, 5);
            int need = LowerBounds.MinMonochromePairs(clique.Length, colors);
            if (need <= 0) continue;
            var terms = new List<BoolVar>();
            for (int i = 0; i < clique.Length; i++)
                for (int j = i + 1; j < clique.Length; j++)
                {
                    int a = Math.Min(clique[i], clique[j]), b = Math.Max(clique[i], clique[j]);
                    if (pairIndex.TryGetValue(((long)a << 32) | (uint)b, out int e)) terms.Add(same[e]);
                }
            if (terms.Count >= need) model.Add(LinearExpr.Sum(terms.ToArray()) >= need);
        }

        var clash = model.NewIntVar(0, Math.Max(0, (int)Math.Min(int.MaxValue, pr.TotalEdgeWeight)), "clash");
        model.Add(clash == LinearExpr.WeightedSum(same, ew));
        if (bounds.MinClashWeight > 0) model.Add(clash >= Math.Min(bounds.MinClashWeight, (int)pr.TotalEdgeWeight));

        var redFlags = new List<BoolVar>(pr.StudentCount);
        for (int s = 0; s < pr.StudentCount; s++)
        {
            var courses = pr.StudentCourses(s).ToArray();
            var pairs = new List<BoolVar>();
            for (int i = 0; i < courses.Length; i++)
                for (int j = i + 1; j < courses.Length; j++)
                    pairs.Add(same[pairIndex[((long)courses[i] << 32) | (uint)courses[j]]]);
            var red = model.NewBoolVar($"r{s}");
            model.AddBoolOr(pairs.Cast<ILiteral>().ToArray()).OnlyEnforceIf(red);
            foreach (var p in pairs) model.AddImplication(p, red);
            redFlags.Add(red);
        }
        var redTotal = model.NewIntVar(0, redFlags.Count, "red");
        model.Add(redTotal == LinearExpr.Sum(redFlags.ToArray()));
        if (bounds.MinRedStudents > 0) model.Add(redTotal >= Math.Min(bounds.MinRedStudents, redFlags.Count));
        model.Add(redTotal <= redCap);
        if (clashCap is { } cc) model.Add(clash <= cc);

        for (int c = 0; c < n; c++) model.AddHint(day[c], hint[c]);
        if (mode == Objective.Red) model.Minimize(redTotal); else model.Minimize(clash);

        string parameters = string.Create(CultureInfo.InvariantCulture,
            $"num_workers:{Math.Max(1, options.Workers)} random_seed:{options.Seed} log_search_progress:false");
        if (seconds is { } limit) parameters += string.Create(CultureInfo.InvariantCulture, $" max_time_in_seconds:{Math.Max(0.5, limit):0.###}");
        if (mode == Objective.Red) parameters += " optimize_with_core:true";
        var solver = new CpSolver { StringParameters = parameters };
        using var reg = ct.Register(() => solver.StopSearch());
        var callback = new Callback(mode == Objective.Red ? redTotal : clash, progress, clock, totalSeconds);
        var status = solver.Solve(model, callback);

        if (status is CpSolverStatus.Optimal or CpSolverStatus.Feasible)
        {
            var assignment = new byte[n];
            for (int c = 0; c < n; c++) assignment[c] = (byte)solver.Value(day[c]);
            int lb = (int)Math.Ceiling(solver.BestObjectiveBound - 1e-9);
            return new PhaseResult(assignment, status == CpSolverStatus.Optimal, lb);
        }
        return new PhaseResult(null, false, 0);
    }

    private sealed class Callback(IntVar objective, IProgress<ProofProgress>? progress, Stopwatch clock, double? total)
        : CpSolverSolutionCallback
    {
        public override void OnSolutionCallback()
        {
            // Without a time limit there is no meaningful fraction; the interface shows an indeterminate bar instead.
            double f = total is { } t ? Math.Clamp(clock.Elapsed.TotalSeconds / Math.Max(1, t), 0, 1) : 0;
            progress?.Report(new ProofProgress(f, (int)Math.Floor(BestObjectiveBound()), (int)Value(objective), clock.Elapsed));
        }
    }
}
