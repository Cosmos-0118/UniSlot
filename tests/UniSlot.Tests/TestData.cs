using UniSlot.Application.Importing;
using UniSlot.Application.Planning;
using UniSlot.Domain;
using UniSlot.Solver;

namespace UniSlot.Tests;

internal static class TestData
{
    public static readonly string[] Header =
        ["Program", "Register Number", "Student Name", "Mobile Number", "Email ID", "Course Code", "Course Title", "Faculty"];

    /// <summary>Synthetic enrollment grid: no real people, deterministic from <paramref name="seed"/>.</summary>
    public static List<IReadOnlyList<string?>> Grid(int students, int courses, int maxPerStudent, int seed, int titleRows = 0)
    {
        var rng = new Random(seed);
        var grid = new List<IReadOnlyList<string?>>();
        for (int i = 0; i < titleRows; i++) grid.Add(["Some report title", null, null]);
        grid.Add(Header);
        for (int s = 0; s < students; s++)
        {
            int k = 1 + rng.Next(maxPerStudent);
            var chosen = new HashSet<int>();
            while (chosen.Count < k) chosen.Add(rng.Next(courses));
            foreach (int c in chosen)
                grid.Add(["B.Tech-Computer Science", $"RA{2200000000000 + s}", $"student {s} name", $"98765{s:00000}", $"s{s}@example.edu",
                    $"21CS{c:000}T", $"course {c}", null]);
        }
        return grid;
    }

    public static Roster Roster(List<IReadOnlyList<string?>> grid)
    {
        var result = RosterBuilder.Build(EnrollmentParser.Parse(grid));
        return result.Roster ?? throw new InvalidOperationException("synthetic grid was rejected");
    }

    public static ProblemModel Model(Roster roster, SchedulePolicy? policy = null)
    {
        var sections = SectionPlanner.Plan(roster);
        return ProblemBuilder.Build(roster, sections, policy ?? SchedulePolicy.Default);
    }

    /// <summary>Hand-built problem: <paramref name="students"/> lists each student's courses.</summary>
    public static SchedulingProblem Problem(int courses, int[][] students, int weekdays = 5, int[][]? groups = null, int[]? pinned = null, int[]? allowed = null)
    {
        var weights = new Dictionary<(int, int), int>();
        var offsets = new List<int> { 0 };
        var items = new List<int>();
        foreach (var s in students)
        {
            var c = s.Distinct().Order().ToArray();
            if (c.Length < 2) continue;
            items.AddRange(c);
            offsets.Add(items.Count);
            for (int i = 0; i < c.Length; i++)
                for (int j = i + 1; j < c.Length; j++)
                    weights[(c[i], c[j])] = weights.GetValueOrDefault((c[i], c[j])) + 1;
        }
        var keys = weights.Keys.OrderBy(k => k.Item1).ThenBy(k => k.Item2).ToArray();
        var gOff = new List<int> { 0 };
        var gItems = new List<int>();
        foreach (var g in groups ?? [])
        {
            gItems.AddRange(g);
            gOff.Add(gItems.Count);
        }
        return new SchedulingProblem(
            Enumerable.Range(0, courses).Select(i => $"C{i:000}").ToArray(),
            Enumerable.Repeat(1, courses).ToArray(),
            allowed ?? Enumerable.Repeat(weekdays, courses).ToArray(),
            pinned ?? Enumerable.Repeat(-1, courses).ToArray(),
            weekdays, 11,
            keys.Select(k => k.Item1).ToArray(), keys.Select(k => k.Item2).ToArray(), keys.Select(k => weights[k]).ToArray(),
            [.. offsets], [.. items], [.. gOff], [.. gItems], students.Length);
    }

    /// <summary>Random problem with clustered enrollments, for property-style tests.</summary>
    public static SchedulingProblem RandomProblem(int courses, int students, int seed, int weekdays = 5)
    {
        var rng = new Random(seed);
        var list = new List<int[]>();
        for (int s = 0; s < students; s++)
        {
            int k = 1 + rng.Next(5);
            int basis = rng.Next(courses);
            var set = new HashSet<int>();
            while (set.Count < k) set.Add(rng.Next(3) == 0 ? rng.Next(courses) : (basis + rng.Next(Math.Max(2, courses / 8))) % courses);
            list.Add([.. set]);
        }
        return Problem(courses, [.. list], weekdays);
    }
}
