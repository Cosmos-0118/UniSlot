using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using UniSlot.Domain;

namespace UniSlot.Application.Importing;

public sealed record ValidationIssue(int? Row, string Field, string Code, string Message, string? Value = null);

public sealed record ValidationReport(
    bool IsValid,
    IReadOnlyList<ValidationIssue> Errors,
    IReadOnlyList<ValidationIssue> Warnings,
    int TotalRows,
    int ValidRows)
{
    public static ValidationReport Failed(string field, string code, string message) =>
        new(false, [new ValidationIssue(null, field, code, message)], [], 0, 0);
}

public sealed record ParsedEnrollment(IReadOnlyList<EnrollmentRow> Rows, ValidationReport Validation);

/// <summary>
/// Turns the first worksheet (as a grid of cells) into cleaned <see cref="EnrollmentRow"/>s. Column headers are matched by meaning
/// ("Reg No", "Register Number", "Roll no" …), the header row is detected, and each cell is cleaned and validated.
/// Text is kept in Unicode: names and titles in any script survive intact.
/// </summary>
public static partial class EnrollmentParser
{
    private static readonly (string Header, string Field)[] Synonyms =
    [
        ("program", "program"), ("programme", "program"), ("branch", "program"), ("dept", "program"), ("department", "program"),
        ("course", "program"), ("degree", "program"), ("stream", "program"),
        ("register number", "register_number"), ("register no", "register_number"), ("reg no", "register_number"),
        ("registration number", "register_number"), ("registration no", "register_number"), ("student id", "register_number"),
        ("regno", "register_number"), ("roll no", "register_number"), ("roll number", "register_number"), ("id", "register_number"),
        ("student name", "student_name"), ("name", "student_name"), ("full name", "student_name"), ("student", "student_name"),
        ("name of student", "student_name"),
        ("mobile number", "mobile_number"), ("mobile no", "mobile_number"), ("mobile", "mobile_number"), ("phone", "mobile_number"),
        ("contact", "mobile_number"),
        ("email id", "email_id"), ("email", "email_id"), ("email address", "email_id"),
        ("course code", "course_code"), ("code", "course_code"), ("subject code", "course_code"), ("course id", "course_code"),
        ("course title", "course_title"), ("title", "course_title"), ("course name", "course_title"), ("subject", "course_title"),
        ("faculty", "faculty"), ("faculty name", "faculty"), ("instructor", "faculty"), ("teacher", "faculty"),
        ("registration type", "registration_type"), ("remarks", "remarks"), ("adl remarks", "adl_remarks"),
        ("additional remarks", "adl_remarks"), ("comments", "remarks"),
    ];

    private static readonly string[] Required = ["program", "register_number", "student_name", "course_code", "course_title"];
    private static readonly string[] HeaderKeywords = ["register", "name", "course", "code", "program", "student", "branch"];

    public static ParsedEnrollment Parse(IReadOnlyList<IReadOnlyList<string?>> grid)
    {
        ArgumentNullException.ThrowIfNull(grid);
        if (grid.Count == 0)
            return new ParsedEnrollment([], ValidationReport.Failed("file", "workbook.empty", "The workbook is empty."));

        int headerIndex = DetectHeaderRow(grid);
        var headers = grid[headerIndex].Select(c => NormalizeHeader(c ?? "")).ToArray();
        FixRequiredHeaders(headers);

        var missing = Required.Where(f => !headers.Contains(f)).ToArray();
        if (missing.Length > 0)
        {
            string found = string.Join(", ", headers.Where(h => h.Length > 0).Distinct());
            return new ParsedEnrollment([], ValidationReport.Failed("columns", "columns.missing",
                $"Missing required columns: {string.Join(", ", missing)}. Found: {found}"));
        }

        var column = new Dictionary<string, int>(StringComparer.Ordinal);
        for (int i = 0; i < headers.Length; i++)
            if (headers[i].Length > 0) column.TryAdd(headers[i], i);

        var dataRows = new List<(int Number, IReadOnlyList<string?> Cells)>();
        for (int r = headerIndex + 1; r < grid.Count; r++)
            if (grid[r].Any(c => !string.IsNullOrWhiteSpace(c))) dataRows.Add((r + 1, grid[r]));

        string Cell(IReadOnlyList<string?> cells, string field) =>
            column.TryGetValue(field, out int i) && i < cells.Count ? cells[i] ?? "" : "";

        var rows = new List<EnrollmentRow>(dataRows.Count);
        var errors = new List<ValidationIssue>();
        foreach (var (number, cells) in dataRows)
        {
            string program = CleanProgram(Cell(cells, "program"));
            string register = CleanRegister(Cell(cells, "register_number"));
            string name = CleanName(Cell(cells, "student_name"));
            string code = CleanCourseCode(Cell(cells, "course_code"));
            string title = CleanText(Cell(cells, "course_title"));

            int before = errors.Count;
            if (program.Length == 0) errors.Add(new(number, "program", "program.empty", "Program is empty"));
            if (register.Length == 0) errors.Add(new(number, "register_number", "register.empty", "Register number is empty"));
            if (name.Length == 0) errors.Add(new(number, "student_name", "name.empty", "Student name is empty"));
            if (code.Length == 0) errors.Add(new(number, "course_code", "code.empty", "Course code is empty"));
            if (title.Length == 0) errors.Add(new(number, "course_title", "title.empty", "Course title is empty"));
            if (errors.Count > before) continue;

            rows.Add(new EnrollmentRow(program, register, name, CleanMobile(Cell(cells, "mobile_number")), CleanEmail(Cell(cells, "email_id")),
                code, CapitalizeWords(title), NullIfEmpty(CleanText(Cell(cells, "faculty"))), NullIfEmpty(CleanText(Cell(cells, "registration_type"))),
                NullIfEmpty(CleanText(Cell(cells, "remarks"))), NullIfEmpty(CleanText(Cell(cells, "adl_remarks")))));
        }

        int total = dataRows.Count;
        double errorRate = total == 0 ? 1 : errors.Count / (double)total;
        int maxErrors = Math.Max(12, (int)Math.Ceiling(total * 0.04));
        bool valid = errorRate <= 0.06 && errors.Count <= maxErrors && rows.Count > 0;
        if (rows.Count == 0 && errors.Count == 0)
            errors.Add(new(null, "file", "rows.none", "No enrollment data rows found below the header"));
        return new ParsedEnrollment(rows, new ValidationReport(valid, errors, [], total, rows.Count));
    }

    private static int DetectHeaderRow(IReadOnlyList<IReadOnlyList<string?>> grid)
    {
        for (int i = 0; i < Math.Min(10, grid.Count); i++)
        {
            string line = string.Join(' ', grid[i].Select(c => (c ?? "").ToLowerInvariant()));
            if (HeaderKeywords.Count(k => line.Contains(k, StringComparison.Ordinal)) >= 3) return i;
        }
        return 0;
    }

    /// <summary>Exact synonym first; otherwise the most specific synonym whose words are all present; otherwise a snake_case key.</summary>
    internal static string NormalizeHeader(string raw)
    {
        string cleaned = Whitespace().Replace(NonWord().Replace(raw, ""), " ").Trim().ToLowerInvariant();
        foreach (var (header, field) in Synonyms)
            if (header == cleaned) return field;

        var words = cleaned.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToHashSet(StringComparer.Ordinal);
        string? best = null;
        int bestWords = 0;
        foreach (var (header, field) in Synonyms)
        {
            var hw = header.Split(' ');
            if (hw.Length > bestWords && hw.All(words.Contains)) { best = field; bestWords = hw.Length; }
        }
        return best ?? cleaned.Replace(' ', '_');
    }

    private static void FixRequiredHeaders(string[] headers)
    {
        foreach (string required in Required)
        {
            if (headers.Contains(required)) continue;
            for (int i = 0; i < headers.Length; i++)
            {
                string h = headers[i];
                if (h.Length == 0 || Required.Contains(h)) continue;
                if (h.Contains(required, StringComparison.Ordinal) || required.Contains(h, StringComparison.Ordinal))
                {
                    headers[i] = required;
                    break;
                }
            }
        }
    }

    // ---- cell cleaning -------------------------------------------------------------------------------------------------

    private static string CleanText(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "";
        var sb = new StringBuilder(value.Length);
        foreach (char ch in value.Normalize(NormalizationForm.FormC))
            if (!char.IsControl(ch) || char.IsWhiteSpace(ch)) sb.Append(ch);
        return Whitespace().Replace(sb.ToString(), " ").Trim();
    }

    internal static string CleanRegister(string? value)
    {
        string s = CleanText(value);
        var sb = new StringBuilder(s.Length);
        foreach (char ch in s)
            if (ch is (>= 'A' and <= 'Z') or (>= 'a' and <= 'z') or (>= '0' and <= '9')) sb.Append(char.ToUpperInvariant(ch));
        return sb.ToString();
    }

    internal static string CleanCourseCode(string? value) =>
        Whitespace().Replace(CleanText(value), "").ToUpperInvariant();

    internal static string CleanName(string? value)
    {
        string s = CleanText(value);
        if (s.Length == 0) return "";
        s = RegisterLike().Replace(s, "");
        s = EmailLike().Replace(s, "");
        s = LongNumber().Replace(s, "");
        return CapitalizeWords(Whitespace().Replace(s, " ").Trim());
    }

    internal static string CleanProgram(string? value)
    {
        string s = CleanText(value);
        if (s.Length == 0) return "";
        s = BTech().Replace(s, "B.Tech");
        s = MTech().Replace(s, "M.Tech");
        s = Regex.Replace(s, "cse", "CSE", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        s = Regex.Replace(s, "ece", "ECE", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        s = Regex.Replace(s, "eee", "EEE", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        s = Regex.Replace(s, @"\bit\b", "IT", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        s = Regex.Replace(s, "aiml", "AIML", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        return s.Trim();
    }

    internal static string? CleanMobile(string? value)
    {
        string s = CleanText(value);
        if (s.Length == 0) return null;
        string digits = new(s.Where(char.IsAsciiDigit).ToArray());
        if (digits.Length == 12 && digits.StartsWith("91", StringComparison.Ordinal)) digits = digits[2..];
        else if (digits.Length == 11 && digits[0] == '0') digits = digits[1..];
        return digits.Length == 10 ? digits : null;
    }

    internal static string? CleanEmail(string? value)
    {
        string s = CleanText(value).ToLowerInvariant();
        if (s.Length == 0) return null;
        var m = EmailPattern().Match(s);
        return m.Success ? m.Value : null;
    }

    private static string? NullIfEmpty(string s) => s.Length == 0 ? null : s;

    /// <summary>Upper-cases the first letter of every word, leaving the rest as written (works for any script with case).</summary>
    internal static string CapitalizeWords(string s)
    {
        if (s.Length == 0) return s;
        var sb = new StringBuilder(s.Length);
        bool start = true;
        foreach (char ch in s)
        {
            sb.Append(start && char.IsLetter(ch) ? char.ToUpper(ch, CultureInfo.InvariantCulture) : ch);
            start = !(char.IsLetterOrDigit(ch) || ch == '_');
        }
        return sb.ToString();
    }

    [GeneratedRegex(@"[^\p{L}\p{N}_\s]")] private static partial Regex NonWord();
    [GeneratedRegex(@"\s+")] private static partial Regex Whitespace();
    [GeneratedRegex(@"\b[A-Za-z]{2}\d+[A-Za-z]*\d*\b")] private static partial Regex RegisterLike();
    [GeneratedRegex(@"\S+@\S+\.\S+")] private static partial Regex EmailLike();
    [GeneratedRegex(@"\b\d{10,}\b")] private static partial Regex LongNumber();
    [GeneratedRegex(@"[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}")] private static partial Regex EmailPattern();
    [GeneratedRegex(@"b\.?\s*tech\.?", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)] private static partial Regex BTech();
    [GeneratedRegex(@"m\.?\s*tech\.?", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)] private static partial Regex MTech();
}
