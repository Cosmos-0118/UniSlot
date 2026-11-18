using UniSlot.Domain;
using UniSlot.Solver;

namespace UniSlot.Application.Planning;

/// <summary>The solver's integer view of a roster plus the mapping back to course codes.</summary>
public sealed class ProblemModel
{
    internal ProblemModel(SchedulingProblem problem, IReadOnlyList<string> courseOrder)
    {
        Problem = problem;
        CourseOrder = courseOrder;
    }

    public SchedulingProblem Problem { get; }

    /// <summary>Course codes in solver index order (ordinal sort, so indices are identical on every machine).</summary>
    public IReadOnlyList<string> CourseOrder { get; }

    public Timetable ToTimetable(ReadOnlySpan<byte> assignment)
    {
        if (assignment.Length != CourseOrder.Count) throw new ArgumentException("Assignment length does not match the problem.", nameof(assignment));
        var pairs = new List<KeyValuePair<string, int>>(CourseOrder.Count);
        for (int i = 0; i < CourseOrder.Count; i++) pairs.Add(new(CourseOrder[i], assignment[i]));
        return new Timetable(pairs);
    }

    public byte[] ToAssignment(Timetable timetable)
    {
        var a = new byte[CourseOrder.Count];
        for (int i = 0; i < a.Length; i++) a[i] = (byte)timetable.DayOf(CourseOrder[i]);
        return a;
    }
}

public static class ProblemBuilder
{
    public static ProblemModel Build(Roster roster, IReadOnlyList<Section> sections, SchedulePolicy policy, IReadOnlyDictionary<string, int>? pinnedDays = null)
    {
        ArgumentNullException.ThrowIfNull(roster);
        ArgumentNullException.ThrowIfNull(sections);
        ArgumentNullException.ThrowIfNull(policy);

        string[] order = [.. roster.Courses.Select(c => c.Code).Order(StringComparer.Ordinal)];
        var index = new Dictionary<string, int>(order.Length, StringComparer.Ordinal);
        for (int i = 0; i < order.Length; i++) index[order[i]] = i;

        var sectionCounts = new int[order.Length];
        foreach (var s in sections) sectionCounts[index[s.CourseCode]]++;

        var allowed = new int[order.Length];
        var pinned = new int[order.Length];
        for (int i = 0; i < order.Length; i++)
        {
            allowed[i] = policy.AllowedDays(order[i]);
            pinned[i] = pinnedDays is not null && pinnedDays.TryGetValue(order[i], out int d) ? d : -1;
        }

        // students with ≥ 2 distinct courses, plus pair weights
        var pairWeights = new Dictionary<long, int>();
        var studentOffsets = new List<int> { 0 };
        var studentCourses = new List<int>();
        foreach (var student in roster.Students)
        {
            int[] courses = [.. student.Courses.Select(c => index[c]).Distinct().Order()];
            if (courses.Length < 2) continue;
            studentCourses.AddRange(courses);
            studentOffsets.Add(studentCourses.Count);
            for (int i = 0; i < courses.Length; i++)
                for (int j = i + 1; j < courses.Length; j++)
                {
                    long key = ((long)courses[i] << 32) | (uint)courses[j];
                    pairWeights[key] = pairWeights.GetValueOrDefault(key) + 1;
                }
        }

        var keys = pairWeights.Keys.Order().ToArray();
        var edgeA = new int[keys.Length];
        var edgeB = new int[keys.Length];
        var edgeW = new int[keys.Length];
        for (int e = 0; e < keys.Length; e++)
        {
            edgeA[e] = (int)(keys[e] >> 32);
            edgeB[e] = (int)(keys[e] & 0xFFFFFFFFL);
            edgeW[e] = pairWeights[keys[e]];
        }

        // Faculty groups: a named instructor teaching two or more different courses must teach them on different weekdays.
        var groupOffsets = new List<int> { 0 };
        var groupCourses = new List<int>();
        foreach (var group in sections.Where(s => !string.IsNullOrWhiteSpace(s.Faculty)).GroupBy(s => s.Faculty!, StringComparer.Ordinal)
                     .OrderBy(g => g.Key, StringComparer.Ordinal))
        {
            int[] courses = [.. group.Select(s => index[s.CourseCode]).Distinct().Order()];
            if (courses.Length < 2) continue;
            groupCourses.AddRange(courses);
            groupOffsets.Add(groupCourses.Count);
        }

        var problem = new SchedulingProblem(order, sectionCounts, allowed, pinned, policy.WeekdayCount, policy.PreferredParallel,
            edgeA, edgeB, edgeW, [.. studentOffsets], [.. studentCourses], [.. groupOffsets], [.. groupCourses], roster.Students.Count);
        return new ProblemModel(problem, order);
    }
}
