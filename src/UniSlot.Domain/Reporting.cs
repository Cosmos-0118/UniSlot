using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace UniSlot.Domain;

public enum ClashStatus { Green, Red }

public readonly record struct CoursePair(string A, string B);

public sealed record StudentClash(
    string RegisterNumber,
    string Name,
    string Program,
    IReadOnlyList<string> Courses,
    ClashStatus Status,
    IReadOnlyList<CoursePair> Pairs,
    IReadOnlyList<Weekday> Days);

public sealed record ClashReport(
    int TotalStudents,
    int StudentsWithClashes,
    IReadOnlyList<StudentClash> Students)
{
    public int ClashFreeStudents => TotalStudents - StudentsWithClashes;
    public double ClashPercentage => TotalStudents == 0 ? 0 : Math.Round(StudentsWithClashes * 10000.0 / TotalStudents) / 100.0;
}

public static class ClashAnalyzer
{
    /// <summary>A student is RED when two different courses fall on one weekday. Each RED student counts once.</summary>
    public static ClashReport Analyze(Roster roster, IReadOnlyList<Section> sections, Timetable timetable)
    {
        ArgumentNullException.ThrowIfNull(roster);
        var byStudent = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var section in sections)
            foreach (string id in section.Students)
            {
                if (!byStudent.TryGetValue(id, out var list)) byStudent[id] = list = new();
                list.Add(section.CourseCode);
            }

        var result = new List<StudentClash>(roster.Students.Count);
        int red = 0;
        foreach (var student in roster.Students)
        {
            var byDay = new SortedDictionary<int, List<string>>();
            foreach (string code in byStudent.GetValueOrDefault(student.RegisterNumber) ?? [])
            {
                if (!timetable.TryDayOf(code, out int day)) continue;
                if (!byDay.TryGetValue(day, out var list)) byDay[day] = list = new();
                if (!list.Contains(code)) list.Add(code);
            }

            var pairs = new List<CoursePair>();
            var days = new List<Weekday>();
            foreach (var (day, codes) in byDay)
            {
                if (codes.Count < 2) continue;
                days.Add((Weekday)day);
                var sorted = codes.Order(StringComparer.Ordinal).ToList();
                for (int i = 0; i < sorted.Count; i++)
                    for (int j = i + 1; j < sorted.Count; j++)
                        pairs.Add(new CoursePair(sorted[i], sorted[j]));
            }

            bool isRed = pairs.Count > 0;
            if (isRed) red++;
            result.Add(new StudentClash(student.RegisterNumber, student.Name, student.Program, student.Courses,
                isRed ? ClashStatus.Red : ClashStatus.Green, pairs, days));
        }

        result.Sort((a, b) =>
        {
            int c = (a.Status == ClashStatus.Red ? 0 : 1).CompareTo(b.Status == ClashStatus.Red ? 0 : 1);
            return c != 0 ? c : string.CompareOrdinal(a.RegisterNumber, b.RegisterNumber);
        });
        return new ClashReport(result.Count, red, result);
    }
}

/// <summary>One row of the published timetable. <see cref="Lane"/> is a display-only parallel lane, not a distinct time.</summary>
public sealed record ScheduleEntry(
    string SectionId,
    string CourseCode,
    string CourseTitle,
    int SectionNumber,
    Weekday Day,
    int Lane,
    int LaneCount,
    string? Faculty,
    int Enrollment,
    string Programs);

public static class ScheduleBuilder
{
    public static IReadOnlyList<ScheduleEntry> Build(IReadOnlyList<Section> sections, Timetable timetable)
    {
        var entries = new List<(int Day, Section Section)>(sections.Count);
        foreach (var s in sections)
            entries.Add((timetable.TryDayOf(s.CourseCode, out int d) ? d : 0, s));
        entries.Sort((a, b) =>
        {
            int c = a.Day.CompareTo(b.Day);
            if (c != 0) return c;
            c = string.CompareOrdinal(a.Section.CourseCode, b.Section.CourseCode);
            return c != 0 ? c : a.Section.Number.CompareTo(b.Section.Number);
        });

        var counts = entries.GroupBy(e => e.Day).ToDictionary(g => g.Key, g => g.Count());
        var lane = new Dictionary<int, int>();
        var result = new List<ScheduleEntry>(entries.Count);
        foreach (var (day, s) in entries)
        {
            lane[day] = lane.GetValueOrDefault(day) + 1;
            result.Add(new ScheduleEntry(s.Id, s.CourseCode, s.CourseTitle, s.Number, (Weekday)day, lane[day], counts[day], s.Faculty,
                s.Students.Count, ProgramNames.Format(s.Programs)));
        }
        return result;
    }
}

public sealed record ScheduleMetrics(
    int TotalSections,
    IReadOnlyList<int> SectionsPerWeekday,
    int MaxParallel,
    double AverageParallel,
    int EmptyWeekdays,
    double BalanceL1);

public static class MetricsCalculator
{
    public static ScheduleMetrics Compute(IReadOnlyList<Section> sections, Timetable timetable, SchedulePolicy policy)
    {
        var loads = new int[policy.WeekdayCount];
        foreach (var s in sections)
            if (timetable.TryDayOf(s.CourseCode, out int d) && d >= 0 && d < loads.Length) loads[d]++;
        double ideal = sections.Count / (double)loads.Length;
        double l1 = loads.Sum(l => Math.Abs(l - ideal));
        return new ScheduleMetrics(sections.Count, loads, loads.Max(), sections.Count / (double)loads.Length, loads.Count(l => l == 0), l1);
    }
}

/// <summary>Short program labels for timetables ("B.Tech. CSE"), from a reference table with heuristic fallbacks.</summary>
public static partial class ProgramNames
{
    private static readonly Lazy<(IReadOnlyDictionary<string, string> Exact, IReadOnlyDictionary<string, string> Compact)> Table = new(LoadTable);

    private static readonly (string Key, string Abbr)[] Known =
    [
        ("computer science and engineering", "CSE"), ("computer science", "CS"),
        ("artificial intelligence and machine learning", "AIML"), ("artificial intelligence", "AI"), ("machine learning", "ML"),
        ("data science", "DS"), ("information technology", "IT"),
        ("electronics and communication engineering", "ECE"), ("electronics and communication", "ECE"),
        ("electrical and electronics engineering", "EEE"), ("mechanical engineering", "MECH"), ("civil engineering", "CIVIL"),
    ];

    private static readonly HashSet<string> SkipWords = new(["b", "tech", "m", "of", "and", "in", "the", "with", "engineering"], StringComparer.Ordinal);

    public static string Format(IEnumerable<string> programs)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var parts = new List<string>();
        foreach (string p in programs)
        {
            string abbr = Abbreviate(p);
            if (seen.Add(abbr)) parts.Add(abbr);
        }
        return string.Join(", ", parts);
    }

    public static string Abbreviate(string program)
    {
        if (string.IsNullOrWhiteSpace(program)) return "";
        string? mapped = Resolve(program);
        if (mapped is not null) return mapped;

        string lower = program.Trim().ToLowerInvariant();
        foreach (string prefix in new[] { "b.tech.-", "b.tech-", "b.tech.", "b.tech " })
            if (lower.StartsWith(prefix, StringComparison.Ordinal)) { lower = lower[prefix.Length..]; break; }
        foreach (var (key, abbr) in Known.OrderByDescending(k => k.Key.Length))
            if (lower.Contains(key, StringComparison.Ordinal)) return abbr;

        var caps = lower.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)
            .Where(w => !SkipWords.Contains(w) && w.Length > 1 && char.IsLetter(w[0]))
            .Select(w => char.ToUpperInvariant(w[0])).Take(4).ToArray();
        if (caps.Length > 0) return new string(caps);
        string head = program.Length > 6 ? program[..6] : program;
        return head.ToUpperInvariant();
    }

    private static string? Resolve(string program)
    {
        string basis = Normalize(program);
        string noDots = basis.Replace(".", "", StringComparison.Ordinal);
        string stripped = DegreePrefix().Replace(basis, "").Trim();
        string strippedNoDots = stripped.Replace(".", "", StringComparison.Ordinal);
        string[] candidates = [basis, noDots, Compact(basis), stripped, strippedNoDots, Compact(stripped)];
        var (exact, compact) = Table.Value;
        foreach (string c in candidates)
            if (c.Length > 0 && exact.TryGetValue(c, out string? v)) return v;
        foreach (string c in candidates)
        {
            string k = Compact(c);
            if (k.Length > 0 && compact.TryGetValue(k, out string? v)) return v;
        }
        return null;
    }

    private static string Normalize(string s)
    {
        string t = Dashes().Replace(s.Trim().ToLowerInvariant(), "-");
        t = Whitespace().Replace(t, " ");
        t = Hyphens().Replace(t, "-");
        return Dots().Replace(t, ".");
    }

    private static string Compact(string s) => NonAlphanumeric().Replace(s, "");

    private static (IReadOnlyDictionary<string, string>, IReadOnlyDictionary<string, string>) LoadTable()
    {
        var exact = new Dictionary<string, string>(StringComparer.Ordinal);
        var compact = new Dictionary<string, string>(StringComparer.Ordinal);
        using var stream = typeof(ProgramNames).Assembly.GetManifestResourceStream("UniSlot.Domain.program-abbreviations.json")
            ?? throw new InvalidOperationException("Embedded program table missing.");
        using var doc = JsonDocument.Parse(stream);
        foreach (var prop in doc.RootElement.EnumerateObject())
        {
            string value = prop.Value.GetString() ?? "";
            exact[prop.Name] = value;
            compact.TryAdd(Compact(prop.Name), value);
        }
        return (exact, compact);
    }

    [GeneratedRegex("[–—]")] private static partial Regex Dashes();
    [GeneratedRegex(@"\s+")] private static partial Regex Whitespace();
    [GeneratedRegex(@"\s*-\s*")] private static partial Regex Hyphens();
    [GeneratedRegex(@"\s*\.\s*")] private static partial Regex Dots();
    [GeneratedRegex("[^a-z0-9]+")] private static partial Regex NonAlphanumeric();
    [GeneratedRegex(@"^(b\.?tech|m\.?tech(\(integrated\))?|b\.?arch|b\.?des|int\.?\s*m\.?tech)\.?-?", RegexOptions.IgnoreCase)]
    private static partial Regex DegreePrefix();
}
