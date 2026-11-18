namespace UniSlot.Solver;

/// <summary>
/// Lexicographic objective, lower is better at every level, earlier levels strictly dominate later ones:
/// RED students, then clash weight, then weekday balance, then parallel excess.
/// </summary>
public readonly record struct Score(int Red, int Clash, int Balance, int Excess) : IComparable<Score>
{
    public int CompareTo(Score other)
    {
        int c = Red.CompareTo(other.Red);
        if (c != 0) return c;
        c = Clash.CompareTo(other.Clash);
        if (c != 0) return c;
        c = Balance.CompareTo(other.Balance);
        return c != 0 ? c : Excess.CompareTo(other.Excess);
    }

    public bool IsBetterThan(Score other) => CompareTo(other) < 0;

    public static bool operator <(Score a, Score b) => a.CompareTo(b) < 0;
    public static bool operator >(Score a, Score b) => a.CompareTo(b) > 0;
    public static bool operator <=(Score a, Score b) => a.CompareTo(b) <= 0;
    public static bool operator >=(Score a, Score b) => a.CompareTo(b) >= 0;

    public override string ToString() => $"RED {Red} · clash {Clash} · balance {Balance} · excess {Excess}";
}

/// <summary>Ground-truth evaluation of a complete assignment, computed from scratch.</summary>
public sealed record Evaluation(
    Score Score,
    int[] WeekdayLoads,
    int RangeViolations,
    int PinnedViolations,
    int FacultyViolations)
{
    public bool IsFeasible => RangeViolations == 0 && PinnedViolations == 0 && FacultyViolations == 0;
}

public static class Evaluator
{
    /// <summary>Recomputes every objective level and every hard rule for <paramref name="day"/> without any incremental state.</summary>
    public static Evaluation Evaluate(SchedulingProblem problem, ReadOnlySpan<byte> day)
    {
        ArgumentNullException.ThrowIfNull(problem);
        int n = problem.CourseCount, wd = problem.WeekdayCount;
        if (day.Length != n) throw new ArgumentException("Assignment length must equal the course count.", nameof(day));

        var loads = new int[wd];
        int range = 0, pinned = 0;
        for (int c = 0; c < n; c++)
        {
            if (day[c] >= problem.AllowedDays(c)) { range++; continue; }
            loads[day[c]] += problem.SectionCount(c);
            if (problem.FixedDay(c) >= 0 && day[c] != problem.FixedDay(c)) pinned++;
        }

        int red = 0;
        Span<byte> perDay = stackalloc byte[wd];
        for (int s = 0; s < problem.StudentCount; s++)
        {
            perDay.Clear();
            bool isRed = false;
            foreach (int c in problem.StudentCourses(s))
            {
                if (day[c] >= wd) continue;
                if (++perDay[day[c]] >= 2) { isRed = true; break; }
            }
            if (isRed) red++;
        }

        int clash = 0;
        var a = problem.EdgeA; var b = problem.EdgeB; var w = problem.EdgeWeights;
        for (int e = 0; e < a.Length; e++)
            if (day[a[e]] == day[b[e]]) clash += w[e];

        int balance = 0, excess = 0;
        for (int d = 0; d < wd; d++)
        {
            balance += Math.Abs(wd * loads[d] - problem.TotalSections);
            excess += Math.Max(0, loads[d] - problem.PreferredParallel);
        }

        int faculty = 0;
        if (problem.GroupCount > 0)
        {
            var seen = new int[problem.GroupCount * wd];
            for (int g = 0; g < problem.GroupCount; g++)
                foreach (int c in problem.GroupCourses(g))
                {
                    if (day[c] >= wd) continue;
                    if (++seen[g * wd + day[c]] > 1) faculty++;
                }
        }

        return new Evaluation(new Score(red, clash, balance, excess), loads, range, pinned, faculty);
    }
}
