namespace UniSlot.Domain;

/// <summary>A broken hard rule. <see cref="Code"/> is stable and localisable; <see cref="Detail"/> is a developer-readable English sentence.</summary>
public sealed record Violation(string Code, string Subject, string Detail)
{
    public override string ToString() => Detail;
}

public sealed record StudentOverlap(string RegisterNumber, Weekday Day, IReadOnlyList<string> Courses);

public sealed record AuditReport(IReadOnlyList<Violation> Structural, IReadOnlyList<StudentOverlap> Overlaps)
{
    /// <summary>True when every rule the solver treats as hard holds. Student overlaps are the soft objective and do not count.</summary>
    public bool IsStructurallyFeasible => Structural.Count == 0;
}

/// <summary>
/// Independent post-solve audit of the hard rules (Constraints §13): every course placed exactly once, split sections together,
/// valid weekdays, capacity, faculty double-booking and the Saturday policy. It re-derives everything from the timetable and
/// shares no code with the solver, so it can catch a solver defect.
/// </summary>
public static class ScheduleAuditor
{
    public static AuditReport Audit(
        IReadOnlyList<Section> sections,
        Timetable timetable,
        SchedulePolicy policy,
        IReadOnlySet<string>? capacityWaivers = null)
    {
        ArgumentNullException.ThrowIfNull(sections);
        ArgumentNullException.ThrowIfNull(timetable);
        ArgumentNullException.ThrowIfNull(policy);

        var violations = new List<Violation>();
        var courses = sections.Select(s => s.CourseCode).Distinct(StringComparer.Ordinal).ToHashSet(StringComparer.Ordinal);

        foreach (string code in courses)
            if (!timetable.TryDayOf(code, out _))
                violations.Add(new Violation("course.unplaced", code, $"Course {code} has no weekday."));
        foreach (string code in timetable.CourseDays.Keys)
            if (!courses.Contains(code))
                violations.Add(new Violation("course.unknown", code, $"Timetable places unknown course {code}."));

        var facultyDay = new Dictionary<(string Faculty, int Day), string>();
        foreach (var section in sections)
        {
            if (!timetable.TryDayOf(section.CourseCode, out int day)) continue;
            if (day < 0 || day >= policy.WeekdayCount)
            {
                violations.Add(new Violation("day.invalid", section.Id, $"Section {section.Id}: invalid weekday {day}."));
                continue;
            }

            if (section.Students.Count > section.Capacity && capacityWaivers?.Contains(section.Id) != true)
                violations.Add(new Violation("capacity", section.Id,
                    $"Section {section.Id}: enrollment {section.Students.Count} exceeds capacity {section.Capacity}."));

            if (!string.IsNullOrWhiteSpace(section.Faculty))
            {
                var key = (section.Faculty!, day);
                if (facultyDay.TryGetValue(key, out string? other) && other != section.Id)
                    violations.Add(new Violation("faculty.overlap", section.Faculty!,
                        $"Faculty {section.Faculty} teaches {other} and {section.Id} on the same weekday."));
                else
                    facultyDay[key] = section.Id;
            }
        }

        foreach (string code in courses)
        {
            if (!timetable.TryDayOf(code, out int day) || day != SchedulePolicy.SaturdayIndex) continue;
            if (!policy.SaturdayOpen)
                violations.Add(new Violation("saturday.closed", code, $"Course {code} is on Saturday, which is closed."));
            else if (!policy.IsSaturdayEligible(code))
                violations.Add(new Violation("saturday.ineligible", code, $"Course {code} is on Saturday but is not a mathematics or allow-listed course."));
        }

        // Split sections must share one weekday: with a course→day timetable this holds by construction, so verify the invariant
        // against the section expansion rather than assuming it.
        var sectionDays = timetable.SectionDays(sections);
        foreach (var group in sections.GroupBy(s => s.CourseCode, StringComparer.Ordinal).Where(g => g.Count() > 1))
        {
            var days = group.Where(s => sectionDays.ContainsKey(s.Id)).Select(s => sectionDays[s.Id]).Distinct().ToList();
            if (days.Count > 1)
                violations.Add(new Violation("split.sync", group.Key, $"Course {group.Key}: split sections must share one weekday."));
        }

        var overlaps = new List<StudentOverlap>();
        var perStudent = new Dictionary<string, Dictionary<int, HashSet<string>>>(StringComparer.Ordinal);
        foreach (var section in sections)
        {
            if (!timetable.TryDayOf(section.CourseCode, out int day) || day < 0 || day >= policy.WeekdayCount) continue;
            foreach (string student in section.Students)
            {
                if (!perStudent.TryGetValue(student, out var byDay)) perStudent[student] = byDay = new();
                if (!byDay.TryGetValue(day, out var set)) byDay[day] = set = new(StringComparer.Ordinal);
                set.Add(section.CourseCode);
            }
        }
        foreach (var (student, byDay) in perStudent.OrderBy(p => p.Key, StringComparer.Ordinal))
            foreach (var (day, set) in byDay.OrderBy(p => p.Key))
                if (set.Count > 1)
                    overlaps.Add(new StudentOverlap(student, (Weekday)day, [.. set.Order(StringComparer.Ordinal)]));

        return new AuditReport(violations, overlaps);
    }
}
