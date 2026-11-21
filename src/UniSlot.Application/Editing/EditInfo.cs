using UniSlot.Domain;

namespace UniSlot.Application.Workflow;

/// <summary>One registration touched by an edit. <see cref="Kind"/> is added, removed, moved, restored or parked.</summary>
public sealed record ParkedItem(string Register, string Course, string Reason);

public sealed record WaiverItem(string SectionId, int Enrollment, int Capacity);

public sealed record EditChange(string Register, string Name, string Course, string Kind, string Detail);

/// <summary>What an edit run (late enrollment, rectify, fix, drop, revert) did, carried with the outcome for logs and reports.</summary>
public sealed record EditInfo
{
    public required string Mode { get; init; }
    /// <summary>Earlier run-log entries, each a JSON object, oldest first. The new entry is appended when the snapshot is written.</summary>
    public IReadOnlyList<string> PriorRunLog { get; init; } = [];
    public ClashReport? PreviousClash { get; init; }
    public int StudentsBefore { get; init; }
    public int RegistrationsAdded { get; init; }
    public int RegistrationsRemoved { get; init; }
    public int CoursesAdded { get; init; }
    public IReadOnlyList<string> SectionsCreated { get; init; } = [];
    public IReadOnlyList<ParkedItem> Parked { get; init; } = [];
    /// <summary>Sections deliberately filled beyond their capacity.</summary>
    public IReadOnlyList<WaiverItem> Waivers { get; init; } = [];
    public IReadOnlyList<EditChange> Changes { get; init; } = [];
    public IReadOnlyList<string> Notes { get; init; } = [];
    public IReadOnlyDictionary<string, string> Inputs { get; init; } = new Dictionary<string, string>();
}

public sealed record ClashEntry(string Register, string Name, Weekday Day, IReadOnlyList<string> Courses);

public sealed record ClashDelta(IReadOnlyList<ClashEntry> Introduced, IReadOnlyList<ClashEntry> CarriedOver, IReadOnlyList<ClashEntry> Resolved);

public static class ClashDiff
{
    /// <summary>Compares per (student, weekday) so an edit can show only the clashes it caused or cured.</summary>
    public static ClashDelta Compare(ClashReport before, ClashReport after)
    {
        var b = Entries(before);
        var a = Entries(after);
        static int Order(ClashEntry x, ClashEntry y) => string.CompareOrdinal(x.Register, y.Register) is var c and not 0 ? c : x.Day.CompareTo(y.Day);
        var introduced = a.Where(kv => !b.ContainsKey(kv.Key)).Select(kv => kv.Value).ToList();
        var carried = a.Where(kv => b.ContainsKey(kv.Key)).Select(kv => kv.Value).ToList();
        var resolved = b.Where(kv => !a.ContainsKey(kv.Key)).Select(kv => kv.Value).ToList();
        introduced.Sort(Order); carried.Sort(Order); resolved.Sort(Order);
        return new ClashDelta(introduced, carried, resolved);
    }

    private static Dictionary<(string, Weekday), ClashEntry> Entries(ClashReport report)
    {
        var map = new Dictionary<(string, Weekday), ClashEntry>();
        foreach (var s in report.Students.Where(s => s.Status == ClashStatus.Red))
        {
            var courses = s.Pairs.SelectMany(p => new[] { p.A, p.B }).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToList();
            foreach (var day in s.Days) map[(s.RegisterNumber, day)] = new ClashEntry(s.RegisterNumber, s.Name, day, courses);
        }
        return map;
    }
}
