using ClosedXML.Excel;
using UniSlot.Application.Workflow;

namespace UniSlot.Infrastructure.Export;

internal static class EmailsWorkbook
{
    public static XLWorkbook Build(SolveOutcome o, ExportOptions options)
    {
        var wb = new XLWorkbook();

        var ws = wb.AddWorksheet("Course Emails");
        Styling.TitleBlock(ws, options, "COURSE EMAIL GROUPS", 5);
        Styling.Header(ws, 4, "Course Code", "Course Title", "Student Count", "Email Count", "Emails");
        var rowsByCourse = o.Roster.Rows.GroupBy(r => r.CourseCode, StringComparer.Ordinal).ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);
        int r = 5;
        foreach (var course in o.Roster.Courses.OrderBy(c => c.Code, StringComparer.Ordinal))
        {
            var rows = rowsByCourse[course.Code];
            var emails = rows.Select(x => x.Email).Where(e => !string.IsNullOrWhiteSpace(e)).Select(e => e!.Trim().ToLowerInvariant())
                .Distinct(StringComparer.Ordinal).ToList();
            ws.Cell(r, 1).Value = course.Code;
            ws.Cell(r, 2).Value = course.Title;
            Styling.Set(ws.Cell(r, 3), rows.Count);
            Styling.Set(ws.Cell(r, 4), emails.Count);
            ws.Cell(r, 5).Value = string.Join("; ", emails);
            r++;
        }
        Styling.Body(ws, 5, r - 1, 5);
        Styling.Widths(ws, 16, 52, 14, 12, 80);
        ws.SheetView.FreezeRows(4);

        var missing = wb.AddWorksheet("Missing Emails");
        Styling.TitleBlock(missing, options, "STUDENTS WITHOUT EMAIL", 5);
        Styling.Header(missing, 4, "Course Code", "Course Title", "Register Number", "Student Name", "Program");
        int m = 5;
        foreach (var row in o.Roster.Rows.Where(x => string.IsNullOrWhiteSpace(x.Email)).OrderBy(x => x.CourseCode, StringComparer.Ordinal)
                     .ThenBy(x => x.RegisterNumber, StringComparer.Ordinal))
        {
            missing.Cell(m, 1).Value = row.CourseCode;
            missing.Cell(m, 2).Value = row.CourseTitle;
            missing.Cell(m, 3).Value = row.RegisterNumber;
            missing.Cell(m, 4).Value = row.StudentName;
            missing.Cell(m, 5).Value = row.Program;
            m++;
        }
        Styling.Body(missing, 5, m - 1, 5);
        Styling.Widths(missing, 16, 52, 18, 28, 40);
        missing.SheetView.FreezeRows(4);
        return wb;
    }
}
