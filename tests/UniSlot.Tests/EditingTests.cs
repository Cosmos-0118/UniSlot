using System.Text.Json.Nodes;
using ClosedXML.Excel;
using UniSlot.Application.Editing;
using UniSlot.Application.Importing;
using UniSlot.Application.Workflow;
using UniSlot.Domain;
using UniSlot.Infrastructure;
using UniSlot.Infrastructure.Export;
using UniSlot.Solver;

namespace UniSlot.Tests;

/// <summary>Late enrollment, rectify, fix/drop course, revert and filter, end to end through saved output folders.</summary>
public sealed class EditingTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("unislot-edit-").FullName;

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private static SolveSettings Quick(SchedulePolicy? policy = null) => new()
    {
        Policy = policy ?? SchedulePolicy.Default,
        Search = new SearchOptions { Seed = 5, Chains = 4, MovesPerChain = 400_000 },
    };

    private async Task<(Workspace Space, string Folder)> Published(List<IReadOnlyList<string?>> grid, string name = "base")
    {
        var outcome = new SolveWorkflow(new AnnealingEngine()).Run(new SolveInput(new SourceInfo("enrol.xlsx", 10, "abc"), grid), Quick(), null, CancellationToken.None);
        string folder = Path.Combine(_dir, name);
        await OutputWriter.WriteAsync(outcome, folder);
        return (await SnapshotStore.ReadAsync(folder), folder);
    }

    private static List<IReadOnlyList<string?>> Base() => TestData.Grid(students: 120, courses: 16, maxPerStudent: 4, seed: 11);

    private static EnrollmentRow Late(string reg, string course, string title = "Late Course", string name = "Late Student") =>
        new("B.Tech-Computer Science", reg, name, null, null, course, title, null, null, null, null);

    private static SolveOutcome Run(Workspace before, EditPlan plan) => EditWorkflow.Run(before, plan, null, CancellationToken.None);

    private static void AssertSameDays(Workspace before, SolveOutcome after, params string[] except)
    {
        foreach (var (code, day) in before.Days.Where(kv => !except.Contains(kv.Key)))
            if (after.Timetable.TryDayOf(code, out int d)) Assert.Equal(day, d);
    }

    [Fact]
    public async Task A_saved_folder_reads_back_exactly()
    {
        var (space, folder) = await Published(Base());
        var again = await SnapshotStore.ReadAsync(folder);
        Assert.Equal(space.Rows.Count, again.Rows.Count);
        Assert.Equal(space.Sections.Select(s => (s.Id, s.Students.Count)), again.Sections.Select(s => (s.Id, s.Students.Count)));
        Assert.Equal(space.Days.OrderBy(k => k.Key), again.Days.OrderBy(k => k.Key));
        Assert.Equal(16, space.Days.Count);
        Assert.Single(space.RunLog);
    }

    [Fact]
    public async Task Drop_course_removes_one_registration_and_moves_nothing_else()
    {
        var (space, folder) = await Published(Base());
        string reg = space.Rows[0].RegisterNumber, course = space.Rows[0].CourseCode;
        var plan = Edits.DropCourse(space, reg, course);
        var outcome = Run(space, plan);

        Assert.DoesNotContain(outcome.Roster.Rows, r => r.RegisterNumber == reg && r.CourseCode == course);
        Assert.Equal(space.Rows.Count - 1, outcome.Roster.Rows.Count);
        AssertSameDays(space, outcome);
        Assert.True(outcome.Audit.IsStructurallyFeasible);

        var written = await OutputWriter.WriteAsync(outcome, Path.Combine(_dir, "dropped"));
        Assert.Contains(written, f => f.EndsWith("fix-report.json", StringComparison.Ordinal));
        Assert.Contains(written, f => f.EndsWith("enrollment.xlsx", StringComparison.Ordinal));
        var log = (JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(_dir, "dropped", "snapshot.json")))!["run_log"] as JsonArray)!;
        Assert.Equal(2, log.Count);
        Assert.Equal("drop-course", log[1]!["mode"]!.GetValue<string>());
        Assert.NotEqual(folder, Path.Combine(_dir, "dropped"));
    }

    [Fact]
    public async Task Drop_course_removes_a_course_that_becomes_empty()
    {
        var grid = Base();
        grid.Add(["B.Tech-Computer Science", "RA9", "only student", null, null, "21ZZZ001T", "Lonely", null]);
        var (space, _) = await Published(grid);
        var outcome = Run(space, Edits.DropCourse(space, "RA9", "21ZZZ001T"));
        Assert.False(outcome.Roster.HasCourse("21ZZZ001T"));
        Assert.False(outcome.Timetable.TryDayOf("21ZZZ001T", out _));
    }

    [Fact]
    public async Task Drop_and_fix_reject_unknown_students_and_courses()
    {
        var (space, _) = await Published(Base());
        Assert.Throws<EditException>(() => Edits.DropCourse(space, "NOPE", "x"));
        Assert.Throws<EditException>(() => Edits.DropCourse(space, space.Rows[0].RegisterNumber, "NOT-ENROLLED"));
        Assert.Throws<EditException>(() => Edits.FixCourse(space, space.Rows[0].RegisterNumber, space.Rows[0].CourseCode, "21NEW101T", null));
    }

    [Fact]
    public async Task Fix_course_onto_an_existing_course_places_the_student_without_the_solver_moving_anything()
    {
        var (space, _) = await Published(Base());
        var row = space.Rows[0];
        string target = space.Days.Keys.First(c => c != row.CourseCode && !space.IsEnrolled(row.RegisterNumber, c));
        var outcome = Run(space, Edits.FixCourse(space, row.RegisterNumber, row.CourseCode, target, null));
        Assert.Contains(outcome.Roster.Rows, r => r.RegisterNumber == row.RegisterNumber && r.CourseCode == target);
        Assert.DoesNotContain(outcome.Roster.Rows, r => r.RegisterNumber == row.RegisterNumber && r.CourseCode == row.CourseCode);
        AssertSameDays(space, outcome);
        Assert.Equal(space.Rows.Count, outcome.Roster.Rows.Count);
    }

    [Fact]
    public async Task Fix_course_onto_a_new_course_needs_a_title_and_lets_the_solver_place_only_that_course()
    {
        var (space, _) = await Published(Base());
        var row = space.Rows[0];
        var ex = Assert.Throws<EditException>(() => Edits.FixCourse(space, row.RegisterNumber, row.CourseCode, "21NEW101T", null));
        Assert.Contains("title", ex.Message, StringComparison.OrdinalIgnoreCase);

        var outcome = Run(space, Edits.FixCourse(space, row.RegisterNumber, row.CourseCode, "21new101t", "New Elective"));
        Assert.True(outcome.Timetable.TryDayOf("21NEW101T", out int day));
        Assert.InRange(day, 0, 4);
        AssertSameDays(space, outcome, "21NEW101T");
        Assert.Equal("New Elective", outcome.Roster.Course("21NEW101T").Title);
    }

    [Fact]
    public async Task Late_enrollment_keeps_published_classes_and_places_new_students()
    {
        var (space, _) = await Published(Base());
        string existing = space.Days.Keys.First();
        var late = new List<EnrollmentRow> { Late("RAL1", existing), Late("RAL2", existing), Late("RAL2", "21NEW900T", "Brand New Course") };
        var plan = Edits.Late(space, late, FullPolicy.NewSection, ClashPolicy.Accept);
        var outcome = Run(space, plan);

        Assert.Equal(space.Rows.Count + 3, outcome.Roster.Rows.Count);
        AssertSameDays(space, outcome, "21NEW900T");
        Assert.True(outcome.Timetable.TryDayOf("21NEW900T", out _));
        foreach (var s in space.Sections)   // nobody who was already placed moved
            Assert.All(s.Students, id => Assert.Contains(id, outcome.Sections.First(x => x.Id == s.Id).Students));
        Assert.Equal(3, plan.Info.RegistrationsAdded);
        Assert.Equal(1, plan.Info.CoursesAdded);
        Assert.True(outcome.Audit.IsStructurallyFeasible);
    }

    [Fact]
    public async Task Late_file_may_be_the_full_workbook_and_existing_rows_are_skipped()
    {
        var (space, _) = await Published(Base());
        var everything = space.Rows.Append(Late("RAL9", space.Days.Keys.First())).ToList();
        var plan = Edits.Late(space, everything, FullPolicy.NewSection, ClashPolicy.Accept);
        Assert.Equal(1, plan.Info.RegistrationsAdded);
        Assert.Contains(plan.Info.Notes, n => n.Contains("already on the schedule", StringComparison.Ordinal));
        Assert.Throws<EditException>(() => Edits.Late(space, space.Rows, FullPolicy.NewSection, ClashPolicy.Accept));
    }

    [Theory]
    [InlineData(FullPolicy.NewSection)]
    [InlineData(FullPolicy.Fit)]
    [InlineData(FullPolicy.Park)]
    public async Task A_full_course_is_handled_by_the_chosen_policy(FullPolicy policy)
    {
        var grid = TestData.Grid(60, 10, 3, seed: 2);
        for (int i = 0; i < 64; i++)   // one course exactly at single-section capacity
            grid.Add(["B.Tech-Computer Science", $"RF{i:000}", $"full {i}", null, null, "21FUL001T", "Full Course", null]);
        var (space, _) = await Published(grid);
        Assert.Single(space.SectionsOf("21FUL001T"));

        var plan = Edits.Late(space, [Late("RALATE", "21FUL001T")], policy, ClashPolicy.Accept);
        var sections = plan.Workspace.SectionsOf("21FUL001T");
        switch (policy)
        {
            case FullPolicy.NewSection:
                Assert.Equal(2, sections.Count);
                Assert.Equal("21FUL001T_S2", sections[1].Id);
                Assert.Equal("21FUL001T", sections[0].Id);   // the published section keeps its id
                Assert.Equal(["21FUL001T_S2"], plan.Info.SectionsCreated);
                break;
            case FullPolicy.Fit:
                Assert.Single(sections);
                Assert.Equal(65, sections[0].Students.Count);
                Assert.Equal(65, sections[0].Capacity);
                Assert.Single(plan.Info.Waivers);
                break;
            default:
                Assert.Single(sections);
                Assert.Equal(64, sections[0].Students.Count);
                Assert.Single(plan.Info.Parked);
                break;
        }
        if (policy != FullPolicy.Park) Assert.True(Run(space, plan).Audit.IsStructurallyFeasible);
    }

    [Fact]
    public async Task Park_student_declines_late_registrations_that_would_clash()
    {
        var (space, _) = await Published(Base());
        var student = space.Rows.First();
        string held = student.CourseCode;
        // another course on the same weekday as one the student already holds
        string sameDay = space.Days.First(kv => kv.Value == space.Days[held] && kv.Key != held && !space.IsEnrolled(student.RegisterNumber, kv.Key)).Key;
        var late = new[] { student with { CourseCode = sameDay, CourseTitle = "x" } };
        var parked = Edits.Late(space, late, FullPolicy.NewSection, ClashPolicy.ParkStudent);
        Assert.Single(parked.Info.Parked);
        Assert.Equal(0, parked.Info.RegistrationsAdded);
        var accepted = Edits.Late(space, late, FullPolicy.NewSection, ClashPolicy.Accept);
        Assert.Equal(1, accepted.Info.RegistrationsAdded);
    }

    [Fact]
    public async Task Rectify_keeps_the_weekday_of_every_continuing_course()
    {
        var (space, _) = await Published(Base());
        var grid = space.ToGrid().ToList();
        grid.RemoveRange(1, 6);                                                                     // some registrations dropped
        grid.Add(["B.Tech-Computer Science", "RA-N1", "new student", null, null, "21REC001T", "Rectified New", null]);
        grid.Add(["B.Tech-Computer Science", "RA-N2", "new student 2", null, null, space.Days.Keys.First(), "t", null]);

        var plan = Edits.Rectify(space, grid);
        var outcome = Run(space, plan);
        AssertSameDays(space, outcome, "21REC001T");
        Assert.True(outcome.Timetable.TryDayOf("21REC001T", out _));
        Assert.Equal(8, plan.Info.Changes.Count);
        Assert.True(outcome.Audit.IsStructurallyFeasible);
        Assert.Equal(1, plan.Info.CoursesAdded);

        Assert.Throws<EditException>(() => Edits.Rectify(space, space.ToGrid()));
    }

    [Fact]
    public async Task Revert_restores_a_wrongly_dropped_registration_and_a_vanished_course()
    {
        var grid = Base();
        grid.Add(["B.Tech-Computer Science", "RA9", "only student", null, null, "21ZZZ001T", "Lonely", null]);
        var (original, _) = await Published(grid, "orig");
        var dropped = Run(original, Edits.DropCourse(original, "RA9", "21ZZZ001T"));
        await OutputWriter.WriteAsync(dropped, Path.Combine(_dir, "edited"));
        var edited = await SnapshotStore.ReadAsync(Path.Combine(_dir, "edited"));

        var diff = Edits.Differences(edited, original);
        var change = Assert.Single(diff);
        Assert.Equal((RegistrationChangeKind.Removed, "21ZZZ001T"), (change.Kind, change.Course));

        var restored = Run(edited, Edits.Revert(edited, original, diff));
        Assert.Contains(restored.Roster.Rows, r => r.RegisterNumber == "RA9" && r.CourseCode == "21ZZZ001T");
        Assert.Equal(original.Days["21ZZZ001T"], restored.Timetable.DayOf("21ZZZ001T"));
        Assert.Equal(original.Rows.Count, restored.Roster.Rows.Count);
    }

    [Fact]
    public async Task Revert_undoes_a_fix_as_one_move_and_refuses_unrelated_folders()
    {
        var (original, _) = await Published(Base(), "orig");
        var row = original.Rows[0];
        string target = original.Days.Keys.First(c => c != row.CourseCode && !original.IsEnrolled(row.RegisterNumber, c));
        var fixedRun = Run(original, Edits.FixCourse(original, row.RegisterNumber, row.CourseCode, target, null));
        await OutputWriter.WriteAsync(fixedRun, Path.Combine(_dir, "fixed"));
        var edited = await SnapshotStore.ReadAsync(Path.Combine(_dir, "fixed"));

        var diff = Edits.Differences(edited, original);
        var move = Assert.Single(diff);
        Assert.Equal(RegistrationChangeKind.Moved, move.Kind);
        Assert.Equal((row.CourseCode, target), (move.Course, move.ToCourse));

        var back = Run(edited, Edits.Revert(edited, original, diff));
        Assert.Equal(original.Rows.Select(r => (r.RegisterNumber, r.CourseCode)).Order(), back.Roster.Rows.Select(r => (r.RegisterNumber, r.CourseCode)).Order());

        var stranger = (await Published(TestData.Grid(50, 8, 3, seed: 99).Select(r => (IReadOnlyList<string?>)r.Select(c => c?.Replace("RA2200", "RZ9900")).ToArray()).ToList(), "other")).Space;
        Assert.Throws<EditException>(() => Edits.Differences(edited, stranger));
    }

    [Fact]
    public async Task Filter_keeps_only_the_listed_courses_and_reports_the_missing_ones()
    {
        var (space, _) = await Published(Base());
        var keep = space.Days.Keys.Take(3).ToArray();
        var (filtered, missing) = Edits.Filter(space, [.. keep, "NOPE999"]);
        Assert.Equal(["NOPE999"], missing);
        Assert.Equal(keep.Order(), filtered.Days.Keys.Order());
        Assert.All(filtered.Rows, r => Assert.Contains(r.CourseCode, keep));
        Assert.Throws<EditException>(() => Edits.Filter(space, ["NOPE999"]));

        var outcome = EditWorkflow.Run(filtered, new EditPlan(filtered, new EditInfo { Mode = "filter" }), null, CancellationToken.None);
        string path = await OutputWriter.WriteScheduleOnlyAsync(outcome, Path.Combine(_dir, "filtered"));
        using var wb = new XLWorkbook(path);
        Assert.NotEmpty(wb.Worksheets);
    }

    [Fact]
    public async Task Name_list_rebuilds_the_enrollment_sheet_from_a_saved_folder()
    {
        var (space, _) = await Published(Base());
        string path = await OutputWriter.WriteNameListAsync(space.Rows, Path.Combine(_dir, "names"));
        var grid = XlsxEnrollmentSource.ReadGrid(await File.ReadAllBytesAsync(path));
        var parsed = RosterBuilder.Build(EnrollmentParser.Parse(grid));
        Assert.NotNull(parsed.Roster);
        Assert.Equal(space.Rows.Count, parsed.Roster!.Rows.Count);
        Assert.Equal(space.Rows[0].StudentName, parsed.Roster.Rows[0].StudentName);
    }

    [Fact]
    public async Task Discover_lists_output_folders_newest_first()
    {
        await Published(Base(), "a");
        await Published(Base(), "b");
        Directory.CreateDirectory(Path.Combine(_dir, "empty"));
        var found = SnapshotStore.Discover([_dir]);
        Assert.Equal(2, found.Count);
        Assert.All(found, f => Assert.True(f.Students > 0));
    }

    [Fact]
    public async Task A_missing_or_damaged_snapshot_is_a_clear_error()
    {
        await Assert.ThrowsAsync<FileNotFoundException>(() => SnapshotStore.ReadAsync(_dir));
        Directory.CreateDirectory(Path.Combine(_dir, "bad"));
        await File.WriteAllTextAsync(Path.Combine(_dir, "bad", "snapshot.json"), "{ nope");
        await Assert.ThrowsAsync<InvalidDataException>(() => SnapshotStore.ReadAsync(Path.Combine(_dir, "bad")));
        await File.WriteAllTextAsync(Path.Combine(_dir, "bad", "snapshot.json"), "{}");
        await Assert.ThrowsAsync<InvalidDataException>(() => SnapshotStore.ReadAsync(Path.Combine(_dir, "bad")));
    }
}

public class IssueFinderTests
{
    private static IReadOnlyList<string?> R(params string?[] cells) => cells;

    [Fact]
    public void Reports_each_kind_of_problem_in_its_category()
    {
        var grid = new List<IReadOnlyList<string?>>
        {
            TestData.Header,
            R("B.Tech-CSE", "RA1", "Asha", null, null, "21CS001T", "Maths", "Dr A"),
            R("B.Tech-CSE", "RA1", "Asha", null, null, "21CS001T", "Maths", "Dr A"),
            R("B.Tech-CSE", "RA2", "Ravi", null, null, "21CS001T", "Maths", "Dr B"),
            R("B.Tech-CSE", "RA2", "Ravi K", null, null, "21CS002T", "Physics", null),
            R("B.Tech-CSE", "RA3", "Meena", null, null, "21CS002T", "Physics Advanced", null),
            R("B.Tech-CSE", "", "Nobody", null, null, "21CS002T", "Physics", null),
        };
        for (int i = 0; i < 40; i++) grid.Add(R("B.Tech-CSE", $"RB{i}", $"extra {i}", null, null, "21CS003T", "Chemistry", null));
        var report = IssueFinder.Find(grid);
        var counts = report.Counts;
        Assert.Equal(1, counts[IssueCategory.Duplicates]);
        Assert.Equal(1, counts[IssueCategory.Faculty]);
        Assert.True(counts[IssueCategory.Identity] >= 2);
        Assert.Equal(1, counts[IssueCategory.MissingFields]);
        Assert.False(report.HasBlocking);   // a few bad rows are skipped, not fatal
    }

    [Fact]
    public void A_sheet_without_the_required_columns_is_blocking()
    {
        var report = IssueFinder.Find([new string?[] { "Foo", "Bar" }, new string?[] { "1", "2" }]);
        Assert.True(report.HasBlocking);
        Assert.Equal(IssueCategory.Schema, report.Issues[0].Category);
        Assert.True(IssueFinder.Find([]).HasBlocking);
    }

    [Fact]
    public void A_clean_sheet_has_no_issues() => Assert.Empty(IssueFinder.Find(TestData.Grid(30, 6, 3, 1)).Issues);
}
