using Avalonia;
using Avalonia.Controls;

namespace UniSlot.Desktop.Services;

public enum LayoutMode { Compact, Regular, Wide, UltraWide }

/// <summary>
/// The interface scale. In automatic mode it grows gently with the window so text is comfortable on large and high-resolution displays;
/// a manual value (settings or Ctrl +/−/0) overrides it.
/// </summary>
public static class UiScale
{
    public static readonly double[] Steps = [0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.6, 1.8];

    /// <summary>0 means automatic.</summary>
    public static double Manual { get; private set; }

    /// <summary>The scale currently applied.</summary>
    public static double Current { get; private set; } = 1;

    public static event Action? Changed;

    public static void Set(double manual)
    {
        manual = manual <= 0 ? 0 : Math.Clamp(manual, 0.7, 2.0);
        if (Math.Abs(manual - Manual) < 1e-9) return;
        Manual = manual;
        Changed?.Invoke();
    }

    /// <summary>Moves one step up or down from the current scale; 0 returns to automatic.</summary>
    public static void Step(int direction)
    {
        if (direction == 0) { Set(0); return; }
        double cur = Current;
        double next = direction > 0
            ? Steps.FirstOrDefault(s => s > cur + 0.01, Steps[^1])
            : Steps.LastOrDefault(s => s < cur - 0.01, Steps[0]);
        Set(next);
    }

    /// <summary>Automatic scale: 1.0 at about 1024 px of geometric-mean window size, rising at half that rate, clamped to 0.9–1.35.</summary>
    public static double Resolve(Size window)
    {
        double scale = Manual > 0
            ? Manual
            : Math.Clamp(1 + 0.5 * (Math.Sqrt(Math.Max(1, window.Width * window.Height)) / 1024.0 - 1), 0.9, 1.35);
        Current = scale;
        return scale;
    }
}

public readonly record struct LayoutSnapshot(double Scale, LayoutMode Mode, double Sidebar, double ContentWidth);

/// <summary>
/// Turns the window size into layout decisions: sidebar width, page padding, content width, which optional table columns fit, and the
/// style classes the theme keys off. Values are published as application resources so every page reacts without code of its own.
/// </summary>
public static class ResponsiveLayout
{
    public static LayoutSnapshot Apply(Window window, Size size)
    {
        double scale = UiScale.Resolve(size);
        double width = size.Width / scale; // effective width after scaling

        var mode = width < 900 ? LayoutMode.Compact : width < 1400 ? LayoutMode.Regular : width < 1900 ? LayoutMode.Wide : LayoutMode.UltraWide;
        double sidebar = mode == LayoutMode.Compact ? 72 : 248;
        var padding = mode switch
        {
            LayoutMode.Compact => new Thickness(24, 28, 24, 28),
            LayoutMode.Regular => new Thickness(48, 40, 48, 40),
            LayoutMode.Wide => new Thickness(64, 48, 64, 48),
            _ => new Thickness(80, 56, 80, 56),
        };
        double cap = mode switch { LayoutMode.Compact => 720, LayoutMode.Regular => 980, LayoutMode.Wide => 1240, _ => 1480 };
        double content = Math.Max(440, Math.Min(cap, width - sidebar - 1 - padding.Left - padding.Right));

        double programs = content >= 900 ? (content >= 1200 ? 240 : 170) : 0;
        double faculty = content >= 1100 ? 160 : 0;

        if (Avalonia.Application.Current is { } app)
        {
            app.Resources["ContentMaxWidth"] = content;
            app.Resources["NarrowMaxWidth"] = Math.Min(content, 820);
            app.Resources["PagePadding"] = padding;
            app.Resources["ColPrograms"] = new GridLength(programs);
            app.Resources["ColFaculty"] = new GridLength(faculty);
        }

        window.Classes.Set("compact", mode == LayoutMode.Compact);
        window.Classes.Set("hide-programs", programs == 0);
        window.Classes.Set("hide-faculty", faculty == 0);
        return new LayoutSnapshot(scale, mode, sidebar, content);
    }

    /// <summary>A comfortable first-run window for the screen: about 72% × 80% of the work area, within sensible limits.</summary>
    public static Size InitialSize(Window window)
    {
        var screen = window.Screens?.Primary;
        if (screen is null) return new Size(1180, 780);
        double s = Math.Max(0.5, screen.Scaling);
        double w = screen.WorkingArea.Width / s, h = screen.WorkingArea.Height / s;
        return new Size(Math.Clamp(w * 0.72, 980, Math.Max(980, w - 40)), Math.Clamp(h * 0.8, 640, Math.Max(640, h - 40)));
    }
}
