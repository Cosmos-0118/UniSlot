using Avalonia.Styling;

namespace UniSlot.Desktop.Services;

public static class ThemeApplier
{
    public static void Apply(string theme)
    {
        if (Avalonia.Application.Current is not { } app) return;
        app.RequestedThemeVariant = theme switch
        {
            "light" => ThemeVariant.Light,
            "dark" => ThemeVariant.Dark,
            _ => ThemeVariant.Default,
        };
    }
}
