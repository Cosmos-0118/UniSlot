using ClosedXML.Excel;
using Spectre.Console.Testing;
using UniSlot.Application.Editing;
using UniSlot.Application.Workflow;
using UniSlot.Cli;
using UniSlot.Infrastructure;
using UniSlot.Infrastructure.Export;
using UniSlot.Solver;

namespace UniSlot.Tests;

/// <summary>The maintenance flows, driven through the menu with scripted key presses and through the scripted commands.</summary>
[Collection("console")]
public sealed class MaintenanceScreenTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("unislot-maint-").FullName;

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private static TestConsole NewConsole()
    {
        var c = new TestConsole().Interactive();
        c.Profile.Width = 120;
        return c;
    }

    private static void Keys(TestConsole c, params ConsoleKey[] keys)
    {
        foreach (var k in keys) c.Input.PushKey(k);
    }

    private async Task<string> Publish(string name)
    {
        var settings = new SolveSettings { Search = new SearchOptions { Seed = 3, Chains = 4, MovesPerChain = 300_000 } };
        var outcome = new SolveWorkflow(new AnnealingEngine()).Run(new SolveInput(new SourceInfo("enrol.xlsx", 10, "abc"), TestData.Grid(80, 12, 4, seed: 21)), settings, null, CancellationToken.None);
        string folder = Path.Combine(_dir, "out", name);
        await OutputWriter.WriteAsync(outcome, folder);
        return folder;
    }

    private string Workbook(string name, IEnumerable<IReadOnlyList<string?>> grid)
    {
        string path = Path.Combine(_dir, name);
        using var wb = new XLWorkbook();
        var ws = wb.AddWorksheet("Sheet1");
        int r = 1;
        foreach (var row in grid)
        {
            for (int col = 0; col < row.Count; col++)
                if (row[col] is { } v) ws.Cell(r, col + 1).Value = v;
            r++;
        }
        wb.SaveAs(path);
        return path;
    }

    private CliSettings Prefs() => new() { OutputRoot = Path.Combine(_dir, "out") };

    private static IReadOnlyList<string?> Late(string reg, string course) =>
        new string?[] { "B.Tech-Computer Science", reg, "late student", null, null, course, "Late Course", null };

    [Fact]
    public async Task Late_enrollment_from_the_menu_writes_a_new_folder_and_leaves_the_original()
    {
        string prev = await Publish("base");
        string lateFile = Workbook("late.xlsx", [TestData.Header, Late("RA-L1", "21CS001T"), Late("RA-L1", "21NEW900T")]);
        var prefs = Prefs();
        prefs.LastFile = lateFile;
        int before = Directory.GetFiles(prev).Length;

        var c = NewConsole();
        // Update → Late → folder (first) → workbook (last used, first) → defaults for full/clash → Apply → results menu: Quit.
        Keys(c, ConsoleKey.DownArrow, ConsoleKey.Enter, ConsoleKey.Enter, ConsoleKey.Enter, ConsoleKey.Enter, ConsoleKey.Enter, ConsoleKey.Enter, ConsoleKey.Enter);
        Keys(c, ConsoleKey.UpArrow, ConsoleKey.Enter);
        Assert.Equal(0, await new App(c, prefs).RunAsync(startWithWizard: false));

        Assert.Equal(before, Directory.GetFiles(prev).Length);
        string made = Directory.GetDirectories(prefs.OutputRoot).Single(d => d.Contains("-late-", StringComparison.Ordinal));
        Assert.True(File.Exists(Path.Combine(made, "late-enrollment-report.json")));
        var ws = await SnapshotStore.ReadAsync(made);
        Assert.Contains(ws.Rows, r => r.RegisterNumber == "RAL1" && r.CourseCode == "21NEW900T");
        Assert.Contains("What changed", c.Output);
    }

    [Fact]
    public async Task Find_issues_and_name_list_work_from_the_menu()
    {
        string prev = await Publish("base");
        var prefs = Prefs();
        prefs.LastFile = Workbook("good.xlsx", TestData.Grid(30, 6, 3, 1));

        var c = NewConsole();
        // Issues (index 2) → workbook → pause; Names (index 3) → folder → pause; Quit.
        Keys(c, ConsoleKey.DownArrow, ConsoleKey.DownArrow, ConsoleKey.Enter, ConsoleKey.Enter);
        Keys(c, ConsoleKey.DownArrow, ConsoleKey.DownArrow, ConsoleKey.DownArrow, ConsoleKey.Enter, ConsoleKey.Enter);
        Keys(c, ConsoleKey.UpArrow, ConsoleKey.Enter);
        Assert.Equal(0, await new App(c, prefs).RunAsync(startWithWizard: false));
        Assert.Contains("No issues found", c.Output);
        Assert.True(File.Exists(Path.Combine(prev, "name-list.xlsx")));
    }

    [Fact]
    public async Task Revert_from_the_menu_restores_a_dropped_registration()
    {
        string orig = await Publish("a-original");
        var ws = await SnapshotStore.ReadAsync(orig);
        var row = ws.Rows[0];
        var dropped = EditWorkflow.Run(ws, Edits.DropCourse(ws, row.RegisterNumber, row.CourseCode), null, CancellationToken.None);
        await Task.Delay(1100);   // folder times differ, so the edited one is listed first
        await OutputWriter.WriteAsync(dropped, Path.Combine(_dir, "out", "b-edited"));

        var prefs = Prefs();
        var c = NewConsole();
        // Update → Undo (5th item) → edited folder (newest, first) → previous → tick the one change → Apply → results: Quit.
        Keys(c, ConsoleKey.DownArrow, ConsoleKey.Enter);
        Keys(c, ConsoleKey.DownArrow, ConsoleKey.DownArrow, ConsoleKey.DownArrow, ConsoleKey.DownArrow, ConsoleKey.Enter);
        Keys(c, ConsoleKey.Enter, ConsoleKey.Enter, ConsoleKey.Spacebar, ConsoleKey.Enter, ConsoleKey.Enter);
        Keys(c, ConsoleKey.UpArrow, ConsoleKey.Enter);
        Assert.Equal(0, await new App(c, prefs).RunAsync(startWithWizard: false));

        string made = Directory.GetDirectories(prefs.OutputRoot).Single(d => d.Contains("-revert-", StringComparison.Ordinal));
        var restored = await SnapshotStore.ReadAsync(made);
        Assert.Equal(ws.Rows.Count, restored.Rows.Count);
        Assert.Contains(restored.Rows, r => r.RegisterNumber == row.RegisterNumber && r.CourseCode == row.CourseCode);
    }

    [Fact]
    public async Task Scripted_commands_run_end_to_end_and_never_overwrite_the_source()
    {
        string prev = await Publish("base");
        string lateFile = Workbook("late.xlsx", [TestData.Header, Late("RA-L1", "21CS001T")]);
        string outDir = Path.Combine(_dir, "scripted");

        var o = EditOptions.Parse(EditOptions.Late, ["--previous", prev, "--late", lateFile, "-o", outDir]);
        o.Require();
        var rich = NewConsole();
        Assert.Equal(0, await Maintenance.RunScripted(rich, o, rich: true, CancellationToken.None));
        Assert.Contains("What changed", rich.Output);
        Assert.True(File.Exists(Path.Combine(outDir, "snapshot.json")));

        // the same output folder again would overwrite a timetable: refused
        await Assert.ThrowsAsync<EditException>(() => Maintenance.RunScripted(NewConsole(), o, rich: false, CancellationToken.None));
        // and the source folder can never be the destination
        var same = EditOptions.Parse(EditOptions.DropCourse, ["--previous", prev, "--register", "x", "--course", "y", "-o", prev]);
        await Assert.ThrowsAsync<EditException>(() => Maintenance.RunScripted(NewConsole(), same, rich: false, CancellationToken.None));
    }

    [Fact]
    public async Task Scripted_plain_output_has_no_markup_or_ansi()
    {
        string prev = await Publish("base");
        var ws = await SnapshotStore.ReadAsync(prev);
        var o = EditOptions.Parse(EditOptions.DropCourse,
            ["--previous", prev, "--register", ws.Rows[0].RegisterNumber, "--course", ws.Rows[0].CourseCode, "-o", Path.Combine(_dir, "d"), "-q"]);
        var original = Console.Out;
        var sw = new StringWriter();
        Console.SetOut(sw);
        try { Assert.Equal(0, await Maintenance.RunScripted(NewConsole(), o, rich: false, CancellationToken.None)); }
        finally { Console.SetOut(original); }
        string text = sw.ToString();
        Assert.Contains("RED students", text);
        Assert.Contains("drop-course", text);
        Assert.DoesNotContain('\u001b', text);
        Assert.DoesNotContain("[bold", text);
    }

    [Fact]
    public void Edit_options_validate_what_each_command_needs()
    {
        Assert.Throws<ArgumentException>(() => EditOptions.Parse("late", ["--bogus"]));
        Assert.Throws<ArgumentException>(() => EditOptions.Parse("late", ["--on-full", "explode"]));
        Assert.Throws<ArgumentException>(() => EditOptions.Parse("late", ["--previous"]));
        Assert.Throws<ArgumentException>(() => EditOptions.Parse("late", ["--previous", "a"]).Require());
        Assert.Throws<ArgumentException>(() => EditOptions.Parse("revert", ["--edited", "a", "--previous", "b"]).Require());
        Assert.Throws<ArgumentException>(() => EditOptions.Parse("fix-course", ["--previous", "a", "--from", "x", "--to", "y"]).Require());
        EditOptions.Parse("revert", ["--edited", "a", "--previous", "b", "--all", "-y"]).Require();
        var o = EditOptions.Parse("late", ["--on-full", "park", "--on-clash", "park-student", "--courses", "21cs001t,21cs002t"]);
        Assert.Equal((FullPolicy.Park, ClashPolicy.ParkStudent), (o.OnFull, o.OnClash));
        Assert.Equal(["21CS001T", "21CS002T"], o.Courses);
    }
}

[CollectionDefinition("console", DisableParallelization = true)]
public sealed class ConsoleCollection;
