using System.Diagnostics;

namespace UniSlot.Solver;

internal sealed class ChainProgress
{
    public long Moves;
    public int BestRed = int.MaxValue;
    public int BestClash = int.MaxValue;
}

internal sealed record ChainOutcome(
    byte[] Day,
    Evaluation Evaluation,
    long Moves,
    long Accepted,
    long WorseRedAccepted,
    long WorseRedAcceptedWhileFrozen,
    int VerifyChecks,
    int VerifyMismatches,
    List<TracePoint> Trace);

/// <summary>
/// One simulated-annealing chain over the course→weekday colouring.
/// <para>Stage A anneals RED students (clash is consulted only when RED is unchanged). Stage B restores the best state, freezes RED and anneals
/// clash weight. Stage C freezes both and anneals weekday balance then parallel excess. A RED-worsening move is therefore never accepted
/// because of anything other than the RED delta, and never accepted at all once RED is frozen.</para>
/// </summary>
internal static class ChainRunner
{
    private const int MaxTrace = 512;

    internal static ChainOutcome Run(
        SchedulingProblem pr,
        AnnealingSchedule sc,
        ulong seed,
        long moveBudget,
        double millisecondBudget,
        int verifyEvery,
        ChainProgress progress,
        CancellationToken ct)
    {
        int n = pr.CourseCount, wd = pr.WeekdayCount, ns = pr.StudentCount, ng = pr.GroupCount;
        int total = pr.TotalSections, preferred = pr.PreferredParallel;
        int[] adjStart = pr.AdjStart, adjN = pr.AdjNeighbor, adjW = pr.AdjWeight;
        int[] csStart = pr.CourseStudentStart, csList = pr.CourseStudentList;
        int[] cgStart = pr.CourseGroupStart, cgList = pr.CourseGroupList;
        int[] movable = pr.Movable;
        int nm = movable.Length;

        var allowed = new int[n];
        var fixedDay = new int[n];
        var sections = new int[n];
        for (int c = 0; c < n; c++)
        {
            allowed[c] = pr.AllowedDays(c);
            fixedDay[c] = pr.FixedDay(c);
            sections[c] = pr.SectionCount(c);
        }

        var rng = new Xoshiro256(seed);
        var day = new byte[n];
        var cnt = new byte[Math.Max(1, ns * wd)];
        var multi = new byte[Math.Max(1, ns)];
        var gcnt = new byte[Math.Max(1, ng * wd)];
        var loads = new int[wd];
        var bestDay = new byte[n];

        // Constructive, faculty-aware random start.
        var order = new int[n];
        for (int i = 0; i < n; i++) order[i] = i;
        for (int i = n - 1; i > 0; i--)
        {
            int j = rng.Below(i + 1);
            (order[i], order[j]) = (order[j], order[i]);
        }
        foreach (int c in order)
        {
            int d = fixedDay[c];
            if (d < 0)
            {
                for (int tries = 0; tries < 20 && d < 0; tries++)
                {
                    int cand = rng.Below(allowed[c]);
                    bool free = true;
                    for (int i = cgStart[c]; i < cgStart[c + 1]; i++)
                        if (gcnt[cgList[i] * wd + cand] != 0) { free = false; break; }
                    if (free) d = cand;
                }
                if (d < 0) d = rng.Below(allowed[c]);
            }
            day[c] = (byte)d;
            for (int i = cgStart[c]; i < cgStart[c + 1]; i++) gcnt[cgList[i] * wd + d]++;
        }

        Rebuild(pr, day, cnt, multi, gcnt, loads, out int red, out int clash, out int bal, out int exc);
        Buffer.BlockCopy(day, 0, bestDay, 0, n);
        int bestRed = red, bestClash = clash, bestBal = bal, bestExc = exc;

        var trace = new List<TracePoint>(64) { new(0, red, clash) };
        long moves = 0, accepted = 0, worseRed = 0, worseRedFrozen = 0;
        int verifyChecks = 0, verifyMismatches = 0;
        int stage = 0;
        double tRed = sc.RedStart, tClash = sc.ClashStart, tBal = sc.BalanceStart, tExc = sc.ExcessStart;
        bool useMoves = millisecondBudget <= 0;
        var clock = Stopwatch.StartNew();
        long sinceCheck = 0;

        if (nm == 0)
        {
            return Finish(pr, bestDay, 0, 0, 0, 0, 0, 0, trace);
        }

        while (true)
        {
            if ((moves & 4095) == 0)
            {
                if (ct.IsCancellationRequested) break;
                double f;
                if (useMoves)
                {
                    if (moves >= moveBudget) break;
                    f = (double)moves / moveBudget;
                }
                else
                {
                    double el = clock.Elapsed.TotalMilliseconds;
                    if (el >= millisecondBudget) break;
                    f = el / millisecondBudget;
                }

                int ns2 = f < sc.StageA ? 0 : f < sc.StageB ? 1 : 2;
                if (ns2 != stage)
                {
                    // Move on from the best state found so far, with the previous level frozen.
                    stage = ns2;
                    Buffer.BlockCopy(bestDay, 0, day, 0, n);
                    Rebuild(pr, day, cnt, multi, gcnt, loads, out red, out clash, out bal, out exc);
                    if (stage == 2) { bestBal = bal; bestExc = exc; }
                }

                if (stage == 0)
                {
                    double g = f / sc.StageA;
                    tRed = Geometric(sc.RedStart, sc.RedEnd, g);
                    tClash = Geometric(sc.ClashStart, sc.ClashEnd, g);
                }
                else if (stage == 1)
                {
                    tClash = Geometric(sc.ClashStageBStart, sc.ClashStageBEnd, (f - sc.StageA) / (sc.StageB - sc.StageA));
                }
                else
                {
                    double g = (f - sc.StageB) / (1.0 - sc.StageB);
                    tBal = Geometric(sc.BalanceStart, sc.BalanceEnd, g);
                    tExc = Geometric(sc.ExcessStart, sc.ExcessEnd, g);
                }

                Volatile.Write(ref progress.Moves, moves);
                Volatile.Write(ref progress.BestRed, bestRed);
                Volatile.Write(ref progress.BestClash, bestClash);
            }

            moves++;
            uint r1 = rng.Next32(), r2 = rng.Next32(), r3 = rng.Next32();
            int c0 = movable[(int)(((ulong)r1 * (ulong)nm) >> 32)];
            int old = day[c0];
            int nw = (int)(((ulong)r2 * (ulong)(allowed[c0] - 1)) >> 32);
            if (nw >= old) nw++;

            if (verifyEvery > 0 && ++sinceCheck == verifyEvery)
            {
                sinceCheck = 0;
                var ev = Evaluator.Evaluate(pr, day).Score;
                verifyChecks++;
                if (ev.Red != red || ev.Clash != clash || (stage == 2 && (ev.Balance != bal || ev.Excess != exc)))
                    verifyMismatches++;
            }

            // Hard rule: faculty groups need distinct weekdays.
            bool blocked = false;
            for (int i = cgStart[c0], e = cgStart[c0 + 1]; i < e; i++)
                if (gcnt[cgList[i] * wd + nw] != 0) { blocked = true; break; }
            if (blocked) continue;

            int dclash = 0;
            for (int i = adjStart[c0], e = adjStart[c0 + 1]; i < e; i++)
            {
                int d = day[adjN[i]];
                if (d == nw) dclash += adjW[i];
                else if (d == old) dclash -= adjW[i];
            }

            int dred = 0;
            for (int i = csStart[c0], e = csStart[c0 + 1]; i < e; i++)
            {
                int s = csList[i], b = s * wd;
                int co = cnt[b + old], cn = cnt[b + nw], m = multi[s];
                int m2 = m + (co == 2 ? -1 : 0) + (cn == 1 ? 1 : 0);
                dred += (m2 > 0 ? 1 : 0) - (m > 0 ? 1 : 0);
            }

            int dbal = 0, dexc = 0;
            bool ok;
            if (stage == 0)
            {
                if (dred < 0) ok = true;
                else if (dred > 0) ok = Metropolis(dred / tRed, r3);
                else if (dclash <= 0) ok = true;
                else ok = Metropolis(dclash / tClash, r3);
            }
            else if (stage == 1)
            {
                if (dred > 0) ok = false;
                else if (dred < 0 || dclash <= 0) ok = true;
                else ok = Metropolis(dclash / tClash, r3);
            }
            else
            {
                if (dred > 0) ok = false;
                else if (dred < 0) ok = true;
                else if (dclash > 0) ok = false;
                else if (dclash < 0) ok = true;
                else
                {
                    int sc0 = sections[c0];
                    int lo = loads[old] - sc0, ln = loads[nw] + sc0;
                    dbal = Math.Abs(wd * lo - total) + Math.Abs(wd * ln - total)
                         - Math.Abs(wd * loads[old] - total) - Math.Abs(wd * loads[nw] - total);
                    dexc = Math.Max(0, lo - preferred) + Math.Max(0, ln - preferred)
                         - Math.Max(0, loads[old] - preferred) - Math.Max(0, loads[nw] - preferred);
                    if (dbal < 0) ok = true;
                    else if (dbal > 0) ok = Metropolis(dbal / tBal, r3);
                    else if (dexc <= 0) ok = true;
                    else ok = Metropolis(dexc / tExc, r3);
                }
            }
            if (!ok) continue;

            accepted++;
            if (dred > 0)
            {
                worseRed++;
                if (stage != 0) worseRedFrozen++;
            }

            for (int i = csStart[c0], e = csStart[c0 + 1]; i < e; i++)
            {
                int s = csList[i], b = s * wd;
                int co = cnt[b + old], cn = cnt[b + nw];
                cnt[b + old] = (byte)(co - 1);
                cnt[b + nw] = (byte)(cn + 1);
                if (co == 2) multi[s]--;
                if (cn == 1) multi[s]++;
            }
            for (int i = cgStart[c0], e = cgStart[c0 + 1]; i < e; i++)
            {
                int b = cgList[i] * wd;
                gcnt[b + old]--;
                gcnt[b + nw]++;
            }
            if (stage == 2)
            {
                // dbal/dexc were computed above only when RED and clash were unchanged; recompute for the rare strictly-better case.
                if (dred != 0 || dclash != 0)
                {
                    int sc0 = sections[c0];
                    int lo = loads[old] - sc0, ln = loads[nw] + sc0;
                    dbal = Math.Abs(wd * lo - total) + Math.Abs(wd * ln - total)
                         - Math.Abs(wd * loads[old] - total) - Math.Abs(wd * loads[nw] - total);
                    dexc = Math.Max(0, lo - preferred) + Math.Max(0, ln - preferred)
                         - Math.Max(0, loads[old] - preferred) - Math.Max(0, loads[nw] - preferred);
                }
                bal += dbal;
                exc += dexc;
            }
            loads[old] -= sections[c0];
            loads[nw] += sections[c0];
            day[c0] = (byte)nw;
            red += dred;
            clash += dclash;

            bool primary = red < bestRed || (red == bestRed && clash < bestClash);
            if (primary
                || (stage == 2 && red == bestRed && clash == bestClash && (bal < bestBal || (bal == bestBal && exc < bestExc))))
            {
                bestRed = red; bestClash = clash; bestBal = bal; bestExc = exc;
                Buffer.BlockCopy(day, 0, bestDay, 0, n);
                if (primary && trace.Count < MaxTrace) trace.Add(new TracePoint(moves, red, clash));
            }
        }

        Volatile.Write(ref progress.Moves, moves);
        Volatile.Write(ref progress.BestRed, bestRed);
        Volatile.Write(ref progress.BestClash, bestClash);
        return Finish(pr, bestDay, moves, accepted, worseRed, worseRedFrozen, verifyChecks, verifyMismatches, trace);
    }

    private static ChainOutcome Finish(SchedulingProblem pr, byte[] bestDay, long moves, long accepted, long worseRed, long worseRedFrozen,
        int checks, int mismatches, List<TracePoint> trace)
        => new(bestDay, Evaluator.Evaluate(pr, bestDay), moves, accepted, worseRed, worseRedFrozen, checks, mismatches, trace);

    private static double Geometric(double from, double to, double g)
    {
        if (g <= 0) return from;
        if (g >= 1) return to;
        // from * (to/from)^g without libm, using the deterministic exp and ln.
        return from >= to
            ? from * DeterministicMath.ExpNeg(g * DeterministicLog.Ln(from / to))
            : from / DeterministicMath.ExpNeg(g * DeterministicLog.Ln(to / from));
    }

    private static bool Metropolis(double x, uint u)
    {
        if (x >= 40) return false;
        double p = DeterministicMath.ExpNeg(x);
        return (ulong)u < (ulong)(p * 4294967296.0);
    }

    private static void Rebuild(SchedulingProblem pr, byte[] day, byte[] cnt, byte[] multi, byte[] gcnt, int[] loads,
        out int red, out int clash, out int bal, out int exc)
    {
        int n = pr.CourseCount, wd = pr.WeekdayCount, ns = pr.StudentCount;
        Array.Clear(cnt); Array.Clear(multi); Array.Clear(gcnt); Array.Clear(loads);
        for (int c = 0; c < n; c++)
        {
            int d = day[c];
            loads[d] += pr.SectionCount(c);
            for (int i = pr.CourseGroupStart[c]; i < pr.CourseGroupStart[c + 1]; i++) gcnt[pr.CourseGroupList[i] * wd + d]++;
            for (int i = pr.CourseStudentStart[c]; i < pr.CourseStudentStart[c + 1]; i++) cnt[pr.CourseStudentList[i] * wd + d]++;
        }
        red = 0;
        for (int s = 0; s < ns; s++)
        {
            int m = 0;
            for (int d = 0; d < wd; d++) if (cnt[s * wd + d] >= 2) m++;
            multi[s] = (byte)m;
            if (m > 0) red++;
        }
        clash = 0;
        for (int a = 0; a < n; a++)
            for (int i = pr.AdjStart[a]; i < pr.AdjStart[a + 1]; i++)
            {
                int b = pr.AdjNeighbor[i];
                if (b > a && day[a] == day[b]) clash += pr.AdjWeight[i];
            }
        bal = 0; exc = 0;
        for (int d = 0; d < wd; d++)
        {
            bal += Math.Abs(wd * loads[d] - pr.TotalSections);
            exc += Math.Max(0, loads[d] - pr.PreferredParallel);
        }
    }
}

/// <summary>Natural logarithm from basic IEEE operations only (argument reduction + atanh series).</summary>
internal static class DeterministicLog
{
    private const double Ln2 = 0.6931471805599453;

    public static double Ln(double x)
    {
        if (x <= 0) throw new ArgumentOutOfRangeException(nameof(x));
        int e = 0;
        while (x >= 2) { x *= 0.5; e++; }
        while (x < 1) { x *= 2; e--; }
        // ln(x) = 2·atanh(z), z = (x−1)/(x+1) ∈ [0, 1/3]
        double z = (x - 1) / (x + 1), z2 = z * z, term = z, sum = 0;
        for (int k = 1; k <= 41; k += 2)
        {
            sum += term / k;
            term *= z2;
        }
        return 2 * sum + e * Ln2;
    }
}
