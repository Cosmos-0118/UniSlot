using UniSlot.Desktop.Services;

namespace UniSlot.Desktop.ViewModels;

public sealed class NavItem(string key, string iconKey) : LocalizedViewModel
{
    public string Key { get; } = key;
    public string IconKey { get; } = iconKey;
    public string Title => Loc.T(Key);

    protected override void OnLanguageChanged() => OnPropertyChanged(nameof(Title));
}
