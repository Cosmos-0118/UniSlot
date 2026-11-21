using UniSlot.Domain;

namespace UniSlot.Application.Importing;

public enum IssueCategory { Schema, MissingFields, Duplicates, Faculty, Identity }

public sealed record Issue(IssueCategory Category, bool Blocking, int? Row, string Message);

public sealed record IssueReport(IReadOnlyList<Issue> Issues, int TotalRows, int UsableRows)
{
    public bool HasBlocking => Issues.Any(i => i.Blocking);

    public IReadOnlyDictionary<IssueCategory, int> Counts =>
        Issues.GroupBy(i => i.Category).ToDictionary(g => g.Key, g => g.Count());
}

/// <summary>Audits an enrollment sheet for data-quality problems without running the solver.</summary>
public static class IssueFinder
{
    public static IssueReport Find(IReadOnlyList<IReadOnlyList<string?>> grid)
    {
        var parsed = EnrollmentParser.Parse(grid);
        var issues = new List<Issue>();
        var v = parsed.Validation;

        foreach (var e in v.Errors)
        {
            bool schema = e.Row is null;
            issues.Add(new Issue(schema ? IssueCategory.Schema : IssueCategory.MissingFields, schema || !v.IsValid, e.Row, e.Message));
        }
        if (parsed.Rows.Count == 0) return new IssueReport(issues, v.TotalRows, 0);

        var seen = new HashSet<(string, string)>();
        var duplicates = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var r in parsed.Rows)
            if (!seen.Add((r.RegisterNumber, r.CourseCode))) duplicates.Add($"{r.RegisterNumber} · {r.CourseCode}");
        foreach (string d in duplicates)
            issues.Add(new Issue(IssueCategory.Duplicates, false, null, $"Duplicate registration: {d}. Only one copy is kept."));

        foreach (var g in parsed.Rows.Where(r => !string.IsNullOrWhiteSpace(r.Faculty)).GroupBy(r => r.CourseCode, StringComparer.Ordinal).OrderBy(g => g.Key, StringComparer.Ordinal))
        {
            var names = g.Select(r => r.Faculty!.Trim()).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToList();
            if (names.Count > 1) issues.Add(new Issue(IssueCategory.Faculty, false, null, $"Course {g.Key} lists several faculty: {string.Join(" · ", names)}. The first is used."));
        }

        foreach (var g in parsed.Rows.GroupBy(r => r.RegisterNumber, StringComparer.Ordinal).OrderBy(g => g.Key, StringComparer.Ordinal))
        {
            var names = g.Select(r => r.StudentName).Distinct(StringComparer.Ordinal).ToList();
            if (names.Count > 1) issues.Add(new Issue(IssueCategory.Identity, false, null, $"Register number {g.Key} has different names: {string.Join(" · ", names)}."));
        }
        foreach (var g in parsed.Rows.GroupBy(r => r.CourseCode, StringComparer.Ordinal).OrderBy(g => g.Key, StringComparer.Ordinal))
        {
            var titles = g.Select(r => r.CourseTitle).Distinct(StringComparer.Ordinal).ToList();
            if (titles.Count > 1) issues.Add(new Issue(IssueCategory.Identity, false, null, $"Course {g.Key} has different titles: {string.Join(" · ", titles)}."));
        }

        return new IssueReport(issues, v.TotalRows, parsed.Rows.Count);
    }
}
