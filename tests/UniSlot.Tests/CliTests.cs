using System.Text.RegularExpressions;
using ClosedXML.Excel;
using Spectre.Console;
using Spectre.Console.Testing;
using UniSlot.Application.Importing;
using UniSlot.Application.Workflow;
using UniSlot.Cli;
using UniSlot.Solver;

namespace UniSlot.Tests;

public partial class LocalizationTests
{
    [Fact]
    public void Every_language_has_exactly_the_english_keys()
    {
        var english = Loc.Table("en");
        foreach (var lang in Loc.Languages)
        {
            var table = Loc.Table(lang.Code);
            Assert.Empty(english.Keys.Except(table.Keys));
            Assert.Empty(table.Keys.Except(english.Keys));
        }
    }

    [Fact]
    public void Placeholders_match_english_in_every_language()
    {
        var english = Loc.Table("en");
        foreach (var lang in Loc.Languages)
            foreach (var (key, value) in Loc.Table(lang.Code))
                Assert.True(Placeholders(english[key]).SetEquals(Placeholders(value)), $"{lang.Code}:{key} -> {value}");
    }

    [Fact]
    public void No_value_is_empty_or_mojibake()
    {
        foreach (var lang in Loc.Languages)
            foreach (var (key, value) in Loc.Table(lang.Code))
            {
                Assert.False(string.IsNullOrWhiteSpace(value), $"{lang.Code}:{key} is empty");
                Assert.DoesNotContain('\uFFFD', value);
            }
    }

    [Fact]
    public void Every_key_the_cli_uses_exists()
    {
        string root = FindRepoRoot();
        var english = Loc.Table("en");
        var used = Directory.EnumerateFiles(Path.Combine(root, "src", "UniSlot.Cli"), "*.cs")
            .SelectMany(f => KeyPattern().Matches(File.ReadAllText(f)).Select(m => m.Groups[1].Value))
            .Where(k => !k.Contains('{')).Distinct().ToList();
        Assert.NotEmpty(used);
        Assert.All(used, k => Assert.True(english.ContainsKey(k), $"missing string key {k}"));
    }

    [GeneratedRegex(@"Loc\.[TF]\(""([^""]+)""")] private static partial Regex KeyPattern();

    private static HashSet<string> Placeholders(string s) => [.. PlaceholderPattern().Matches(s).Select(m => m.Value)];

    [GeneratedRegex(@"\{\d+\}")] private static partial Regex PlaceholderPattern();

    internal static string FindRepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "UniSlot.slnx"))) dir = dir.Parent;
        return dir?.FullName ?? throw new InvalidOperationException("repository root not found");
    }
}

public class OptionsTests
{
    [Fact]
    public void Parses_a_full_command_line()
    {
        var o = Options.Parse(["-i", "a.xlsx", "-o", "out", "--seed", "7", "--preset", "thorough", "--chains", "4", "--saturday", "--prove", "--show", "schedule,clashes", "--limit", "5", "--lang", "ta"]);
        Assert.Equal("a.xlsx", o.Input);
        Assert.Equal("out", o.Output);
        Assert.Equal(7UL, o.Seed);
        Assert.Equal(Options.Thorough, o.Moves);
        Assert.Equal(4, o.Chains);
        Assert.True(o.Saturday);
        Assert.True(o.Prove);
        Assert.Equal(["schedule", "clashes"], o.Show);
        Assert.Equal(5, o.Limit);
        Assert.Equal("ta", o.Lang);
    }

    [Theory]
    [InlineData("--bogus")]
    [InlineData("--seed", "-1")]
    [InlineData("--preset", "fast")]
    [InlineData("--moves", "0")]
    [InlineData("--show", "everything")]
    [InlineData("-i")]
    public void Rejects_bad_options(params string[] args) => Assert.Throws<ArgumentException>(() => Options.Parse(args));

    [Fact]
    public void Scripted_settings_ignore_saved_preferences_but_honour_flags()
    {
        var prefs = new CliSettings { Quality = 2, Seed = 99, AllowSaturday = true, Prove = true };
        var scripted = SolveRunner.BuildSettings(new CliSettings(), Options.Parse(["-i", "x"]));
        Assert.Equal(1UL, scripted.Search.Seed);
        Assert.Equal(Options.Standard, scripted.Search.MovesPerChain);
        Assert.False(scripted.Prove);
        Assert.False(scripted.Policy.AllowSaturdayForMaths);

        var interactive = SolveRunner.BuildSettings(prefs, untimedProof: true);
        Assert.Equal(99UL, interactive.Search.Seed);
        Assert.Equal(Options.Thorough, interactive.Search.MovesPerChain);
        Assert.True(interactive.Prove);
        Assert.Null(interactive.ProofTimeLimit);
    }
}

public sealed class SettingsFileTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("unislot-settings-").FullName;

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    [Fact]
    public void Round_trips_and_keeps_the_earlier_file_format()
    {
        string path = Path.Combine(_dir, "s.json");
        var s = CliSettings.LoadFrom(path);
        s.Language = "de"; s.Institution = "Example"; s.Quality = 2; s.Seed = 5; s.Save();
        var back = CliSettings.LoadFrom(path);
        Assert.Equal(("de", "Example", 2, 5L), (back.Language, back.Institution, back.Quality, back.Seed));

        File.WriteAllText(path, """{ "Language": "fr", "Theme": "dark", "UiScale": 1.2, "WindowWidth": 900 }""");
        Assert.Equal("fr", CliSettings.LoadFrom(path).Language);
    }

    [Fact]
    public void Corrupt_or_out_of_range_files_fall_back_to_defaults()
    {
        string path = Path.Combine(_dir, "bad.json");
        File.WriteAllText(path, "{ not json");
        Assert.Equal("en", CliSettings.LoadFrom(path).Language);
        File.WriteAllText(path, """{ "Quality": 9, "Seed": -4, "OutputRoot": "" }""");
        var s = CliSettings.LoadFrom(path);
        Assert.Equal((2, 1L), (s.Quality, s.Seed));
        Assert.False(string.IsNullOrWhiteSpace(s.OutputRoot));
    }

    [Fact]
    public void An_in_memory_instance_never_writes()
    {
        new CliSettings { Language = "es" }.Save();
        Assert.Empty(Directory.GetFiles(_dir));
    }
}

public class ProgressSinkTests
{
    [Fact]
    public void Updates_only_move_forward_even_when_delivered_out_of_order()
    {
        var sink = new ProgressSink();
        sink.Report(new SolveProgress(SolveStage.Searching, 0.5, 40, 60));
        sink.Report(new SolveProgress(SolveStage.Planning, 0.05));            // late
        sink.Report(new SolveProgress(SolveStage.Searching, 0.3, 45, 50));    // older, worse
        sink.Report(new SolveProgress(SolveStage.Searching, 0.6, 38, 55));
        var s = sink.Snapshot();
        Assert.Equal(ProgressSink.Searching, s.Rank);
        Assert.Equal(0.6, s.Fraction);
        Assert.Equal((38, 55), (s.BestRed, s.BestClash));
        Assert.All(s.Entered.Take(ProgressSink.Searching + 1), t => Assert.NotNull(t));
        Assert.Null(s.Entered[ProgressSink.Proving]);
    }
}

public class FilePromptTests
{
    [Theory]
    [InlineData("\"C:\\a b\\x.xlsx\"", "C:\\a b\\x.xlsx")]
    [InlineData("  'x.xlsx'  ", "x.xlsx")]
    public void Clean_strips_drag_and_drop_quotes(string input, string expected) => Assert.Equal(expected, Wizard.Clean(input));

    [Fact]
    public void Validate_requires_an_existing_excel_file()
    {
        Assert.False(Wizard.Validate("").Successful);
        Assert.False(Wizard.Validate("nope.xlsx").Successful);
        string txt = Path.GetTempFileName();
        try { Assert.False(Wizard.Validate(txt).Successful); }
        finally { File.Delete(txt); }
    }
}

/// <summary>Drives the real screens through Spectre's test console with scripted key presses.</summary>
public sealed class ScreenTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("unislot-cli-").FullName;

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private static TestConsole Console(int width = 120)
    {
        var c = new TestConsole().Interactive();
        c.Profile.Width = width;
        return c;
    }

    private static void Keys(TestConsole c, params ConsoleKey[] keys)
    {
        foreach (var k in keys) c.Input.PushKey(k);
    }

    private string Workbook(string title = "course 1", int students = 60, int courses = 14, bool hostile = false)
    {
        var grid = TestData.Grid(students, courses, 4, seed: 3);
        string path = Path.Combine(_dir, "enrolment.xlsx");
        using var wb = new XLWorkbook();
        var ws = wb.AddWorksheet("Sheet1");
        for (int r = 0; r < grid.Count; r++)
            for (int col = 0; col < grid[r].Count; col++)
            {
                string? v = grid[r][col];
                if (hostile && r > 0 && col == 6) v = $"[red]Title[/] [{r}";
                if (hostile && r > 0 && col == 2) v = "[bold]Name [x";
                if (v is not null) ws.Cell(r + 1, col + 1).Value = v;
            }
        wb.SaveAs(path);
        return path;
    }

    private CliSettings Prefs() => new() { OutputRoot = Path.Combine(_dir, "out") };

    [Fact]
    public async Task Menu_opens_settings_and_quits()
    {
        var c = Console();
        // Menu: New, Update, Issues, Names, Filter, Settings, Quit. Settings: Language, Institution, Output, Seed, Back.
        Keys(c, ConsoleKey.DownArrow, ConsoleKey.DownArrow, ConsoleKey.DownArrow, ConsoleKey.DownArrow, ConsoleKey.DownArrow, ConsoleKey.Enter,
            ConsoleKey.DownArrow, ConsoleKey.DownArrow, ConsoleKey.DownArrow, ConsoleKey.DownArrow, ConsoleKey.Enter,
            ConsoleKey.UpArrow, ConsoleKey.Enter);   // Up from the first item wraps to Quit
        Assert.Equal(0, await new App(c, Prefs()).RunAsync(startWithWizard: false));
        Assert.Contains("UniSlot", c.Output);
    }

    [Fact]
    public void Wizard_collects_choices_and_confirms()
    {
        var c = Console();
        string file = Workbook();
        // file, Quick→Thorough (2 down), skip proof, Saturday yes (1 down), no codes, Start.
        Keys(c, ConsoleKey.Enter,
            ConsoleKey.DownArrow, ConsoleKey.DownArrow, ConsoleKey.Enter, ConsoleKey.Enter,
            ConsoleKey.DownArrow, ConsoleKey.Enter);
        c.Input.PushTextWithEnter("21CSC101T");
        Keys(c, ConsoleKey.Enter);
        var choices = Wizard.Run(c, Prefs(), file);
        Assert.NotNull(choices);
        Assert.Equal(file, choices!.File);
        Assert.Equal(2, choices.Quality);
        Assert.False(choices.Prove);
        Assert.True(choices.Saturday);
        Assert.Equal("21CSC101T", choices.SaturdayCodes);
        Assert.Contains("21CSC101T", c.Output);
    }

    [Fact]
    public void Wizard_can_be_cancelled_at_the_summary()
    {
        var c = Console();
        Keys(c, ConsoleKey.Enter, ConsoleKey.Enter, ConsoleKey.Enter, ConsoleKey.Enter, ConsoleKey.Enter, ConsoleKey.UpArrow, ConsoleKey.Enter);
        Assert.Null(Wizard.Run(c, Prefs(), Workbook()));
    }

    [Fact]
    public async Task Full_flow_solves_writes_files_and_shows_results()
    {
        var c = Console();
        var prefs = Prefs();
        string file = Workbook(hostile: true);
        // wizard (Quick preset): file, quality Quick, no proof, no Saturday, no codes, Start; results: schedule → back; clashes → back; Quit.
        Keys(c, ConsoleKey.Enter, ConsoleKey.Enter, ConsoleKey.Enter, ConsoleKey.Enter);
        Keys(c, ConsoleKey.Enter);       // codes prompt (empty)
        Keys(c, ConsoleKey.Enter);       // Start
        // Results menu: Schedule (Enter) → Back (Up wraps from first to last = Back); then Quit (Up wraps to last).
        Keys(c, ConsoleKey.Enter, ConsoleKey.UpArrow, ConsoleKey.Enter);
        Keys(c, ConsoleKey.UpArrow, ConsoleKey.Enter);

        prefs.Quality = 0;
        Assert.Equal(0, await new App(c, prefs).RunAsync(startWithWizard: true, preselected: file));

        Assert.True(File.Exists(Directory.EnumerateFiles(prefs.OutputRoot, "schedule.xlsx", SearchOption.AllDirectories).First()));
        Assert.Contains("Saved to", c.Output);
        Assert.Contains("[red]Title[/", c.Output, StringComparison.OrdinalIgnoreCase);   // hostile markup characters are shown literally, not interpreted
        Assert.Contains("[red]Title[/", c.Output, StringComparison.OrdinalIgnoreCase);   // hostile markup is shown literally, not interpreted
        Assert.Contains(file, prefs.LastFile);
    }

    [Fact]
    public async Task Dashboard_and_tables_render_hostile_text_literally()
    {
        string file = Workbook(hostile: true);
        var run = await SolveRunner.RunAsync(new SolveRequest(file, Path.Combine(_dir, "o"),
            SolveRunner.BuildSettings(new CliSettings(), Options.Parse(["--preset", "quick", "--chains", "2"])), null), null, CancellationToken.None);

        foreach (int width in new[] { 60, 80, 120 })
        {
            var c = Console(width);
            ResultsView.Dashboard(c, run);
            c.Write(ResultsView.ScheduleTable(c, run.Outcome.Schedule));
            c.Write(ResultsView.ClashTable(c, ResultsView.FilterClashes(run.Outcome.Clash.Students, "")));
            Assert.Contains("[red]Title[/", c.Output, StringComparison.OrdinalIgnoreCase);   // shown literally, even when a narrow column wraps it
        }
    }

    [Fact]
    public async Task Run_view_renders_every_stage_without_throwing()
    {
        var sink = new ProgressSink();
        foreach (var stage in Enum.GetValues<SolveStage>())
        {
            sink.Report(new SolveProgress(stage, 0.5, 10, 20));
            foreach (bool proof in new[] { true, false })
            {
                var c = Console(70);
                c.Write(RunView.Render(c, sink.Snapshot(), proof, "[weird].xlsx", tick: 7));
                Assert.Contains("[weird].xlsx", c.Output);
            }
        }
        sink.Finish();
        var done = Console();
        done.Write(RunView.Render(done, sink.Snapshot(), true, "a.xlsx", 0));
        Assert.Contains("100%", done.Output);
        await Task.CompletedTask;
    }

    [Fact]
    public void Rejected_workbook_errors_are_escaped()
    {
        var parsed = EnrollmentParser.Parse([new string?[] { "[Foo", "Bar]" }, new string?[] { "1", "2" }]);
        var c = Console();
        Assert.True(Program.Report(c, new InputRejectedException(parsed.Validation)));
        Assert.Contains("Missing required columns", c.Output);
    }

    [Fact]
    public void Cancellation_is_reported_not_thrown()
    {
        var c = Console();
        Assert.True(Program.Report(c, new OperationCanceledException()));
        Assert.False(Program.Report(c, new InvalidOperationException("bug")));
    }
}

public class WorkbookReadingTests
{
    [Fact]
    public void A_file_that_is_not_a_workbook_is_reported_as_invalid_data()
    {
        Assert.Throws<InvalidDataException>(() => UniSlot.Infrastructure.XlsxEnrollmentSource.ReadGrid("not an xlsx"u8.ToArray()));
        Assert.Throws<InvalidDataException>(() => UniSlot.Infrastructure.XlsxEnrollmentSource.ReadGrid([]));
    }
}
