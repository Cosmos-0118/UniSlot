using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using UniSlot.Application.Importing;
using UniSlot.Application.Workflow;
using UniSlot.Domain;
using UniSlot.Infrastructure;
using UniSlot.Infrastructure.Export;
using UniSlot.Proof;
using UniSlot.Solver;
using UniSlot.Desktop.Services;

namespace UniSlot.Desktop.ViewModels;

public sealed partial class SolveViewModel : LocalizedViewModel
{
    private readonly AppSettings _settings;
    private readonly Action<SolveOutcome, string> _completed;
    private CancellationTokenSource? _cts;
    private SolveStage _stage = SolveStage.Reading;
    private int? _bestRed, _bestClash;

    public SolveViewModel(AppSettings settings, Action<SolveOutcome, string> completed)
    {
        _settings = settings;
        _completed = completed;
        _qualityIndex = settings.Quality;
        _allowSaturday = settings.AllowSaturday;
        _prove = settings.Prove;
        Qualities =
        [
            new QualityOption("solve.quick", "solve.quick.hint"),
            new QualityOption("solve.standard", "solve.standard.hint"),
            new QualityOption("solve.thorough", "solve.thorough.hint"),
        ];
    }

    public IReadOnlyList<QualityOption> Qualities { get; }

    [ObservableProperty, NotifyPropertyChangedFor(nameof(HasFile)), NotifyPropertyChangedFor(nameof(FileName)), NotifyCanExecuteChangedFor(nameof(StartCommand))]
    private string? _filePath;

    [ObservableProperty] private int _qualityIndex;
    [ObservableProperty] private bool _allowSaturday;
    [ObservableProperty] private bool _prove;
    [ObservableProperty, NotifyPropertyChangedFor(nameof(IsIdle)), NotifyCanExecuteChangedFor(nameof(StartCommand))]
    private bool _isRunning;
    [ObservableProperty] private double _progress;
    [ObservableProperty] private string _stageText = "";
    [ObservableProperty] private string _liveText = "";
    [ObservableProperty, NotifyPropertyChangedFor(nameof(HasError))] private string? _errorTitle;
    [ObservableProperty] private string? _savedTo;

    public ObservableCollection<string> ErrorLines { get; } = [];
    public bool HasFile => !string.IsNullOrEmpty(FilePath);
    public string FileName => HasFile ? Path.GetFileName(FilePath!) : "";
    public bool IsIdle => !IsRunning;
    public bool HasError => !string.IsNullOrEmpty(ErrorTitle);

    partial void OnQualityIndexChanged(int value) { _settings.Quality = value; _settings.Save(); }
    partial void OnAllowSaturdayChanged(bool value) { _settings.AllowSaturday = value; _settings.Save(); }
    partial void OnProveChanged(bool value) { _settings.Prove = value; _settings.Save(); }

    public void SetFile(string path)
    {
        if (IsRunning) return;
        FilePath = path;
        ClearMessages();
    }

    [RelayCommand]
    private async Task BrowseAsync()
    {
        if (IsRunning) return;
        string? path = await Shell.PickWorkbook();
        if (path is not null) SetFile(path);
    }

    [RelayCommand(CanExecute = nameof(CanStart))]
    private async Task StartAsync()
    {
        ClearMessages();
        _cts = new CancellationTokenSource();
        var ct = _cts.Token;
        IsRunning = true;
        Progress = 0;
        _bestRed = _bestClash = null;
        UpdateStage(SolveStage.Reading);
        try
        {
            var input = await XlsxEnrollmentSource.ReadAsync(FilePath!, ct);
            IOptimalityProver? prover = Prove ? CpSatProver.Create() : null;
            var workflow = new SolveWorkflow(new AnnealingEngine(), prover);
            var settings = new SolveSettings
            {
                Policy = new SchedulePolicy { AllowSaturdayForMaths = AllowSaturday },
                Search = new SearchOptions
                {
                    Seed = (ulong)Math.Max(0, _settings.Seed),
                    Chains = 12,
                    MovesPerChain = QualityIndex switch { 0 => 6_000_000L, 1 => 30_000_000L, _ => 150_000_000L },
                },
                Prove = Prove,
                ProofTimeLimit = TimeSpan.FromSeconds(60),
            };

            // Created on the UI thread, so callbacks arrive on the UI thread.
            var progress = new Progress<SolveProgress>(p =>
            {
                Progress = p.Fraction;
                _bestRed = p.BestRed ?? _bestRed;
                _bestClash = p.BestClash ?? _bestClash;
                UpdateStage(p.Stage);
            });

            var outcome = await workflow.RunAsync(input, settings, progress, ct);
            string name = Path.GetFileNameWithoutExtension(FilePath!);
            string folder = Path.Combine(_settings.OutputRoot, $"{Sanitize(name)}-{DateTime.Now:yyyyMMdd-HHmmss}");
            await OutputWriter.WriteAsync(outcome, folder, new ExportOptions { Institution = _settings.Institution }, ct);
            SavedTo = folder;
            _completed(outcome, folder);
        }
        catch (OperationCanceledException)
        {
            StageText = Loc.T("solve.cancelled");
        }
        catch (InputRejectedException ex)
        {
            ErrorTitle = Loc.T("solve.rejected");
            foreach (var e in ex.Report.Errors.Take(12)) ErrorLines.Add(e.Row is { } r ? $"{r}: {e.Message}" : e.Message);
            if (ex.Report.Errors.Count > 12) ErrorLines.Add($"… +{ex.Report.Errors.Count - 12}");
        }
        catch (Exception ex) when (ex is IOException or InvalidDataException or UnauthorizedAccessException)
        {
            ErrorTitle = Loc.T("solve.failed");
            ErrorLines.Add(ex.Message);
        }
        finally
        {
            IsRunning = false;
            _cts?.Dispose();
            _cts = null;
        }
    }

    private bool CanStart() => HasFile && !IsRunning;

    [RelayCommand]
    private void Cancel() => _cts?.Cancel();

    private void UpdateStage(SolveStage stage)
    {
        _stage = stage;
        RefreshTexts();
    }

    private void RefreshTexts()
    {
        StageText = Loc.T($"stage.{_stage.ToString().ToLowerInvariant()}");
        LiveText = _bestRed is { } r ? Loc.Instance.Format("live.best", r, _bestClash ?? 0) : "";
    }

    private void ClearMessages()
    {
        ErrorTitle = null;
        ErrorLines.Clear();
        SavedTo = null;
        StageText = "";
        LiveText = "";
    }

    private static string Sanitize(string name)
    {
        foreach (char c in Path.GetInvalidFileNameChars()) name = name.Replace(c, '_');
        return name.Length > 60 ? name[..60] : name;
    }

    protected override void OnLanguageChanged()
    {
        if (IsRunning || SavedTo is not null) RefreshTexts();
    }
}

public sealed class QualityOption(string titleKey, string hintKey) : LocalizedViewModel
{
    public string Title => Loc.T(titleKey);
    public string Hint => Loc.T(hintKey);

    public void Refresh() { OnPropertyChanged(nameof(Title)); OnPropertyChanged(nameof(Hint)); }
    protected override void OnLanguageChanged() => Refresh();
}
