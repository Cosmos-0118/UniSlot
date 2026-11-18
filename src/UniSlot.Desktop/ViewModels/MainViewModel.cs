using CommunityToolkit.Mvvm.ComponentModel;
using UniSlot.Application.Workflow;
using UniSlot.Desktop.Services;

namespace UniSlot.Desktop.ViewModels;

public sealed partial class MainViewModel : ObservableObject
{
    public MainViewModel(AppSettings settings)
    {
        Settings = new SettingsViewModel(settings);
        Results = new ResultsViewModel();
        Schedule = new ScheduleViewModel();
        Clashes = new ClashesViewModel();
        Solve = new SolveViewModel(settings, OnSolved);
        NavItems =
        [
            new NavItem("nav.solve", "IconUpload"),
            new NavItem("nav.results", "IconChart"),
            new NavItem("nav.schedule", "IconCalendar"),
            new NavItem("nav.clashes", "IconAlert"),
            new NavItem("nav.settings", "IconSliders"),
        ];
    }

    public SolveViewModel Solve { get; }
    public ResultsViewModel Results { get; }
    public ScheduleViewModel Schedule { get; }
    public ClashesViewModel Clashes { get; }
    public SettingsViewModel Settings { get; }
    public IReadOnlyList<NavItem> NavItems { get; }

    [ObservableProperty, NotifyPropertyChangedFor(nameof(CurrentPage))] private int _selectedIndex;

    public object CurrentPage => SelectedIndex switch
    {
        1 => Results,
        2 => Schedule,
        3 => Clashes,
        4 => Settings,
        _ => Solve,
    };

    public string Version { get; } = typeof(MainViewModel).Assembly.GetName().Version is { } v ? $"v{v.Major}.{v.Minor}.{v.Build}" : "";

    private void OnSolved(SolveOutcome outcome, string folder)
    {
        Results.Load(outcome, folder);
        Schedule.Load(outcome.Schedule, outcome.Settings.Policy.WeekdayCount);
        Clashes.Load(outcome);
        SelectedIndex = 1;
    }
}
