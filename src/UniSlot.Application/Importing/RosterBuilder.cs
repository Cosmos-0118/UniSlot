using UniSlot.Domain;

namespace UniSlot.Application.Importing;

public sealed record RosterResult(Roster? Roster, ValidationReport Validation);

public static class RosterBuilder
{
    /// <summary>
    /// Applies the business rules: a student appears at most once per course (duplicates become warnings), then derives the
    /// canonical students and courses in first-appearance order.
    /// </summary>
    public static RosterResult Build(ParsedEnrollment parsed)
    {
        ArgumentNullException.ThrowIfNull(parsed);
        if (!parsed.Validation.IsValid) return new RosterResult(null, parsed.Validation);

        var warnings = new List<ValidationIssue>(parsed.Validation.Warnings);
        var rows = new List<EnrollmentRow>(parsed.Rows.Count);
        var seen = new HashSet<(string, string)>();
        foreach (var row in parsed.Rows)
        {
            if (!seen.Add((row.RegisterNumber, row.CourseCode)))
            {
                warnings.Add(new ValidationIssue(null, "duplicate", "registration.duplicate",
                    $"Duplicate registration: {row.RegisterNumber} in {row.CourseCode}", $"{row.RegisterNumber}:{row.CourseCode}"));
                continue;
            }
            rows.Add(row);
        }

        var students = new List<Student>();
        var studentIndex = new Dictionary<string, int>(StringComparer.Ordinal);
        var studentCourses = new List<List<string>>();
        var courseOrder = new List<string>();
        var courseTitle = new Dictionary<string, string>(StringComparer.Ordinal);
        var courseFaculty = new Dictionary<string, string>(StringComparer.Ordinal);
        var courseFacultyNames = new Dictionary<string, SortedSet<string>>(StringComparer.Ordinal);
        var courseStudents = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);

        foreach (var row in rows)
        {
            if (!studentIndex.TryGetValue(row.RegisterNumber, out int si))
            {
                si = students.Count;
                studentIndex[row.RegisterNumber] = si;
                students.Add(new Student(row.RegisterNumber, row.StudentName, row.Program, row.Email, row.Mobile, []));
                studentCourses.Add([]);
            }
            studentCourses[si].Add(row.CourseCode);

            if (!courseTitle.ContainsKey(row.CourseCode))
            {
                courseTitle[row.CourseCode] = row.CourseTitle;
                courseOrder.Add(row.CourseCode);
                courseStudents[row.CourseCode] = new HashSet<string>(StringComparer.Ordinal);
            }
            courseStudents[row.CourseCode].Add(row.RegisterNumber);

            string? faculty = row.Faculty?.Trim();
            if (!string.IsNullOrEmpty(faculty))
            {
                courseFaculty.TryAdd(row.CourseCode, faculty);
                if (!courseFacultyNames.TryGetValue(row.CourseCode, out var names))
                    courseFacultyNames[row.CourseCode] = names = new SortedSet<string>(StringComparer.Ordinal);
                names.Add(faculty);
            }
        }

        foreach (var (code, names) in courseFacultyNames)
            if (names.Count > 1)
                warnings.Add(new ValidationIssue(null, "faculty", "faculty.multiple",
                    $"Course {code}: multiple distinct faculty names in the sheet ({string.Join(" · ", names)}). Using the first value encountered.", code));

        var finalStudents = students.Select((s, i) => s with { Courses = studentCourses[i] }).ToList();
        var courses = courseOrder.Select(c => new Course(c, courseTitle[c], courseStudents[c].Count, courseFaculty.GetValueOrDefault(c))).ToList();

        var validation = new ValidationReport(true, parsed.Validation.Errors, warnings, parsed.Validation.TotalRows, rows.Count);
        return new RosterResult(new Roster(rows, finalStudents, courses), validation);
    }
}
