namespace UniSlot.Domain;

/// <summary>One cleaned row of the enrollment workbook: a single student registered for a single course.</summary>
public sealed record EnrollmentRow(
    string Program,
    string RegisterNumber,
    string StudentName,
    string? Mobile,
    string? Email,
    string CourseCode,
    string CourseTitle,
    string? Faculty,
    string? RegistrationType,
    string? Remarks,
    string? AdditionalRemarks);

public sealed record Student(
    string RegisterNumber,
    string Name,
    string Program,
    string? Email,
    string? Mobile,
    IReadOnlyList<string> Courses);

public sealed record Course(string Code, string Title, int Enrollment, string? Faculty);

/// <summary>A schedulable fragment of a course. All sections of a course run on the same weekday.</summary>
public sealed record Section(
    string Id,
    string CourseCode,
    string CourseTitle,
    int Number,
    string? Faculty,
    int Capacity,
    IReadOnlyList<string> Students,
    IReadOnlyList<string> Programs);

/// <summary>Canonical, deduplicated enrollment data. Order is first appearance in the workbook.</summary>
public sealed class Roster
{
    private readonly Dictionary<string, Student> _students;
    private readonly Dictionary<string, Course> _courses;

    public Roster(IReadOnlyList<EnrollmentRow> rows, IReadOnlyList<Student> students, IReadOnlyList<Course> courses)
    {
        Rows = rows;
        Students = students;
        Courses = courses;
        _students = students.ToDictionary(s => s.RegisterNumber, StringComparer.Ordinal);
        _courses = courses.ToDictionary(c => c.Code, StringComparer.Ordinal);
    }

    public IReadOnlyList<EnrollmentRow> Rows { get; }
    public IReadOnlyList<Student> Students { get; }
    public IReadOnlyList<Course> Courses { get; }

    public Student Student(string registerNumber) => _students[registerNumber];
    public Course Course(string code) => _courses[code];
    public bool TryGetStudent(string registerNumber, out Student student) => _students.TryGetValue(registerNumber, out student!);
    public bool HasCourse(string code) => _courses.ContainsKey(code);
}

/// <summary>A complete weekly assignment: every course on exactly one weekday (0 = Monday).</summary>
public sealed class Timetable
{
    private readonly Dictionary<string, int> _days;

    public Timetable(IEnumerable<KeyValuePair<string, int>> courseDays)
    {
        _days = new Dictionary<string, int>(courseDays, StringComparer.Ordinal);
    }

    public IReadOnlyDictionary<string, int> CourseDays => _days;

    public bool TryDayOf(string courseCode, out int day) => _days.TryGetValue(courseCode, out day);

    public int DayOf(string courseCode) => _days[courseCode];

    /// <summary>Expands course days to section days (split sections share their course's weekday).</summary>
    public Dictionary<string, int> SectionDays(IEnumerable<Section> sections)
    {
        var result = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var s in sections)
            if (_days.TryGetValue(s.CourseCode, out int d)) result[s.Id] = d;
        return result;
    }
}
