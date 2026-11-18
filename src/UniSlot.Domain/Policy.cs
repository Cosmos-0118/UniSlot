using System.Text.RegularExpressions;

namespace UniSlot.Domain;

public enum Weekday
{
    Monday = 0,
    Tuesday = 1,
    Wednesday = 2,
    Thursday = 3,
    Friday = 4,
    Saturday = 5,
}

/// <summary>
/// The single source of truth for the time model: one evening session (5–7 PM) per weekday, Saturday available only to
/// mathematics courses (when enabled) or an explicit allow-list.
/// </summary>
public sealed partial record SchedulePolicy
{
    public const int WeekdaysWithoutSaturday = 5;
    public const int WeekdaysWithSaturday = 6;
    public const int SaturdayIndex = 5;
    public const string SessionWindow = "5:00 PM – 7:00 PM";

    public static SchedulePolicy Default { get; } = new();

    /// <summary>Allow mathematics courses on Saturday. Off by default: the standing policy is a Monday–Friday timetable.</summary>
    public bool AllowSaturdayForMaths { get; init; }

    /// <summary>Course codes allowed on Saturday regardless of subject (stored upper-case).</summary>
    public IReadOnlySet<string> SaturdayExtraCourses { get; init; } = new HashSet<string>(StringComparer.Ordinal);

    /// <summary>Comfortable number of simultaneous sections per weekday. A soft target, never a hard limit.</summary>
    public int PreferredParallel { get; init; } = 11;

    public bool SaturdayOpen => AllowSaturdayForMaths || SaturdayExtraCourses.Count > 0;

    public int WeekdayCount => SaturdayOpen ? WeekdaysWithSaturday : WeekdaysWithoutSaturday;

    public bool IsSaturdayEligible(string courseCode)
    {
        string code = courseCode.Trim().ToUpperInvariant();
        return SaturdayExtraCourses.Contains(code) || (AllowSaturdayForMaths && IsMathsCourse(code));
    }

    /// <summary>Number of weekdays (counted from Monday) a course may use.</summary>
    public int AllowedDays(string courseCode) =>
        SaturdayOpen && IsSaturdayEligible(courseCode) ? WeekdaysWithSaturday : WeekdaysWithoutSaturday;

    public static IReadOnlySet<string> NormalizeCodes(IEnumerable<string>? codes) =>
        new HashSet<string>((codes ?? []).SelectMany(c => (c ?? "").Split([',', ';', ' ', '\t'], StringSplitOptions.RemoveEmptyEntries))
            .Select(c => c.Trim().ToUpperInvariant()).Where(c => c.Length > 0), StringComparer.Ordinal);

    /// <summary>Mathematics courses: '21MAB101T', '21MAC503T', 'MA101', 'MAT201' …</summary>
    public static bool IsMathsCourse(string upperCode) => MathsPattern().IsMatch(upperCode) || upperCode.StartsWith("MAT", StringComparison.Ordinal);

    [GeneratedRegex("^[0-9]*MA", RegexOptions.CultureInvariant)]
    private static partial Regex MathsPattern();
}
