using System.Globalization;
using ClosedXML.Excel;
using UniSlot.Application.Workflow;
using UniSlot.Domain;

namespace UniSlot.Infrastructure.Export;

internal static class ScheduleWorkbook
{
    public static XLWorkbook Build(SolveOutcome o, ExportOptions options)
    {
        var wb = new XLWorkbook();
        Schedule(wb, o, options);
        Details(wb, o, options);
        ByProgram(wb, o, options);
        StudentTimetables(wb, o, options);
        Summary(wb, o, options);
        return wb;
    }

    private static string Timing(ScheduleEntry e) =>
        $"{e.Day} 5:00–7:00 PM (Parallel lane {e.Lane.ToString(CultureInfo.InvariantCulture)}/{e.LaneCount.ToString(CultureInfo.InvariantCulture)})";

    private static void Schedule(XLWorkbook wb, SolveOutcome o, ExportOptions options)
    {
        var ws = wb.AddWorksheet("Schedule");
        const int cols = 7;
        Styling.TitleBlock(ws, options, $"WEEKLY TIMETABLE · EVENING SESSION {SchedulePolicy.SessionWindow}", cols);
        Styling.Header(ws, 4, "Lane", "Course Code", "Course Title", "Section", "Students", "Programs", "Faculty");

        var studentsByDay = o.Sections.GroupBy(s => o.Timetable.DayOf(s.CourseCode))
            .ToDictionary(g => g.Key, g => g.SelectMany(s => s.Students).Distinct(StringComparer.Ordinal).Count());
        int row = 5;
        foreach (var day in o.Schedule.GroupBy(e => e.Day).OrderBy(g => g.Key))
        {
            string band = $"{day.Key.ToString().ToUpperInvariant()} — {day.Count()} sections | {studentsByDay.GetValueOrDefault((int)day.Key)} students";
            ws.Cell(row, 1).Value = band;
            var bandRange = ws.Range(row, 1, row, cols);
            bandRange.Merge();
            bandRange.Style.Font.Bold = true;
            bandRange.Style.Fill.BackgroundColor = Styling.Band;
            row++;
            int first = row;
            foreach (var e in day)
            {
                Styling.Set(ws.Cell(row, 1), e.Lane);
                ws.Cell(row, 2).Value = e.CourseCode;
                ws.Cell(row, 3).Value = e.CourseTitle;
                Styling.Set(ws.Cell(row, 4), e.SectionNumber);
                Styling.Set(ws.Cell(row, 5), e.Enrollment);
                ws.Cell(row, 6).Value = e.Programs;
                ws.Cell(row, 7).Value = e.Faculty ?? "";
                row++;
            }
            Styling.Body(ws, first, row - 1, cols);
        }
        Styling.Widths(ws, 8, 16, 52, 9, 10, 28, 30);
        ws.SheetView.FreezeRows(4);
    }

    /// <summary>Machine-readable sheet; the headers and the "Parallel lane n/N" timing text are a stable contract with older UniSlot tooling.</summary>
    private static void Details(XLWorkbook wb, SolveOutcome o, ExportOptions options)
    {
        var ws = wb.AddWorksheet("Details");
        const int cols = 12;
        Styling.TitleBlock(ws, options, "TECHNICAL DETAILS (Weekday / Parallel Lane / Section ID)", cols);
        Styling.Header(ws, 4, "S.No", "Course Code", "Course Title", "Section", "Section ID", "Day", "Timing", "Weekday Index", "Parallel Lane",
            "Students", "Faculty", "Programs");
        int row = 5, n = 1;
        foreach (var e in o.Schedule)
        {
            Styling.Set(ws.Cell(row, 1), n++);
            ws.Cell(row, 2).Value = e.CourseCode;
            ws.Cell(row, 3).Value = e.CourseTitle;
            Styling.Set(ws.Cell(row, 4), e.SectionNumber);
            ws.Cell(row, 5).Value = e.SectionId;
            ws.Cell(row, 6).Value = e.Day.ToString();
            ws.Cell(row, 7).Value = Timing(e);
            Styling.Set(ws.Cell(row, 8), (int)e.Day);
            Styling.Set(ws.Cell(row, 9), e.Lane);
            Styling.Set(ws.Cell(row, 10), e.Enrollment);
            ws.Cell(row, 11).Value = e.Faculty ?? "";
            ws.Cell(row, 12).Value = e.Programs;
            row++;
        }
        Styling.Body(ws, 5, row - 1, cols);
        Styling.Widths(ws, 7, 16, 52, 9, 18, 12, 44, 14, 14, 10, 28, 28);
        ws.SheetView.FreezeRows(4);
    }

    private static void ByProgram(XLWorkbook wb, SolveOutcome o, ExportOptions options)
    {
        var ws = wb.AddWorksheet("By Program");
        const int cols = 6;
        Styling.TitleBlock(ws, options, "SCHEDULE BY PROGRAM", cols);
        var sectionById = o.Sections.ToDictionary(s => s.Id, StringComparer.Ordinal);
        var byProgram = new SortedDictionary<string, List<ScheduleEntry>>(StringComparer.Ordinal);
        foreach (var e in o.Schedule)
            foreach (string program in sectionById[e.SectionId].Programs.Select(ProgramNames.Abbreviate).Distinct(StringComparer.Ordinal))
            {
                if (!byProgram.TryGetValue(program, out var list)) byProgram[program] = list = new();
                list.Add(e);
            }

        int row = 4;
        foreach (var (program, entries) in byProgram)
        {
            ws.Cell(row, 1).Value = $"{program.ToUpperInvariant()} — {entries.Select(e => e.CourseCode).Distinct().Count()} courses";
            var band = ws.Range(row, 1, row, cols);
            band.Merge();
            band.Style.Font.Bold = true;
            band.Style.Fill.BackgroundColor = Styling.Band;
            row++;
            Styling.Header(ws, row++, "#", "Course Code", "Course Title", "Day", "Time", "Enrollment");
            int first = row, i = 1;
            foreach (var e in entries.OrderBy(e => e.Day).ThenBy(e => e.CourseCode, StringComparer.Ordinal).ThenBy(e => e.SectionNumber))
            {
                Styling.Set(ws.Cell(row, 1), i++);
                ws.Cell(row, 2).Value = e.CourseCode;
                ws.Cell(row, 3).Value = e.CourseTitle;
                ws.Cell(row, 4).Value = e.Day.ToString();
                ws.Cell(row, 5).Value = Timing(e);
                Styling.Set(ws.Cell(row, 6), e.Enrollment);
                row++;
            }
            Styling.Body(ws, first, row - 1, cols);
            row++;
        }
        Styling.Widths(ws, 6, 16, 52, 12, 44, 12);
    }

    private static void StudentTimetables(XLWorkbook wb, SolveOutcome o, ExportOptions options)
    {
        var ws = wb.AddWorksheet("Students");
        const int cols = 7;
        Styling.TitleBlock(ws, options, "STUDENT TIMETABLES (one row per registration)", cols);
        Styling.Header(ws, 4, "Register No.", "Student Name", "Program", "Course Code", "Course Title", "Day", "Clash");
        var clashByStudent = o.Clash.Students.ToDictionary(s => s.RegisterNumber, StringComparer.Ordinal);
        int row = 5;
        foreach (var student in o.Roster.Students)
        {
            var clash = clashByStudent[student.RegisterNumber];
            foreach (string code in student.Courses.OrderBy(c => o.Timetable.DayOf(c)).ThenBy(c => c, StringComparer.Ordinal))
            {
                var day = (Weekday)o.Timetable.DayOf(code);
                bool clashing = clash.Days.Contains(day);
                ws.Cell(row, 1).Value = student.RegisterNumber;
                ws.Cell(row, 2).Value = student.Name;
                ws.Cell(row, 3).Value = student.Program;
                ws.Cell(row, 4).Value = code;
                ws.Cell(row, 5).Value = o.Roster.Course(code).Title;
                ws.Cell(row, 6).Value = day.ToString();
                ws.Cell(row, 7).Value = clashing ? "CLASH" : "";
                if (clashing)
                {
                    ws.Range(row, 1, row, cols).Style.Fill.BackgroundColor = Styling.RedFill;
                    ws.Cell(row, 7).Style.Font.FontColor = Styling.RedText;
                    ws.Cell(row, 7).Style.Font.Bold = true;
                }
                row++;
            }
        }
        Styling.Widths(ws, 18, 28, 36, 16, 48, 12, 10);
        ws.SheetView.FreezeRows(4);
        ws.Range(4, 1, Math.Max(4, row - 1), cols).SetAutoFilter();
    }

    private static void Summary(XLWorkbook wb, SolveOutcome o, ExportOptions options)
    {
        var ws = wb.AddWorksheet("Summary");
        Styling.TitleBlock(ws, options, "SUMMARY", 3);
        Styling.Header(ws, 4, "Metric", "Value", "Note");
        var loads = o.Metrics.SectionsPerWeekday;
        var rows = new List<(string, object, string)>
        {
            ("Students", o.Roster.Students.Count, ""),
            ("Courses", o.Roster.Courses.Count, ""),
            ("Sections", o.Sections.Count, "Courses over 64 students are split into sections of 60"),
            ("Students with a clash (RED)", o.RedStudents, $"Structural minimum: at least {o.Bounds.MinRedStudents}"),
            ("Clash weight", o.ClashWeight, $"Structural minimum: at least {o.Bounds.MinClashWeight}"),
            ("Hard-constraint audit", o.Audit.IsStructurallyFeasible ? "Passed" : $"{o.Audit.Structural.Count} violation(s)", ""),
            ("RED proven optimal", o.RedProvenOptimal ? "Yes" : "No", o.Proof is null ? "No proof stage was run" : $"Proven lower bound {o.Proof.RedLowerBound}"),
            ("Engine", o.Search.Engine + (o.Proof is null ? "" : " + " + o.Proof.Engine), $"Reproduce with {o.Search.Options.ReproToken}"),
            ("Weekday balance (L1)", Math.Round(o.Metrics.BalanceL1, 2), "Lower is more even"),
            ("Largest parallel load", o.Metrics.MaxParallel, $"Comfort target {o.Settings.Policy.PreferredParallel} per weekday"),
        };
        for (int d = 0; d < loads.Count; d++) rows.Add(($"Sections on {(Weekday)d}", loads[d], ""));

        int r = 5;
        foreach (var (metric, value, note) in rows)
        {
            ws.Cell(r, 1).Value = metric;
            Styling.Set(ws.Cell(r, 2), value);
            ws.Cell(r, 3).Value = note;
            ws.Cell(r, 2).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Left;
            r++;
        }
        Styling.Body(ws, 5, r - 1, 3);
        Styling.Widths(ws, 34, 22, 64);
    }
}
