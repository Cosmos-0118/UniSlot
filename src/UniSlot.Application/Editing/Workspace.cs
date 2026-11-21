using UniSlot.Application.Importing;
using UniSlot.Application.Workflow;
using UniSlot.Domain;

namespace UniSlot.Application.Editing;

/// <summary>
/// A published timetable that can be edited without re-planning it: the enrollment rows, the exact sections with their students,
/// and the weekday of every course. Edits change this state; <see cref="EditWorkflow"/> then audits and exports it.
/// </summary>
public sealed class Workspace
{
    public static readonly string[] GridHeader =
        ["Program", "Register Number", "Student Name", "Mobile Number", "Email ID", "Course Code", "Course Title", "Faculty", "Registration Type", "Remarks", "ADL Remarks"];

    public required SourceInfo Source { get; init; }
    public required SchedulePolicy Policy { get; init; }
    public required List<EnrollmentRow> Rows { get; init; }
    public required List<Section> Sections { get; init; }
    public required Dictionary<string, int> Days { get; init; }
    public ulong Seed { get; init; } = 1;
    public int Chains { get; init; } = 12;
    public IReadOnlyList<string> RunLog { get; init; } = [];

    public Workspace Clone() => new()
    {
        Source = Source, Policy = Policy, Rows = [.. Rows], Sections = [.. Sections], Days = new Dictionary<string, int>(Days, StringComparer.Ordinal),
        Seed = Seed, Chains = Chains, RunLog = RunLog,
    };

    public IReadOnlyList<IReadOnlyList<string?>> ToGrid()
    {
        var grid = new List<IReadOnlyList<string?>> { GridHeader };
        foreach (var r in Rows)
            grid.Add([r.Program, r.RegisterNumber, r.StudentName, r.Mobile, r.Email, r.CourseCode, r.CourseTitle, r.Faculty, r.RegistrationType, r.Remarks, r.AdditionalRemarks]);
        return grid;
    }

    /// <summary>Roster as the solver would see it (rows are re-validated, so a broken state fails loudly here).</summary>
    public Roster ToRoster()
    {
        var result = RosterBuilder.Build(EnrollmentParser.Parse(ToGrid()));
        return result.Roster ?? throw new InputRejectedException(result.Validation);
    }

    public Timetable ToTimetable() => new(Days);

    /// <summary>
    /// Checks that rows, sections and weekdays describe one consistent timetable, so a folder from another tool version (or a damaged one) fails with a
    /// readable message instead of moving a published class. Courses without a weekday are only accepted when <paramref name="allowUnplaced"/> is set.
    /// </summary>
    public void Validate(bool allowUnplaced = false)
    {
        Roster roster;
        try { roster = ToRoster(); }
        catch (InputRejectedException ex)
        {
            throw new InvalidDataException("The saved enrollment rows are not valid: " + (ex.Report.Errors.FirstOrDefault()?.Message ?? "unknown problem"));
        }

        var problems = new List<string>();
        var enrolled = roster.Rows.Select(r => (r.RegisterNumber, r.CourseCode)).ToHashSet();
        var placed = new HashSet<(string, string)>();
        foreach (var s in Sections)
        {
            if (!roster.HasCourse(s.CourseCode)) problems.Add($"section {s.Id} belongs to course {s.CourseCode}, which has no enrollment rows");
            foreach (string student in s.Students)
            {
                if (!enrolled.Contains((student, s.CourseCode))) problems.Add($"{student} is listed in section {s.Id} but is not enrolled in {s.CourseCode}");
                else placed.Add((student, s.CourseCode));
            }
            if (!allowUnplaced && !Days.ContainsKey(s.CourseCode)) problems.Add($"course {s.CourseCode} has no weekday");
        }
        foreach (var (student, course) in enrolled)
            if (!placed.Contains((student, course))) problems.Add($"{student} is enrolled in {course} but sits in no section");

        if (problems.Count > 0)
        {
            var distinct = problems.Distinct(StringComparer.Ordinal).ToList();
            throw new InvalidDataException("This timetable is inconsistent and cannot be edited safely: " + string.Join("; ", distinct.Take(3))
                + (distinct.Count > 3 ? $"; and {distinct.Count - 3} more." : "."));
        }
    }

    public bool IsEnrolled(string register, string course) => Rows.Any(r => r.RegisterNumber == register && r.CourseCode == course);

    public IEnumerable<EnrollmentRow> RowsOf(string register) => Rows.Where(r => r.RegisterNumber == register);

    public IReadOnlyList<Section> SectionsOf(string course) => [.. Sections.Where(s => s.CourseCode == course).OrderBy(s => s.Number)];

    public bool HasCourse(string course) => Days.ContainsKey(course) || Sections.Any(s => s.CourseCode == course);

    public string? SectionOf(string register, string course) =>
        Sections.FirstOrDefault(s => s.CourseCode == course && s.Students.Contains(register, StringComparer.Ordinal))?.Id;

    /// <summary>Removes one registration from the rows and its section; a course left with no students disappears with its weekday.</summary>
    public bool Remove(string register, string course, out string? sectionId, out bool courseRemoved)
    {
        sectionId = SectionOf(register, course);
        courseRemoved = false;
        int removed = Rows.RemoveAll(r => r.RegisterNumber == register && r.CourseCode == course);
        for (int i = 0; i < Sections.Count; i++)
        {
            var s = Sections[i];
            if (s.CourseCode == course && s.Students.Contains(register, StringComparer.Ordinal))
                Sections[i] = s with { Students = [.. s.Students.Where(x => x != register)] };
        }
        if (removed > 0 && !Rows.Any(r => r.CourseCode == course))
        {
            Sections.RemoveAll(s => s.CourseCode == course);
            Days.Remove(course);
            courseRemoved = true;
        }
        return removed > 0;
    }

    /// <summary>
    /// Adds a registration to the least-loaded section with room. When every section is full: <see cref="FullPolicy.NewSection"/>
    /// opens another section, <see cref="FullPolicy.Fit"/> overfills the least-loaded one, <see cref="FullPolicy.Park"/> declines.
    /// </summary>
    public PlacementResult Add(EnrollmentRow row, FullPolicy onFull)
    {
        var sections = SectionsOf(row.CourseCode);
        if (sections.Count == 0)
        {
            // A brand-new course: first section holds up to SingleSectionMax, later ones the split capacity.
            var created = new Section(row.CourseCode, row.CourseCode, row.CourseTitle, 1, string.IsNullOrWhiteSpace(row.Faculty) ? $"Planning:{row.CourseCode}" : row.Faculty,
                Planning.SectionPlanner.SingleSectionMax, [row.RegisterNumber], ProgramList(row));
            Sections.Add(created);
            Rows.Add(row);
            return new PlacementResult(PlacementKind.NewCourse, created.Id, null);
        }

        var open = sections.Where(s => s.Students.Count < s.Capacity).OrderBy(s => s.Students.Count).ThenBy(s => s.Number).FirstOrDefault();
        if (open is not null) return Place(open, row, PlacementKind.Existing);

        switch (onFull)
        {
            case FullPolicy.Fit:
                return Place(sections.OrderBy(s => s.Students.Count).ThenBy(s => s.Number).First(), row, PlacementKind.Overfilled);
            case FullPolicy.Park:
                return new PlacementResult(PlacementKind.Parked, null, $"{row.CourseCode} is full");
            default:
                {
                    int number = sections.Max(s => s.Number) + 1;
                    string id = $"{row.CourseCode}_S{number}";
                    var created = new Section(id, row.CourseCode, sections[0].CourseTitle, number, $"Planning:{id}", Planning.SectionPlanner.SplitSectionCapacity, [row.RegisterNumber], ProgramList(row));
                    // A course that was a single section is now split: its sections keep their ids so published classes do not change.
                    Sections.Add(created);
                    Rows.Add(row);
                    return new PlacementResult(PlacementKind.NewSection, id, null);
                }
        }
    }

    private PlacementResult Place(Section target, EnrollmentRow row, PlacementKind kind)
    {
        int i = Sections.FindIndex(s => s.Id == target.Id);
        var programs = row.Program.Length == 0 || target.Programs.Contains(row.Program, StringComparer.Ordinal)
            ? target.Programs
            : [.. target.Programs.Append(row.Program).Order(StringComparer.Ordinal)];
        var students = new List<string>(target.Students) { row.RegisterNumber };
        // Placing over capacity is a deliberate waiver: the section's capacity is raised so the audit still holds every other rule.
        int capacity = kind == PlacementKind.Overfilled ? Math.Max(target.Capacity, students.Count) : target.Capacity;
        Sections[i] = target with { Students = students, Programs = programs, Capacity = capacity };
        Rows.Add(row);
        return new PlacementResult(kind, target.Id, null);
    }

    private static IReadOnlyList<string> ProgramList(EnrollmentRow row) => row.Program.Length == 0 ? [] : [row.Program];

    /// <summary>Courses that have sections but no weekday yet: the only courses an edit run is free to place.</summary>
    public IEnumerable<string> UnplacedCourses() =>
        Sections.Select(s => s.CourseCode).Distinct(StringComparer.Ordinal).Where(c => !Days.ContainsKey(c));
}

public enum FullPolicy { NewSection, Fit, Park }

public enum ClashPolicy { Accept, ParkStudent }

public enum PlacementKind { Existing, NewSection, Overfilled, NewCourse, Parked }

public sealed record PlacementResult(PlacementKind Kind, string? SectionId, string? Reason);
