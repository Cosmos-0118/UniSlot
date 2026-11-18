using UniSlot.Domain;

namespace UniSlot.Application.Planning;

/// <summary>
/// Capacity splits and student allocation. A course with up to 64 students is one section; larger courses are split into
/// ceil(n / 60) sections of capacity 60. All sections of a course run on the same weekday, each with its own instructor identity.
/// </summary>
public static class SectionPlanner
{
    public const int SingleSectionMax = 64;
    public const int SplitSectionCapacity = 60;
    public const string PlaceholderPrefix = "Planning:";

    public static IReadOnlyList<Section> Plan(Roster roster)
    {
        ArgumentNullException.ThrowIfNull(roster);
        var programsByEnrollment = new Dictionary<(string Course, string Student), SortedSet<string>>();
        var studentsByCourse = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var row in roster.Rows)
        {
            if (!studentsByCourse.TryGetValue(row.CourseCode, out var list)) studentsByCourse[row.CourseCode] = list = new();
            list.Add(row.RegisterNumber);
            if (row.Program.Length > 0)
            {
                var key = (row.CourseCode, row.RegisterNumber);
                if (!programsByEnrollment.TryGetValue(key, out var set)) programsByEnrollment[key] = set = new(StringComparer.Ordinal);
                set.Add(row.Program);
            }
        }

        var result = new List<Section>();
        foreach (var course in roster.Courses)
        {
            int count = course.Enrollment <= SingleSectionMax ? 1 : (int)Math.Ceiling(course.Enrollment / (double)SplitSectionCapacity);
            int capacity = count == 1 ? SingleSectionMax : SplitSectionCapacity;

            var enrolled = studentsByCourse[course.Code].Distinct(StringComparer.Ordinal)
                .Select(id => (Id: id, Program: ProgramFor(course.Code, id, programsByEnrollment, roster)))
                .OrderBy(s => s.Program, StringComparer.Ordinal).ThenBy(s => s.Id, StringComparer.Ordinal)
                .ToList();

            var members = Enumerable.Range(0, count).Select(_ => new List<string>()).ToArray();
            var programCounts = Enumerable.Range(0, count).Select(_ => new Dictionary<string, int>(StringComparer.Ordinal)).ToArray();
            foreach (var (id, program) in enrolled)
            {
                int best = -1, bestLoad = int.MaxValue, bestProgram = -1;
                for (int i = 0; i < count; i++)
                {
                    int load = members[i].Count;
                    if (load >= capacity) continue;
                    int inProgram = programCounts[i].GetValueOrDefault(program);
                    if (load < bestLoad || (load == bestLoad && inProgram > bestProgram))
                    {
                        best = i; bestLoad = load; bestProgram = inProgram;
                    }
                }
                if (best < 0)
                    throw new InvalidOperationException($"Course {course.Code}: {enrolled.Count} enrollments exceed total capacity {count * capacity}.");
                members[best].Add(id);
                programCounts[best][program] = programCounts[best].GetValueOrDefault(program) + 1;
            }

            string?[] faculty = AssignFaculty(course, count);
            for (int i = 0; i < count; i++)
            {
                string sectionId = count > 1 ? $"{course.Code}_S{i + 1}" : course.Code;
                result.Add(new Section(sectionId, course.Code, course.Title, i + 1, faculty[i] ?? $"{PlaceholderPrefix}{sectionId}", capacity,
                    members[i], [.. programCounts[i].Keys.Order(StringComparer.Ordinal)]));
            }
        }
        return result;
    }

    private static string ProgramFor(string course, string studentId, Dictionary<(string, string), SortedSet<string>> byEnrollment, Roster roster)
    {
        if (byEnrollment.TryGetValue((course, studentId), out var set) && set.Count > 0) return set.Min!;
        string fallback = roster.Student(studentId).Program.Trim();
        return fallback.Length > 0 ? fallback : "Unknown";
    }

    /// <summary>
    /// A named course instructor is a real resource and stays on the first section so their other courses remain mutually exclusive;
    /// extra sections get <c>Planning:&lt;section id&gt;</c> placeholders until staff are assigned.
    /// </summary>
    private static string?[] AssignFaculty(Course course, int count)
    {
        var faculty = new string?[count];
        string? named = course.Faculty?.Trim();
        if (!string.IsNullOrEmpty(named)) faculty[0] = named;
        return faculty;
    }
}
