using CommunityToolkit.Mvvm.ComponentModel;
using UniSlot.Desktop.Services;

namespace UniSlot.Desktop.ViewModels;

public sealed partial class SettingsViewModel : LocalizedViewModel
{
    private readonly AppSettings _settings;

    public SettingsViewModel(AppSettings settings)
    {
        _settings = settings;
        _languageIndex = Math.Max(0, Loc.Languages.ToList().FindIndex(l => l.Code == settings.Language));
        _themeIndex = settings.Theme switch { "light" => 1, "dark" => 2, _ => 0 };
        _institution = settings.Institution;
        _outputRoot = settings.OutputRoot;
        _seedText = settings.Seed.ToString(System.Globalization.CultureInfo.InvariantCulture);
        ThemeNames = [Loc.T("theme.system"), Loc.T("theme.light"), Loc.T("theme.dark")];
        _scaleIndex = IndexOfScale(settings.UiScale);
        _scaleNames = ScaleLabels();
        UiScale.Changed += SyncScale; // Ctrl +/-/0 changes the scale from outside this page
    }

    /// <summary>Automatic, then fixed scales.</summary>
    private static readonly double[] ScaleValues = [0, 0.9, 1.0, 1.2, 1.4];

    public IReadOnlyList<LanguageInfo> Languages => Loc.Languages;
    [ObservableProperty] private IReadOnlyList<string> _themeNames;
    [ObservableProperty] private IReadOnlyList<string> _scaleNames;
    [ObservableProperty] private int _scaleIndex;
    private bool _syncingScale;

    private static IReadOnlyList<string> ScaleLabels() =>
        [Loc.T("scale.auto"), Loc.T("scale.small"), Loc.T("scale.default"), Loc.T("scale.large"), Loc.T("scale.xlarge")];

    private static int IndexOfScale(double value) =>
        Array.FindIndex(ScaleValues, v => Math.Abs(v - value) < 0.001);

    private void SyncScale()
    {
        _syncingScale = true;
        ScaleIndex = IndexOfScale(UiScale.Manual);
        _syncingScale = false;
    }

    partial void OnScaleIndexChanged(int value)
    {
        if (_syncingScale || value < 0 || value >= ScaleValues.Length) return;
        _settings.UiScale = ScaleValues[value];
        _settings.Save();
        UiScale.Set(ScaleValues[value]);
    }

    [ObservableProperty] private int _languageIndex;
    [ObservableProperty] private int _themeIndex;
    [ObservableProperty] private string _institution;
    [ObservableProperty] private string _outputRoot;
    [ObservableProperty] private string _seedText;

    partial void OnLanguageIndexChanged(int value)
    {
        if (value < 0 || value >= Loc.Languages.Count) return;
        _settings.Language = Loc.Languages[value].Code;
        _settings.Save();
        Loc.Instance.SetLanguage(_settings.Language);
    }

    partial void OnThemeIndexChanged(int value)
    {
        _settings.Theme = value switch { 1 => "light", 2 => "dark", _ => "system" };
        _settings.Save();
        ThemeApplier.Apply(_settings.Theme);
    }

    partial void OnInstitutionChanged(string value) { _settings.Institution = value.Trim(); _settings.Save(); }

    partial void OnOutputRootChanged(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return;
        _settings.OutputRoot = value.Trim();
        _settings.Save();
    }

    partial void OnSeedTextChanged(string value)
    {
        if (long.TryParse(value, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out long seed) && seed >= 0)
        {
            _settings.Seed = seed;
            _settings.Save();
        }
    }

    protected override void OnLanguageChanged()
    {
        ThemeNames = [Loc.T("theme.system"), Loc.T("theme.light"), Loc.T("theme.dark")];
        ScaleNames = ScaleLabels();
    }
}
