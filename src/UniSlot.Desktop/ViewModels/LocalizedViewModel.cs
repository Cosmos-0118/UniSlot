using System.ComponentModel;
using CommunityToolkit.Mvvm.ComponentModel;
using UniSlot.Desktop.Services;

namespace UniSlot.Desktop.ViewModels;

/// <summary>Base for view models that show translated text computed in code; refreshes when the language changes.</summary>
public abstract class LocalizedViewModel : ObservableObject
{
    protected LocalizedViewModel()
    {
        Loc.Instance.PropertyChanged += OnLocChanged;
    }

    private void OnLocChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == "Item[]") OnLanguageChanged();
    }

    protected abstract void OnLanguageChanged();
}
