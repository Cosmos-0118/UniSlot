using System.Text.Json;
using ClosedXML.Excel;
using UniSlot.Application.Importing;
using UniSlot.Application.Planning;
using UniSlot.Application.Workflow;
using UniSlot.Domain;
using UniSlot.Infrastructure;
using UniSlot.Infrastructure.Export;
using UniSlot.Solver;

namespace UniSlot.Tests;

public class ParserTests
{
    private static IReadOnlyList<string?> Row(string program, string reg, string name, string code, string title) =>
        [program, reg, name, "9876543210", "a@b.co", code, title, null];

    [Fact]
    public void Maps_header_synonyms_and_skips_title_rows()
    {
        var grid = new List<IReadOnlyList<string?>>
        {
            new string?[] { "Name list report", null, null },
            new string?[] { "Branch", "Reg No", "Student", "Phone", "Email", "Subject Code", "Subject" },
            new string?[] { "b.tech cse", "ra11 22", "ravi kumar", "+91 98765 43210", "RAVI@Example.COM", "21 cs 101 t", "data science", },
        };
        var parsed = EnrollmentParser.Parse(grid);
        Assert.True(parsed.Validation.IsValid);
        var row = Assert.Single(parsed.Rows);
        Assert.Equal("RA1122", row.RegisterNumber);
        Assert.Equal("21CS101T", row.CourseCode);
        Assert.Equal("B.Tech CSE", row.Program);
        Assert.Equal("9876543210", row.Mobile);
        Assert.Equal("ravi@example.com", row.Email);
        Assert.Equal("Data Science", row.CourseTitle);
    }

    [Fact]
    public void Preserves_names_in_any_script()
    {
        var grid = new List<IReadOnlyList<string?>>
        {
            TestData.Header,
            Row("B.Tech", "RA1", "அருண் குமார்", "C1", "t"),
            Row("B.Tech", "RA2", "José Ñandú", "C1", "t"),
            Row("B.Tech", "RA3", "田中 太郎", "C1", "t"),
        };
        var names = EnrollmentParser.Parse(grid).Rows.Select(r => r.StudentName).ToArray();
        Assert.Equal(["அருண் குமார்", "José Ñandú", "田中 太郎"], names);
    }

    [Fact]
    public void Rejects_a_workbook_missing_required_columns()
    {
        var parsed = EnrollmentParser.Parse([new string?[] { "Foo", "Bar" }, new string?[] { "1", "2" }]);
        Assert.False(parsed.Validation.IsValid);
        Assert.Contains("Missing required columns", parsed.Validation.Errors[0].Message);
    }

    [Fact]
    public void Rejects_an_empty_workbook() =>
        Assert.False(EnrollmentParser.Parse([]).Validation.IsValid);

    [Fact]
    public void Tolerates_a_few_bad_rows_but_not_many()
    {
        var good = Enumerable.Range(0, 200).Select(i => Row("B.Tech", $"RA{i}", $"name {i}", "C1", "t")).ToList();
        var grid = new List<IReadOnlyList<string?>> { TestData.Header };
        grid.AddRange(good);
        grid.Add(Row("", "RA999", "x", "C1", "t")); // one bad row
        Assert.True(EnrollmentParser.Parse(grid).Validation.IsValid);

        var bad = new List<IReadOnlyList<string?>> { TestData.Header };
        bad.AddRange(good.Take(20));
        bad.AddRange(Enumerable.Range(0, 30).Select(i => Row("", $"RB{i}", "x", "C1", "t")));
        Assert.False(EnrollmentParser.Parse(bad).Validation.IsValid);
    }

    [Fact]
    public void Duplicate_registrations_become_warnings_not_rows()
    {
        var grid = new List<IReadOnlyList<string?>> { TestData.Header, Row("B", "RA1", "a", "C1", "t"), Row("B", "RA1", "a", "C1", "t"), Row("B", "RA1", "a", "C2", "u") };
        var roster = RosterBuilder.Build(EnrollmentParser.Parse(grid));
        Assert.Equal(2, roster.Roster!.Rows.Count);
        Assert.Contains(roster.Validation.Warnings, w => w.Code == "registration.duplicate");
        Assert.Equal(["C1", "C2"], roster.Roster.Student("RA1").Courses);
    }
}

public class PlannerTests
{
    private static Roster RosterOf(int courseSize) => TestData.Roster(TestData.Grid(courseSize, 1, 1, seed: 1));

    [Theory]
    [InlineData(1, 1, 64)]
    [InlineData(64, 1, 64)]
    [InlineData(65, 2, 60)]
    [InlineData(120, 2, 60)]
    [InlineData(121, 3, 60)]
    [InlineData(190, 4, 60)]
    public void Splits_courses_by_capacity(int students, int sections, int capacity)
    {
        var planned = SectionPlanner.Plan(RosterOf(students));
        Assert.Equal(sections, planned.Count);
        Assert.All(planned, s => Assert.Equal(capacity, s.Capacity));
        Assert.Equal(sections > 1 ? "21CS000T_S1" : "21CS000T", planned[0].Id);
    }

    [Fact]
    public void Every_enrolment_lands_in_exactly_one_section_and_loads_are_balanced()
    {
        var roster = RosterOf(190);
        var planned = SectionPlanner.Plan(roster);
        var all = planned.SelectMany(s => s.Students).ToList();
        Assert.Equal(190, all.Count);
        Assert.Equal(190, all.Distinct().Count());
        Assert.InRange(planned.Max(s => s.Students.Count) - planned.Min(s => s.Students.Count), 0, 1);
        Assert.All(planned, s => Assert.True(s.Students.Count <= s.Capacity));
    }

    [Fact]
    public void Unnamed_sections_get_planning_placeholders_and_named_faculty_stays_on_the_first()
    {
        var grid = TestData.Grid(70, 1, 1, seed: 2);
        for (int i = 1; i < grid.Count; i++) { var r = grid[i].ToArray(); r[7] = "Dr Rao"; grid[i] = r; }
        var planned = SectionPlanner.Plan(TestData.Roster(grid));
        Assert.Equal("Dr Rao", planned[0].Faculty);
        Assert.StartsWith(SectionPlanner.PlaceholderPrefix, planned[1].Faculty);
        Assert.Equal(planned.Count, planned.Select(s => s.Faculty).Distinct().Count());
    }
}

public class ProblemBuilderTests
{
    [Fact]
    public void Edge_weights_count_shared_students_and_single_course_students_are_dropped()
    {
        var grid = new List<IReadOnlyList<string?>> { TestData.Header };
        void Add(string reg, string course) => grid.Add(["B", reg, $"n {reg}", null, null, course, $"t {course}", null]);
        Add("RA1", "A"); Add("RA1", "B"); Add("RA2", "A"); Add("RA2", "B"); Add("RA3", "A"); Add("RA4", "B"); Add("RA4", "C");
        var model = TestData.Model(TestData.Roster(grid));
        var p = model.Problem;
        Assert.Equal(["A", "B", "C"], model.CourseOrder);
        Assert.Equal(3, p.StudentCount);                       // RA1, RA2, RA4 are multi-course
        Assert.Equal(4, p.TotalStudents);
        Assert.Equal(2, p.EdgeCount);
        Assert.Equal(2, p.EdgeWeights[0]);                       // A–B shared by RA1 and RA2
        Assert.Equal(1, p.EdgeWeights[1]);                       // B–C
    }

    [Fact]
    public void Saturday_policy_controls_allowed_days()
    {
        var roster = TestData.Roster(
        [
            TestData.Header,
            new string?[] { "B", "RA1", "n", null, null, "21MAB101T", "maths", null },
            new string?[] { "B", "RA1", "n", null, null, "21CSC101T", "cs", null },
        ]);
        var closed = TestData.Model(roster).Problem;
        Assert.Equal(5, closed.WeekdayCount);
        Assert.Equal([5, 5], Enumerable.Range(0, 2).Select(closed.AllowedDays));

        var open = TestData.Model(roster, new SchedulePolicy { AllowSaturdayForMaths = true }).Problem;
        Assert.Equal(6, open.WeekdayCount);
        Assert.Equal(5, open.AllowedDays(0));  // 21CSC101T
        Assert.Equal(6, open.AllowedDays(1));  // 21MAB101T
        Assert.True(open.IsSaturdayEligible(1));

        var extra = TestData.Model(roster, new SchedulePolicy { SaturdayExtraCourses = SchedulePolicy.NormalizeCodes(["21csc101t"]) }).Problem;
        Assert.Equal(6, extra.AllowedDays(0));
        Assert.Equal(5, extra.AllowedDays(1));
    }

    [Fact]
    public void Course_order_is_ordinal_so_indices_are_machine_independent()
    {
        var model = TestData.Model(TestData.Roster(TestData.Grid(50, 30, 4, seed: 4)));
        Assert.Equal(model.CourseOrder.Order(StringComparer.Ordinal), model.CourseOrder);
    }
}

public class AuditTests
{
    private static (IReadOnlyList<Section> Sections, Timetable Tt) Setup(Func<int, int> dayOf)
    {
        var sections = new List<Section>
        {
            new("A", "A", "a", 1, "F1", 64, ["s1", "s2"], []),
            new("B", "B", "b", 1, "F2", 64, ["s1"], []),
            new("C_S1", "C", "c", 1, "F3", 60, ["s3"], []),
            new("C_S2", "C", "c", 2, "F4", 60, ["s4"], []),
        };
        return (sections, new Timetable(new[] { "A", "B", "C" }.Select((c, i) => KeyValuePair.Create(c, dayOf(i)))));
    }

    [Fact]
    public void A_clean_timetable_passes_and_overlaps_are_reported_separately()
    {
        var (sections, tt) = Setup(i => i); // A=0 B=1 C=2
        var audit = ScheduleAuditor.Audit(sections, tt, SchedulePolicy.Default);
        Assert.True(audit.IsStructurallyFeasible);
        Assert.Empty(audit.Overlaps);

        var (s2, tt2) = Setup(_ => 0);      // A and B together: s1 has both
        var audit2 = ScheduleAuditor.Audit(s2, tt2, SchedulePolicy.Default);
        Assert.True(audit2.IsStructurallyFeasible);
        Assert.Equal("s1", Assert.Single(audit2.Overlaps).RegisterNumber);
    }

    [Fact]
    public void Flags_capacity_faculty_saturday_and_range_violations()
    {
        var (sections, tt) = Setup(i => i);
        var over = sections.Select(s => s.Id == "A" ? s with { Capacity = 1 } : s).ToList();
        Assert.Contains(ScheduleAuditor.Audit(over, tt, SchedulePolicy.Default).Structural, v => v.Code == "capacity");
        Assert.DoesNotContain(ScheduleAuditor.Audit(over, tt, SchedulePolicy.Default, new HashSet<string> { "A" }).Structural, v => v.Code == "capacity");

        var sameFaculty = sections.Select(s => s.Id == "B" ? s with { Faculty = "F1" } : s).ToList();
        var allSameDay = new Timetable(new Dictionary<string, int> { ["A"] = 0, ["B"] = 0, ["C"] = 1 });
        Assert.Contains(ScheduleAuditor.Audit(sameFaculty, allSameDay, SchedulePolicy.Default).Structural, v => v.Code == "faculty.overlap");

        var saturday = new Timetable(new Dictionary<string, int> { ["A"] = 5, ["B"] = 1, ["C"] = 2 });
        Assert.Contains(ScheduleAuditor.Audit(sections, saturday, SchedulePolicy.Default).Structural, v => v.Code is "saturday.closed" or "day.invalid");
        var maths = new SchedulePolicy { AllowSaturdayForMaths = true };
        Assert.Contains(ScheduleAuditor.Audit(sections, saturday, maths).Structural, v => v.Code == "saturday.ineligible");

        var missing = new Timetable(new Dictionary<string, int> { ["A"] = 0, ["B"] = 1 });
        Assert.Contains(ScheduleAuditor.Audit(sections, missing, SchedulePolicy.Default).Structural, v => v.Code == "course.unplaced");
    }
}

public class WorkflowTests
{
    private static SolveInput Input(List<IReadOnlyList<string?>> grid) => new(new SourceInfo("synthetic.xlsx", 0, "00"), grid);
    private static readonly SolveSettings Fast = new() { Search = new SearchOptions { Chains = 4, MovesPerChain = 300_000, Seed = 3 } };

    [Fact]
    public void Runs_end_to_end_and_two_independent_implementations_agree()
    {
        var outcome = new SolveWorkflow(new AnnealingEngine()).Run(Input(TestData.Grid(300, 60, 5, seed: 5)), Fast, null, CancellationToken.None);
        Assert.True(outcome.Audit.IsStructurallyFeasible);
        Assert.Equal(outcome.Evaluation.Score.Red, outcome.Clash.StudentsWithClashes);
        Assert.Equal(outcome.Sections.Count, outcome.Schedule.Count);
        Assert.Equal(outcome.Roster.Courses.Count, outcome.Timetable.CourseDays.Count);
        Assert.True(outcome.RedStudents >= outcome.Bounds.MinRedStudents);
        Assert.Equal(outcome.Audit.Overlaps.Select(o => o.RegisterNumber).Distinct().Count(), outcome.RedStudents);
    }

    [Fact]
    public void Same_settings_give_the_same_timetable()
    {
        var grid = TestData.Grid(200, 50, 5, seed: 6);
        var a = new SolveWorkflow(new AnnealingEngine()).Run(Input(grid), Fast, null, CancellationToken.None);
        var b = new SolveWorkflow(new AnnealingEngine()).Run(Input(grid), Fast, null, CancellationToken.None);
        Assert.Equal(a.Timetable.CourseDays.OrderBy(k => k.Key), b.Timetable.CourseDays.OrderBy(k => k.Key));
    }

    [Fact]
    public void Rejected_input_raises_with_a_readable_report()
    {
        var ex = Assert.Throws<InputRejectedException>(() =>
            new SolveWorkflow(new AnnealingEngine()).Run(Input([new string?[] { "x", "y" }]), Fast, null, CancellationToken.None));
        Assert.NotEmpty(ex.Report.Errors);
    }

    [Fact]
    public async Task Reports_progress_through_every_stage()
    {
        var stages = new List<SolveStage>();
        var progress = new SyncProgress<SolveProgress>(p => { lock (stages) stages.Add(p.Stage); });
        await new SolveWorkflow(new AnnealingEngine()).RunAsync(Input(TestData.Grid(150, 40, 4, seed: 7)), Fast, progress, CancellationToken.None);
        foreach (var s in new[] { SolveStage.Reading, SolveStage.Planning, SolveStage.Bounds, SolveStage.Searching, SolveStage.Auditing, SolveStage.Done })
            Assert.Contains(s, stages);
    }

    [Fact]
    public async Task Cancellation_propagates()
    {
        using var cts = new CancellationTokenSource();
        cts.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            new SolveWorkflow(new AnnealingEngine()).RunAsync(Input(TestData.Grid(100, 30, 4, seed: 8)), Fast, null, cts.Token));
    }

    private sealed class SyncProgress<T>(Action<T> handler) : IProgress<T>
    {
        public void Report(T value) => handler(value);
    }
}

public class ExportTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "unislot-tests-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        if (Directory.Exists(_dir)) Directory.Delete(_dir, recursive: true);
    }

    private SolveOutcome Outcome() => new SolveWorkflow(new AnnealingEngine()).Run(
        new SolveInput(new SourceInfo("synthetic.xlsx", 10, "abc"), TestData.Grid(250, 45, 5, seed: 9)),
        new SolveSettings { Search = new SearchOptions { Chains = 4, MovesPerChain = 300_000, Seed = 3 } }, null, CancellationToken.None);

    [Fact]
    public async Task Writes_the_five_files_atomically()
    {
        var files = await OutputWriter.WriteAsync(Outcome(), _dir, new ExportOptions { Institution = "Test University" });
        Assert.Equal(5, files.Count);
        Assert.All(files, f => Assert.True(File.Exists(f)));
        Assert.Empty(Directory.GetFiles(_dir, "*.tmp"));
    }

    [Fact]
    public async Task Details_sheet_keeps_the_stable_machine_readable_layout()
    {
        var outcome = Outcome();
        await OutputWriter.WriteAsync(outcome, _dir);
        using var wb = new XLWorkbook(Path.Combine(_dir, OutputWriter.ScheduleFile));
        var ws = wb.Worksheet("Details");
        string[] expected = ["S.No", "Course Code", "Course Title", "Section", "Section ID", "Day", "Timing", "Weekday Index", "Parallel Lane", "Students", "Faculty", "Programs"];
        Assert.Equal(expected, Enumerable.Range(1, 12).Select(c => ws.Cell(4, c).GetString()));
        Assert.Equal(outcome.Sections.Count, ws.LastRowUsed()!.RowNumber() - 4);
        Assert.Matches(@"^\w+ 5:00–7:00 PM \(Parallel lane \d+/\d+\)$", ws.Cell(5, 7).GetString());
        // every section's weekday index in the file equals the timetable
        for (int r = 5; r <= ws.LastRowUsed()!.RowNumber(); r++)
        {
            string id = ws.Cell(r, 5).GetString();
            var section = outcome.Sections.Single(s => s.Id == id);
            Assert.Equal(outcome.Timetable.DayOf(section.CourseCode), (int)ws.Cell(r, 8).Value.GetNumber());
        }
    }

    [Fact]
    public async Task Snapshot_and_summary_carry_the_agreed_schema()
    {
        var outcome = Outcome();
        await OutputWriter.WriteAsync(outcome, _dir);
        using var snap = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(_dir, OutputWriter.SnapshotFile)));
        var root = snap.RootElement;
        Assert.Equal(2, root.GetProperty("schema_version").GetInt32());
        Assert.Equal("red-first-v1", root.GetProperty("objective_policy").GetString());
        Assert.Equal(outcome.Sections.Count, root.GetProperty("slot_assignments").EnumerateObject().Count());
        Assert.Equal(outcome.Roster.Students.Count, root.GetProperty("students").EnumerateObject().Count());
        Assert.Equal(outcome.Roster.Rows.Count, root.GetProperty("enrollmentRows").GetArrayLength());
        Assert.Equal(outcome.Search.Options.ReproToken, root.GetProperty("unislot").GetProperty("repro_token").GetString());

        using var sum = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(_dir, OutputWriter.SummaryFile)));
        Assert.Equal(outcome.RedStudents, sum.RootElement.GetProperty("red_students").GetInt32());
        Assert.Equal(outcome.ClashWeight, sum.RootElement.GetProperty("clash_weight").GetInt32());
        Assert.True(sum.RootElement.GetProperty("hard_constraints_ok").GetBoolean());
    }

    [Fact]
    public async Task Clash_report_lists_exactly_the_red_students()
    {
        var outcome = Outcome();
        await OutputWriter.WriteAsync(outcome, _dir);
        using var wb = new XLWorkbook(Path.Combine(_dir, OutputWriter.ClashFile));
        var ws = wb.Worksheet("Clashes Only");
        int rows = Math.Max(0, (ws.LastRowUsed()?.RowNumber() ?? 4) - 4);
        Assert.Equal(outcome.RedStudents, rows);
    }

    [Fact]
    public async Task Workbook_round_trips_through_the_reader()
    {
        var path = Path.Combine(_dir, "in.xlsx");
        Directory.CreateDirectory(_dir);
        using (var wb = new XLWorkbook())
        {
            var ws = wb.AddWorksheet("Sheet1");
            var grid = TestData.Grid(30, 10, 3, seed: 12);
            for (int r = 0; r < grid.Count; r++)
                for (int c = 0; c < grid[r].Count; c++)
                    if (grid[r][c] is { } v) ws.Cell(r + 1, c + 1).Value = v;
            ws.Cell(2, 4).Value = 9876543210.0; // numeric mobile number must not turn into scientific notation
            wb.SaveAs(path);
        }
        var input = await XlsxEnrollmentSource.ReadAsync(path);
        Assert.Equal("in.xlsx", input.Source.FileName);
        Assert.Equal(64, input.Source.Sha256.Length);
        Assert.Equal("9876543210", input.Grid[1][3]);
        Assert.True(EnrollmentParser.Parse(input.Grid).Validation.IsValid);
    }
}

/// <summary>Runs only when a private workbook is supplied through UNISLOT_TEST_WORKBOOK; never committed, never required.</summary>
public sealed class LocalWorkbookFactAttribute : FactAttribute
{
    public LocalWorkbookFactAttribute()
    {
        if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("UNISLOT_TEST_WORKBOOK")))
            Skip = "Set UNISLOT_TEST_WORKBOOK to a real enrollment workbook to run this test.";
    }
}

public class RealWorkbookTests
{
    [LocalWorkbookFact]
    public async Task Real_workbook_solves_cleanly_and_respects_every_bound()
    {
        var input = await XlsxEnrollmentSource.ReadAsync(Environment.GetEnvironmentVariable("UNISLOT_TEST_WORKBOOK")!);
        var outcome = await new SolveWorkflow(new AnnealingEngine()).RunAsync(input,
            new SolveSettings { Search = new SearchOptions { Chains = 12, MovesPerChain = 6_000_000 } }, null, CancellationToken.None);
        Assert.True(outcome.Audit.IsStructurallyFeasible);
        Assert.True(outcome.RedStudents >= outcome.Bounds.MinRedStudents);
        Assert.Equal(outcome.RedStudents, outcome.Clash.StudentsWithClashes);
    }
}
