using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using UniSlot.Desktop.Services;
using UniSlot.Desktop.ViewModels;
using UniSlot.Desktop.Views;

namespace UniSlot.Desktop;

public sealed class App : Avalonia.Application
{
    public override void Initialize() => AvaloniaXamlLoader.Load(this);

    public override void OnFrameworkInitializationCompleted()
    {
        var settings = AppSettings.Load();
        Loc.Instance.SetLanguage(settings.Language);
        ThemeApplier.Apply(settings.Theme);
        UiScale.Set(settings.UiScale);

        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
            desktop.MainWindow = new MainWindow(settings) { DataContext = new MainViewModel(settings) };

        base.OnFrameworkInitializationCompleted();
    }
}
