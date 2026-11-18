using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using UniSlot.Application.Workflow;
using UniSlot.Domain;
using UniSlot.Desktop.Services;

namespace UniSlot.Desktop.ViewModels;

public sealed record WeekdayBar(int Day, string Name, int Sections, double Fraction);

public sealed partial class ResultsViewModel : LocalizedViewModel
{
    private SolveOutcome? _outcome;

    [ObservableProperty, NotifyPropertyChangedFor(nameof(IsEmpty))] private bool _hasResults;
    [ObservableProperty] private string? _folder;
    [ObservableProperty] private int _red;
    [ObservableProperty] private int _clean;
    [ObservableProperty] private int _sections;
    [ObservableProperty] private string _redHint = "";
    [ObservableProperty] private string _rulesText = "";
    [ObservableProperty] private bool _rulesOk = true;
    [ObservableProperty] private string _proofText = "";
    [ObservableProperty] private string _boundText = "";
    [ObservableProperty] private string _engine = "";
    [ObservableProperty] private string _reproCode = "";
    [ObservableProperty] private string _fileLine = "";
    [ObservableProperty] private IReadOnlyList<WeekdayBar> _bars = [];
    [ObservableProperty] private IReadOnlyList<string> _insights = [];
    [ObservableProperty] private IReadOnlyList<string> _warnings = [];

    public bool IsEmpty => !HasResults;
    public bool HasInsights => Insights.Count > 0;
    public bool HasWarnings => Warnings.Count > 0;

    public void Load(SolveOutcome outcome, string folder)
    {
        _outcome = outcome;
        Folder = folder;
        HasResults = true;
        Red = outcome.RedStudents;
        Clean = outcome.Clash.ClashFreeStudents;
        Sections = outcome.Sections.Count;
        Engine = outcome.Search.Engine + (outcome.Proof is null ? "" : " + " + outcome.Proof.Engine);
        ReproCode = outcome.Search.Options.ReproToken;
        Refresh();
    }

    private void Refresh()
    {
        if (_outcome is not { } o) return;
        FileLine = Loc.Instance.Format("results.fileLine", o.Source.FileName, o.Roster.Students.Count.ToString("N0", CultureInfo.CurrentCulture),
            o.Roster.Courses.Count.ToString("N0", CultureInfo.CurrentCulture));
        RedHint = Loc.Instance.Format("card.red.hint", o.Bounds.MinRedStudents);
        RulesOk = o.Audit.IsStructurallyFeasible;
        RulesText = RulesOk ? Loc.T("rules.ok") : Loc.Instance.Format("rules.bad", o.Audit.Structural.Count);
        ProofText = o.RedProvenOptimal ? Loc.T("results.proven") : Loc.T("results.notProven");
        BoundText = o.Proof is null ? "" : Loc.Instance.Format("results.bound", o.Proof.RedLowerBound);
        int max = Math.Max(1, o.Metrics.SectionsPerWeekday.Max());
        Bars = [.. o.Metrics.SectionsPerWeekday.Select((n, d) => new WeekdayBar(d, Loc.T($"day.{d}"), n, n / (double)max))];
        Insights = [.. o.Bounds.Insights.Select(i => Loc.Instance.Format($"insight.{i.Code}", i.Args.Cast<object>().ToArray()))];
        Warnings = [.. o.Validation.Warnings.Take(8).Select(w => w.Message)];
        OnPropertyChanged(nameof(HasInsights));
        OnPropertyChanged(nameof(HasWarnings));
    }

    [RelayCommand]
    private void OpenFolder()
    {
        if (Folder is not null) Shell.OpenFolder(Folder);
    }

    protected override void OnLanguageChanged() => Refresh();
}

public sealed record ScheduleRow(int Day, string DayName, int Lane, string CourseCode, string Title, int Section, int Students, string Programs, string Faculty);

public sealed partial class ScheduleViewModel : LocalizedViewModel
{
    private IReadOnlyList<ScheduleRow> _all = [];
    private IReadOnlyList<ScheduleEntry> _entries = [];
    private int _weekdays = 5;

    [ObservableProperty] private int _dayFilter;
    [ObservableProperty] private string _search = "";
    [ObservableProperty] private IReadOnlyList<ScheduleRow> _rows = [];
    [ObservableProperty] private string _countText = "";

    public ObservableCollection<string> DayFilters { get; } = [];

    public ScheduleViewModel() => BuildFilters();

    public void Load(IReadOnlyList<ScheduleEntry> entries, int weekdays)
    {
        _entries = entries;
        _weekdays = weekdays;
        DayFilter = 0;
        BuildFilters();
        Rebuild();
    }

    private void BuildFilters()
    {
        int keep = DayFilter;
        DayFilters.Clear();
        DayFilters.Add(Loc.T("schedule.all"));
        for (int d = 0; d < _weekdays; d++) DayFilters.Add(Loc.T($"day.{d}"));
        DayFilter = keep;
    }

    private void Rebuild()
    {
        _all = [.. _entries.Select(e => new ScheduleRow((int)e.Day, Loc.T($"day.{(int)e.Day}"), e.Lane, e.CourseCode, e.CourseTitle, e.SectionNumber,
            e.Enrollment, e.Programs, e.Faculty is { } f && !f.StartsWith("Planning:", StringComparison.Ordinal) ? f : ""))];
        Apply();
    }

    partial void OnDayFilterChanged(int value) => Apply();
    partial void OnSearchChanged(string value) => Apply();

    private void Apply()
    {
        string q = Search.Trim();
        Rows = [.. _all.Where(r => (DayFilter <= 0 || r.Day == DayFilter - 1)
                                   && (q.Length == 0 || r.CourseCode.Contains(q, StringComparison.OrdinalIgnoreCase) || r.Title.Contains(q, StringComparison.OrdinalIgnoreCase)))];
        CountText = Loc.Instance.Format("schedule.count", Rows.Count.ToString("N0", CultureInfo.CurrentCulture));
    }

    protected override void OnLanguageChanged()
    {
        BuildFilters();
        Rebuild();
    }
}

public sealed record ClashRow(string Register, string Name, string Program, string Courses, string Days);

public sealed partial class ClashesViewModel : LocalizedViewModel
{
    private SolveOutcome? _outcome;

    [ObservableProperty] private IReadOnlyList<ClashRow> _rows = [];
    [ObservableProperty, NotifyPropertyChangedFor(nameof(HasClashes))] private int _count;
    [ObservableProperty] private string _title = "";
    [ObservableProperty] private string _countText = "";
    public bool HasClashes => Count > 0;

    public ClashesViewModel() => Title = Loc.T("clashes.title");

    public void Load(SolveOutcome outcome)
    {
        _outcome = outcome;
        Rebuild();
    }

    private void Rebuild()
    {
        Title = Loc.T("clashes.title");
        if (_outcome is not { } o) return;
        var red = o.Clash.Students.Where(s => s.Status == ClashStatus.Red).ToList();
        Count = red.Count;
        CountText = Loc.Instance.Format("clashes.count", red.Count.ToString("N0", CultureInfo.CurrentCulture));
        Rows = [.. red.Select(s => new ClashRow(s.RegisterNumber, s.Name, s.Program,
            string.Join("   ", s.Pairs.Select(p => $"{p.A} ↔ {p.B}")), string.Join(", ", s.Days.Select(d => Loc.T($"day.{(int)d}")))))];
    }

    protected override void OnLanguageChanged() => Rebuild();
}
