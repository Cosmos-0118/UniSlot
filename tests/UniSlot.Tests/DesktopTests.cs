using System.Text.Json;
using System.Text.RegularExpressions;
using ClosedXML.Excel;
using UniSlot.Application.Workflow;
using UniSlot.Desktop.Services;
using UniSlot.Desktop.ViewModels;
using UniSlot.Domain;
using UniSlot.Solver;

namespace UniSlot.Tests;

public partial class LocalizationTests
{
    private static Dictionary<string, string> Load(string code)
    {
        using var stream = typeof(Loc).Assembly.GetManifestResourceStream($"UniSlot.Desktop.Resources.Strings.{code}.json")
            ?? throw new InvalidOperationException($"missing resource for {code}");
        return JsonSerializer.Deserialize<Dictionary<string, string>>(stream)!;
    }

    public static IEnumerable<object[]> Languages() => Loc.Languages.Where(l => l.Code != "en").Select(l => new object[] { l.Code });

    [Fact]
    public void English_is_complete_and_has_no_blank_strings()
    {
        var en = Load("en");
        Assert.True(en.Count > 90);
        Assert.All(en, kv => Assert.False(string.IsNullOrWhiteSpace(kv.Value), kv.Key));
    }

    [Theory]
    [MemberData(nameof(Languages))]
    public void Every_language_has_exactly_the_same_keys_as_english(string code)
    {
        var en = Load("en");
        var other = Load(code);
        Assert.Empty(en.Keys.Except(other.Keys));
        Assert.Empty(other.Keys.Except(en.Keys));
    }

    [Theory]
    [MemberData(nameof(Languages))]
    public void Placeholders_match_english_in_every_language(string code)
    {
        var en = Load("en");
        var other = Load(code);
        foreach (var (key, text) in en)
            Assert.Equal(Placeholders(text), Placeholders(other[key]));
    }

    [Theory]
    [MemberData(nameof(Languages))]
    public void Translations_are_actually_translated(string code)
    {
        var en = Load("en");
        var other = Load(code);
        // allow identical product names / abbreviations, but most strings must differ from English
        int same = en.Count(kv => other[kv.Key] == kv.Value);
        Assert.True(same < en.Count * 0.12, $"{code}: {same} of {en.Count} strings are identical to English");
    }

    [Fact]
    public void Missing_keys_fall_back_to_english_then_to_the_key()
    {
        Loc.Instance.SetLanguage("de");
        Assert.Equal("Einstellungen", Loc.T("nav.settings"));
        Assert.Equal("no.such.key", Loc.T("no.such.key"));
        Loc.Instance.SetLanguage("en");
        Assert.Equal("Settings", Loc.T("nav.settings"));
    }

    private static string Placeholders(string s) => string.Join(",", PlaceholderPattern().Matches(s).Select(m => m.Value).Order());

    [GeneratedRegex(@"\{\d+\}")]
    private static partial Regex PlaceholderPattern();
}

public class ViewModelTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "unislot-vm-" + Guid.NewGuid().ToString("N"));

    public ViewModelTests() => Directory.CreateDirectory(_dir);

    public void Dispose()
    {
        Loc.Instance.SetLanguage("en");
        if (Directory.Exists(_dir)) Directory.Delete(_dir, recursive: true);
    }

    private string Workbook(int students = 120, int courses = 25)
    {
        string path = Path.Combine(_dir, "enrollment.xlsx");
        using var wb = new XLWorkbook();
        var ws = wb.AddWorksheet("Sheet1");
        var grid = TestData.Grid(students, courses, 4, seed: 21);
        for (int r = 0; r < grid.Count; r++)
            for (int c = 0; c < grid[r].Count; c++)
                if (grid[r][c] is { } v) ws.Cell(r + 1, c + 1).Value = v;
        wb.SaveAs(path);
        return path;
    }

    private AppSettings Settings() => new() { OutputRoot = Path.Combine(_dir, "out"), Quality = 0 };

    [Fact]
    public async Task Solving_a_workbook_publishes_results_and_writes_the_output_folder()
    {
        SolveOutcome? got = null;
        string? folder = null;
        var vm = new SolveViewModel(Settings(), (o, f) => { got = o; folder = f; });
        vm.SetFile(Workbook());
        Assert.True(vm.StartCommand.CanExecute(null));

        await vm.StartCommand.ExecuteAsync(null);

        Assert.NotNull(got);
        Assert.True(got!.Audit.IsStructurallyFeasible);
        Assert.True(Directory.Exists(folder));
        Assert.True(File.Exists(Path.Combine(folder!, "schedule.xlsx")));
        Assert.False(vm.IsRunning);
        Assert.False(vm.HasError);
        Assert.Equal(folder, vm.SavedTo);
    }

    [Fact]
    public async Task A_workbook_without_the_required_columns_shows_a_readable_error()
    {
        string path = Path.Combine(_dir, "bad.xlsx");
        using (var wb = new XLWorkbook())
        {
            wb.AddWorksheet("S").Cell(1, 1).Value = "nothing useful";
            wb.SaveAs(path);
        }
        var vm = new SolveViewModel(Settings(), (_, _) => Assert.Fail("must not complete"));
        vm.SetFile(path);

        await vm.StartCommand.ExecuteAsync(null);

        Assert.True(vm.HasError);
        Assert.NotEmpty(vm.ErrorLines);
        Assert.False(vm.IsRunning);
    }

    [Fact]
    public void Starting_requires_a_file_and_is_blocked_while_running()
    {
        var vm = new SolveViewModel(Settings(), (_, _) => { });
        Assert.False(vm.StartCommand.CanExecute(null));
        vm.SetFile("x.xlsx");
        Assert.True(vm.StartCommand.CanExecute(null));
        vm.IsRunning = true;
        Assert.False(vm.StartCommand.CanExecute(null));
    }

    [Fact]
    public void Preferences_persist_to_the_settings_object()
    {
        var settings = Settings();
        var vm = new SolveViewModel(settings, (_, _) => { }) { QualityIndex = 2, AllowSaturday = true };
        Assert.Equal(2, settings.Quality);
        Assert.True(settings.AllowSaturday);
    }

    [Fact]
    public void Results_and_schedule_follow_the_language_and_the_weekday_count()
    {
        var outcome = new SolveWorkflow(new AnnealingEngine()).Run(
            new SolveInput(new SourceInfo("a.xlsx", 1, "00"), TestData.Grid(150, 30, 4, seed: 31)),
            new SolveSettings { Search = new SearchOptions { Chains = 2, MovesPerChain = 200_000 } }, null, CancellationToken.None);

        var results = new ResultsViewModel();
        var schedule = new ScheduleViewModel();
        results.Load(outcome, _dir);
        schedule.Load(outcome.Schedule, outcome.Settings.Policy.WeekdayCount);

        Assert.True(results.HasResults);
        Assert.Equal(outcome.RedStudents, results.Red);
        Assert.Equal(outcome.RedStudents + results.Clean, outcome.Roster.Students.Count);
        Assert.Equal(5, results.Bars.Count);
        Assert.Equal("Monday", results.Bars[0].Name);
        Assert.Equal(6, schedule.DayFilters.Count);            // "All days" + Monday..Friday: Saturday is closed
        Assert.Equal(outcome.Sections.Count, schedule.Rows.Count);

        Loc.Instance.SetLanguage("es");
        Assert.Equal("Lunes", results.Bars[0].Name);
        Assert.Equal("Todos los días", schedule.DayFilters[0]);
        Assert.Contains("estudiantes", results.FileLine);

        schedule.DayFilter = 2;                                  // Tuesday
        Assert.All(schedule.Rows, r => Assert.Equal(1, r.Day));
        schedule.Search = outcome.Schedule.First(e => e.Day == Weekday.Tuesday).CourseCode;
        Assert.NotEmpty(schedule.Rows);
        Assert.All(schedule.Rows, r => Assert.Contains(schedule.Search, r.CourseCode));
    }

    [Fact]
    public void Clashes_list_matches_the_red_count()
    {
        var outcome = new SolveWorkflow(new AnnealingEngine()).Run(
            new SolveInput(new SourceInfo("a.xlsx", 1, "00"), TestData.Grid(300, 30, 5, seed: 41)),
            new SolveSettings { Search = new SearchOptions { Chains = 2, MovesPerChain = 200_000 } }, null, CancellationToken.None);
        var clashes = new ClashesViewModel();
        clashes.Load(outcome);
        Assert.Equal(outcome.RedStudents, clashes.Rows.Count);
        Assert.Equal(outcome.RedStudents > 0, clashes.HasClashes);
    }
}
