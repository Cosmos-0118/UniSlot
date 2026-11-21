using ClosedXML.Excel;
using Spectre.Console.Testing;
using UniSlot.Application.Editing;
using UniSlot.Application.Workflow;
using UniSlot.Cli;
using UniSlot.Infrastructure;
using UniSlot.Infrastructure.Export;
using UniSlot.Solver;

namespace UniSlot.Tests;

/// <summary>The default (classic) mode: the original tool's menu, commands and flags, driven end to end.</summary>
[Collection("console")]
public sealed class ClassicTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("unislot-classic-").FullName;

    public ClassicTests() => FileDialog.Enabled = false;   // never pop a real dialog from a test

    public void Dispose()
    {
        Ui.Classic = false;
        Directory.Delete(_dir, recursive: true);
    }

    private static TestConsole NewConsole()
    {
        var c = new TestConsole().Interactive();
        c.Profile.Width = 120;
        return c;
    }

    private CliSettings Prefs() => new() { OutputRoot = Path.Combine(_dir, "out") };

    private string Workbook(string name, int students = 70)
    {
        string path = Path.Combine(_dir, name);
        using var wb = new XLWorkbook();
        var ws = wb.AddWorksheet("Sheet1");
        int r = 1;
        foreach (var row in TestData.Grid(students, 10, 3, seed: 4))
        {
            for (int col = 0; col < row.Count; col++)
                if (row[col] is { } v) ws.Cell(r, col + 1).Value = v;
            r++;
        }
        wb.SaveAs(path);
        return path;
    }

    private async Task<string> Publish(string name)
    {
        var settings = new SolveSettings { Search = new SearchOptions { Seed = 3, Chains = 4, MovesPerChain = 300_000 } };
        var outcome = new SolveWorkflow(new AnnealingEngine()).Run(new SolveInput(new SourceInfo("enrol.xlsx", 10, "abc"), TestData.Grid(60, 10, 3, seed: 4)), settings, null, CancellationToken.None);
        string folder = Path.Combine(_dir, "out", name);
        await OutputWriter.WriteAsync(outcome, folder);
        return folder;
    }

    /// <summary>Runs the program with stdout/stderr captured; returns (exit code, stdout, stderr).</summary>
    private static async Task<(int Code, string Out, string Err)> Run(string[] args, TestConsole c, CliSettings prefs, bool interactive)
    {
        var (so, se) = (Console.Out, Console.Error);
        var (o, e) = (new StringWriter(), new StringWriter());
        Console.SetOut(o);
        Console.SetError(e);
        try { return (await Program.RunAsync(args, c, prefs, interactive), o.ToString(), e.ToString()); }
        finally { Console.SetOut(so); Console.SetError(se); }
    }

    // ---- the original command line still works ------------------------------------------------------------------------------------------
    [Fact]
    public async Task The_original_default_command_with_old_flags_runs_without_a_subcommand()
    {
        string wb = Workbook("data.xlsx");
        string outDir = Path.Combine(_dir, "o1");
        var (code, text, err) = await Run(["-i", wb, "-o", outDir, "-y", "--preset", "quick", "--workers", "2", "--no-saturday", "--portfolio", "0", "--nomenclature", "x.xlsx", "--absolute-gap", "1"],
            NewConsole(), Prefs(), interactive: false);
        Assert.Equal(0, code);
        Assert.True(File.Exists(Path.Combine(outDir, "snapshot.json")));
        Assert.Contains("RED students", text);
        Assert.Contains("--portfolio", err);
        Assert.Contains("no effect", err);
    }

    [Fact]
    public void Old_and_new_seed_tokens_are_understood()
    {
        var plain = Options.Parse(["--seed", "77"]);
        Assert.Equal(77UL, plain.Seed);
        var original = Options.Parse(["--seed", "77/8/0/0"]);   // seed/workers/portfolio/saturday: only the seed carries over
        Assert.Equal((77UL, 12), (original.Seed, original.Chains));
        var ours = Options.Parse(["--seed", "5/3/1000"]);       // seed/chains/moves reproduces the run exactly
        Assert.Equal((5UL, 3, 1000L), (ours.Seed, ours.Chains, ours.Moves));
        Assert.Throws<ArgumentException>(() => Options.Parse(["--seed", "5/3"]));
        Assert.Throws<ArgumentException>(() => Options.Parse(["--seed", "x"]));
        var o = Options.Parse(["-y", "--saturday", "--no-saturday", "--time-limit", "30", "--workers", "6", "--prove-plateau", "20", "--prove-strategy", "core"]);
        Assert.Equal((true, false, TimeSpan.FromSeconds(30), 6), (o.Yes, o.Saturday, o.TimeLimit, o.Threads));
        Assert.Equal(["--prove-plateau", "--prove-strategy"], o.Ignored);
    }

    [Fact]
    public void Edit_commands_accept_the_original_flags_and_defaults()
    {
        var filter = EditOptions.Parse("filter", ["-i", Path.Combine(_dir, "out", "x", "schedule.xlsx"), "-c", "21cs001t,21cs002t", "-y"]);
        filter.Require();
        Assert.Equal(Path.Combine(_dir, "out", "x"), filter.SourceFolder);
        Assert.Equal(["21CS001T", "21CS002T"], filter.Courses);
        Assert.Equal("unislot-out-fix", EditOptions.Parse("fix-course", []).DefaultOutput);
        Assert.Equal("unislot-out-fix", EditOptions.Parse("drop-course", []).DefaultOutput);
        Assert.Equal("unislot-out-rectified", EditOptions.Parse("rectify", []).DefaultOutput);
        Assert.Equal("unislot-out-revert", EditOptions.Parse("revert", []).DefaultOutput);
        Assert.Equal("unislot-out-late", EditOptions.Parse("late", []).DefaultOutput);

        var late = EditOptions.Parse("late", ["--previous", "a", "--late", "b.xlsx", "--nomenclature", "n.xlsx", "--workers", "4", "--prove", "--no-saturday", "--overflow-buffer", "3", "-y"]);
        late.Require();
        Assert.True(late.Yes);
        Assert.Contains("--workers", late.Ignored);

        var ex = Assert.Throws<ArgumentException>(() => EditOptions.Parse("late", ["--on-full", "buffer"]));
        Assert.Contains("not available", ex.Message, StringComparison.Ordinal);
        Assert.Throws<ArgumentException>(() => EditOptions.Parse("late", ["--on-clash", "drop-course"]));
    }

    [Fact]
    public async Task Usage_mistakes_exit_with_64_and_help_lists_every_command()
    {
        var prefs = Prefs();
        Assert.Equal(64, (await Run(["frobnicate"], NewConsole(), prefs, false)).Code);
        Assert.Equal(64, (await Run(["--bogus"], NewConsole(), prefs, false)).Code);
        Assert.Equal(64, (await Run([], NewConsole(), prefs, false)).Code);       // no terminal and no command: help
        Assert.Equal(64, (await Run(["--tui"], NewConsole(), prefs, false)).Code);
        Assert.Equal(64, (await Run(["late", "-y"], NewConsole(), prefs, false)).Code);   // -y never asks: missing options are an error

        var help = await Run(["--help"], NewConsole(), prefs, false);
        Assert.Equal(0, help.Code);
        foreach (string word in new[] { "solve", "rectify", "late", "fix-course", "drop-course", "revert", "name-list", "filter", "issues", "doctor", "--tui", "-y" })
            Assert.Contains(word, help.Out, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Doctor_checks_the_search_engine_and_the_exact_stage()
    {
        var c = NewConsole();
        var (code, _, _) = await Run(["doctor"], c, Prefs(), interactive: false);
        Assert.Equal(0, code);
        Assert.Contains("Ready to schedule.", c.Output, StringComparison.Ordinal);
        Assert.Contains("Exact stage: CP-SAT", c.Output, StringComparison.Ordinal);
    }

    // ---- the interactive classic flow --------------------------------------------------------------------------------------------------
    [Fact]
    public async Task The_menu_lists_the_original_nine_choices_in_the_original_order()
    {
        var c = NewConsole();
        // pick "Export name list" (7th) in a folder that has no timetable, then leave via the empty-path prompt
        Assert.Equal(0, await RunMenuUntilEnd(c, downs: 6));
        string text = c.Output;
        string[] order = ["Create schedule", "Rectify schedule", "Add late enrollments", "Fix wrong student course", "Remove student from a course",
            "Undo a wrong delete or fix", "Export name list", "Filter schedule", "Find enrollment issues"];
        string[] hints = ["Build a new timetable from enrollment data", "Adapt an existing schedule after registration changes", "Place new enrollments without moving published classes",
            "Replace one incorrect enrollment and place the new course", "Remove one enrollment while keeping the timetable frozen",
            "Deleted the wrong course? Restore it from an older output folder", "Rebuild the input-format name list from any output folder",
            "Export a focused schedule by course code", "Check the source file before scheduling"];
        int last = -1;
        for (int i = 0; i < order.Length; i++)
        {
            int at = text.IndexOf(order[i], StringComparison.Ordinal);
            Assert.True(at > last, $"{order[i]} out of order");
            Assert.True(text.IndexOf(hints[i], StringComparison.Ordinal) > at, $"hint for {order[i]} missing or misplaced");
            last = at;
        }
    }

    private async Task<int> RunMenuUntilEnd(TestConsole c, int downs)
    {
        await Publish("base");
        for (int i = 0; i < downs; i++) c.Input.PushKey(ConsoleKey.DownArrow);
        c.Input.PushKey(ConsoleKey.Enter);   // the menu choice
        c.Input.PushKey(ConsoleKey.Enter);   // the first folder offered
        return await Run([], c, Prefs(), interactive: true).ContinueWith(t => t.Result.Code);
    }

    [Fact]
    public async Task Create_schedule_asks_the_original_questions_and_writes_the_folder()
    {
        string wb = Workbook("data.xlsx");
        string outDir = Path.Combine(_dir, "classic-out");
        var prefs = Prefs();
        prefs.LastFile = wb;
        prefs.Quality = 0;
        var c = NewConsole();
        c.Input.PushKey(ConsoleKey.Enter);               // menu: Create schedule
        c.Input.PushKey(ConsoleKey.Enter);               // reuse a seed? default: no
        c.Input.PushKey(ConsoleKey.Enter);               // Saturday for maths? default: no
        c.Input.PushKey(ConsoleKey.Enter);               // extra Saturday codes: none
        c.Input.PushKey(ConsoleKey.Enter);               // the workbook offered first (last used)
        c.Input.PushTextWithEnter(outDir);               // output folder
        var (code, _, _) = await Run([], c, prefs, interactive: true);

        Assert.Equal(0, code);
        Assert.True(File.Exists(Path.Combine(outDir, "schedule.xlsx")));
        string text = c.Output;
        // the original tool's own wording, and its order: seed, Saturday, workbook
        int seed = text.IndexOf("Do you have a seed from a previous run?", StringComparison.Ordinal);
        int sat = text.IndexOf("Use Saturday slot for maths courses?", StringComparison.Ordinal);
        int codes = text.IndexOf("Extra course codes allowed on Saturday (comma-separated, optional)", StringComparison.Ordinal);
        int file = text.IndexOf("Choose a workbook", StringComparison.Ordinal);
        Assert.True(seed >= 0 && seed < sat && sat < codes && codes < file, $"{seed} {sat} {codes} {file}");
        Assert.Contains("Output folder", text, StringComparison.Ordinal);
        Assert.Contains("Result", text, StringComparison.Ordinal);
        Assert.Contains("Done.", text, StringComparison.Ordinal);
        Assert.Contains("schedule.xlsx", text, StringComparison.Ordinal);
        Assert.Equal(wb, prefs.LastFile);
    }

    [Fact]
    public async Task Flags_given_on_the_command_line_are_not_asked_again()
    {
        string wb = Workbook("data.xlsx");
        string outDir = Path.Combine(_dir, "partial");
        var c = NewConsole();
        // only the seed question remains (answer: no)
        c.Input.PushKey(ConsoleKey.Enter);
        var (code, _, _) = await Run(["solve", "-i", wb, "-o", outDir, "--no-saturday", "--saturday-codes", "", "--preset", "quick"], c, Prefs(), interactive: true);
        // -i and -o together run scripted without questions: the seed prompt is never shown
        Assert.Equal(0, code);
        Assert.DoesNotContain("Reuse the seed", c.Output, StringComparison.Ordinal);

        var asked = NewConsole();
        asked.Input.PushKey(ConsoleKey.Enter);           // reuse a seed? no
        asked.Input.PushTextWithEnter(Path.Combine(_dir, "partial2"));   // output folder (the only other question)
        var second = await Run(["-i", wb, "--no-saturday", "--saturday-codes", "", "--preset", "quick"], asked, Prefs(), interactive: true);
        Assert.Equal(0, second.Code);
        Assert.DoesNotContain("Allow Saturday", asked.Output, StringComparison.Ordinal);
        Assert.True(File.Exists(Path.Combine(_dir, "partial2", "schedule.xlsx")));
    }

    [Fact]
    public async Task A_command_with_missing_options_on_a_terminal_asks_for_them()
    {
        string prev = await Publish("base");
        var c = NewConsole();
        c.Input.PushKey(ConsoleKey.Enter);               // the timetable folder offered first
        var (code, _, _) = await Run(["name-list"], c, Prefs(), interactive: true);
        Assert.Equal(0, code);
        Assert.True(File.Exists(Path.Combine(prev, "name-list.xlsx")));
    }

    [Fact]
    public async Task Options_already_given_are_not_asked_again_by_maintenance_commands()
    {
        string prev = await Publish("base");
        string late = Path.Combine(_dir, "late.xlsx");
        using (var wb = new XLWorkbook())
        {
            var ws = wb.AddWorksheet("Sheet1");
            string?[][] rows = [[.. TestData.Header], ["B.Tech-Computer Science", "RAL1", "late one", null, null, "21CS001T", "Late Course", null]];
            for (int r = 0; r < rows.Length; r++)
                for (int col = 0; col < rows[r].Length; col++)
                    if (rows[r][col] is { } v) ws.Cell(r + 1, col + 1).Value = v;
            wb.SaveAs(late);
        }
        string outDir = Path.Combine(_dir, "late-out");
        var prefs = Prefs();
        prefs.LastFile = late;
        var c = NewConsole();
        c.Input.PushKey(ConsoleKey.Enter);               // the workbook offered first (the only missing answer)
        c.Input.PushKey(ConsoleKey.Enter);               // clash decision: default (the full-course decision was given)
        c.Input.PushKey(ConsoleKey.Enter);               // apply
        var (code, _, _) = await Run(["late", "--previous", prev, "--on-full", "park", "-o", outDir], c, prefs, interactive: true);
        Assert.Equal(0, code);
        Assert.True(File.Exists(Path.Combine(outDir, "snapshot.json")));
        Assert.DoesNotContain("Choose the published timetable", c.Output, StringComparison.Ordinal);   // --previous was given
        Assert.DoesNotContain("When a course is already full", c.Output, StringComparison.Ordinal);            // --on-full was given
        Assert.DoesNotContain("Output folder", c.Output, StringComparison.Ordinal);                    // -o was given
    }

    [Fact]
    public async Task Classic_mode_never_clears_the_screen_or_waits_for_a_key()
    {
        await Publish("base");
        var c = NewConsole();
        c.Input.PushKey(ConsoleKey.Enter);               // folder
        // no key left for a "press any key" pause: a pause would throw on the empty scripted input
        var (code, _, _) = await Run(["name-list"], c, Prefs(), interactive: true);
        Assert.Equal(0, code);
        Assert.DoesNotContain("Press any key", c.Output, StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_tui_flag_still_opens_the_full_screen_application()
    {
        var c = NewConsole();
        c.Input.PushKey(ConsoleKey.UpArrow);             // wrap to the last item: Quit
        c.Input.PushKey(ConsoleKey.Enter);
        var (code, _, _) = await Run(["--tui"], c, Prefs(), interactive: true);
        Assert.Equal(0, code);
        Assert.Contains("New timetable", c.Output, StringComparison.Ordinal);
    }
}
