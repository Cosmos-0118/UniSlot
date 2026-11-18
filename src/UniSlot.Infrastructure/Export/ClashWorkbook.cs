using ClosedXML.Excel;
using UniSlot.Application.Workflow;
using UniSlot.Domain;

namespace UniSlot.Infrastructure.Export;

internal static class ClashWorkbook
{
    public static XLWorkbook Build(SolveOutcome o, ExportOptions options)
    {
        var wb = new XLWorkbook();
        Summary(wb, o, options);
        ClashesOnly(wb, o, options);
        ByProgram(wb, o, options);
        ByDay(wb, o, options);
        FullReport(wb, o, options);
        return wb;
    }

    private static string Pairs(StudentClash s) => string.Join("; ", s.Pairs.Select(p => $"{p.A} & {p.B}"));
    private static string Days(StudentClash s) => string.Join(", ", s.Days);

    private static void Summary(XLWorkbook wb, SolveOutcome o, ExportOptions options)
    {
        var ws = wb.AddWorksheet("Summary");
        Styling.TitleBlock(ws, options, "CLASH REPORT", 3);
        var c = o.Clash;
        bool clean = c.StudentsWithClashes == 0;
        ws.Cell(4, 1).Value = clean ? "ALL CLEAR — every student has a clash-free timetable" : $"ATTENTION REQUIRED — {c.StudentsWithClashes} Students Have Conflicts";
        var banner = ws.Range(4, 1, 4, 3);
        banner.Merge();
        banner.Style.Font.Bold = true;
        banner.Style.Fill.BackgroundColor = clean ? Styling.GreenFill : Styling.RedFill;
        banner.Style.Font.FontColor = clean ? Styling.GreenText : Styling.RedText;
        banner.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
        ws.Row(4).Height = 26;

        Styling.Header(ws, 6, "Metric", "Value", "Note");
        var rows = new (string, object, string)[]
        {
            ("Total students", c.TotalStudents, ""),
            ("Students without a clash", c.ClashFreeStudents, ""),
            ("Students with a clash (RED)", c.StudentsWithClashes, $"{c.ClashPercentage}% of students"),
            ("Structural minimum", o.Bounds.MinRedStudents, "No timetable can do better than this for the given enrollments"),
            ("Clash weight", o.ClashWeight, "Conflicting course pairs weighted by shared students"),
        };
        int r = 7;
        foreach (var (m, v, n) in rows)
        {
            ws.Cell(r, 1).Value = m;
            Styling.Set(ws.Cell(r, 2), v);
            ws.Cell(r, 2).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Left;
            ws.Cell(r, 3).Value = n;
            r++;
        }
        Styling.Body(ws, 7, r - 1, 3);
        Styling.Widths(ws, 34, 16, 66);
    }

    private static void ClashesOnly(XLWorkbook wb, SolveOutcome o, ExportOptions options)
    {
        var ws = wb.AddWorksheet("Clashes Only");
        const int cols = 7;
        var red = o.Clash.Students.Where(s => s.Status == ClashStatus.Red).ToList();
        Styling.TitleBlock(ws, options, $"STUDENTS WITH SCHEDULING CONFLICTS ({red.Count})", cols);
        Styling.Header(ws, 4, "S.No", "Register No.", "Student Name", "Program", "Enrolled Courses", "Clashing Courses", "Clash Day");
        int r = 5, n = 1;
        foreach (var s in red)
        {
            Styling.Set(ws.Cell(r, 1), n++);
            ws.Cell(r, 2).Value = s.RegisterNumber;
            ws.Cell(r, 3).Value = s.Name;
            ws.Cell(r, 4).Value = s.Program;
            ws.Cell(r, 5).Value = string.Join(", ", s.Courses);
            ws.Cell(r, 6).Value = Pairs(s);
            ws.Cell(r, 7).Value = Days(s);
            r++;
        }
        Styling.Body(ws, 5, r - 1, cols);
        Styling.Widths(ws, 7, 18, 28, 36, 48, 52, 18);
        ws.SheetView.FreezeRows(4);
    }

    private static void ByProgram(XLWorkbook wb, SolveOutcome o, ExportOptions options)
    {
        var ws = wb.AddWorksheet("By Program");
        const int cols = 5;
        Styling.TitleBlock(ws, options, "CLASHES BY PROGRAM", cols);
        int r = 4;
        foreach (var g in o.Clash.Students.Where(s => s.Status == ClashStatus.Red).GroupBy(s => s.Program).OrderBy(g => g.Key, StringComparer.Ordinal))
        {
            ws.Cell(r, 1).Value = $"{g.Key} — {g.Count()} students with clashes";
            var band = ws.Range(r, 1, r, cols);
            band.Merge();
            band.Style.Font.Bold = true;
            band.Style.Fill.BackgroundColor = Styling.Band;
            r++;
            Styling.Header(ws, r++, "#", "Register No.", "Name", "Clashing Courses", "Day");
            int first = r, i = 1;
            foreach (var s in g)
            {
                Styling.Set(ws.Cell(r, 1), i++);
                ws.Cell(r, 2).Value = s.RegisterNumber;
                ws.Cell(r, 3).Value = s.Name;
                ws.Cell(r, 4).Value = Pairs(s);
                ws.Cell(r, 5).Value = Days(s);
                r++;
            }
            Styling.Body(ws, first, r - 1, cols);
            r++;
        }
        Styling.Widths(ws, 7, 18, 28, 60, 18);
    }

    private static void ByDay(XLWorkbook wb, SolveOutcome o, ExportOptions options)
    {
        var ws = wb.AddWorksheet("By Day");
        const int cols = 5;
        Styling.TitleBlock(ws, options, "CLASHES BY DAY", cols);
        int r = 4;
        var red = o.Clash.Students.Where(s => s.Status == ClashStatus.Red).ToList();
        foreach (var day in Enum.GetValues<Weekday>())
        {
            var students = red.Where(s => s.Days.Contains(day)).ToList();
            if (students.Count == 0) continue;
            ws.Cell(r, 1).Value = $"{day.ToString().ToUpperInvariant()} — {students.Count} clashes";
            var band = ws.Range(r, 1, r, cols);
            band.Merge();
            band.Style.Font.Bold = true;
            band.Style.Fill.BackgroundColor = Styling.Band;
            r++;
            Styling.Header(ws, r++, "#", "Register No.", "Name", "Program", "Clashing Courses");
            int first = r, i = 1;
            foreach (var s in students)
            {
                Styling.Set(ws.Cell(r, 1), i++);
                ws.Cell(r, 2).Value = s.RegisterNumber;
                ws.Cell(r, 3).Value = s.Name;
                ws.Cell(r, 4).Value = s.Program;
                ws.Cell(r, 5).Value = Pairs(s);
                r++;
            }
            Styling.Body(ws, first, r - 1, cols);
            r++;
        }
        Styling.Widths(ws, 7, 18, 28, 36, 60);
    }

    private static void FullReport(XLWorkbook wb, SolveOutcome o, ExportOptions options)
    {
        var ws = wb.AddWorksheet("Full Report");
        const int cols = 7;
        Styling.TitleBlock(ws, options, "FULL STUDENT REPORT", cols);
        Styling.Header(ws, 4, "S.No", "Register No.", "Student Name", "Program", "Status", "Enrolled Courses", "Clashing Courses");
        int r = 5, n = 1;
        foreach (var s in o.Clash.Students)
        {
            Styling.Set(ws.Cell(r, 1), n++);
            ws.Cell(r, 2).Value = s.RegisterNumber;
            ws.Cell(r, 3).Value = s.Name;
            ws.Cell(r, 4).Value = s.Program;
            ws.Cell(r, 5).Value = s.Status == ClashStatus.Red ? "RED" : "GREEN";
            ws.Cell(r, 5).Style.Font.Bold = true;
            ws.Cell(r, 5).Style.Font.FontColor = s.Status == ClashStatus.Red ? Styling.RedText : Styling.GreenText;
            ws.Cell(r, 6).Value = string.Join(", ", s.Courses);
            ws.Cell(r, 7).Value = Pairs(s);
            r++;
        }
        Styling.Body(ws, 5, r - 1, cols);
        Styling.Widths(ws, 7, 18, 28, 36, 10, 48, 52);
        ws.SheetView.FreezeRows(4);
        ws.Range(4, 1, Math.Max(4, r - 1), cols).SetAutoFilter();
    }
}
