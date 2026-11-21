using System.Diagnostics;
using System.Globalization;
using Spectre.Console;
using Spectre.Console.Rendering;

namespace UniSlot.Cli;

/// <summary>Palette, glyphs and small rendering helpers shared by every screen.</summary>
internal static class Ui
{
    public static readonly Color Accent = new(122, 162, 247);
    public static readonly Color Good = new(158, 206, 106);
    public static readonly Color Warn = new(224, 175, 104);
    public static readonly Color Bad = new(247, 118, 142);
    public static readonly Color Muted = new(120, 124, 153);

    public const string AccentM = "#7aa2f7";
    public const string GoodM = "#9ece6a";
    public const string WarnM = "#e0af68";
    public const string BadM = "#f7768e";
    public const string MutedM = "#787c99";

    public static string Esc(string? s) => Markup.Escape(s ?? "");

    public static string Number(long n) => n.ToString("N0", CultureInfo.CurrentCulture);

    public static string Seconds(TimeSpan t) => t.TotalSeconds.ToString("0.0", CultureInfo.CurrentCulture) + " s";

    public static string Clock(TimeSpan t) => t.TotalHours >= 1 ? $"{(int)t.TotalHours}:{t.Minutes:00}:{t.Seconds:00}" : $"{t.Minutes:00}:{t.Seconds:00}";

    public static string Size(long bytes) => bytes switch
    {
        < 1024 => $"{bytes} B",
        < 1024 * 1024 => $"{bytes / 1024.0:0.#} KB",
        _ => $"{bytes / 1024.0 / 1024.0:0.#} MB",
    };

    public static string Truncate(string s, int max) => s.Length <= max ? s : max <= 1 ? s[..Math.Max(0, max)] : s[..(max - 1)] + "…";

    public static string Version() =>
        typeof(Ui).Assembly.GetCustomAttributes(typeof(System.Reflection.AssemblyInformationalVersionAttribute), false)
            .OfType<System.Reflection.AssemblyInformationalVersionAttribute>().FirstOrDefault()?.InformationalVersion.Split('+')[0] ?? "dev";

    public static bool IsInteractive(IAnsiConsole console) =>
        console.Profile.Capabilities.Interactive && !Console.IsInputRedirected && !Console.IsOutputRedirected;

    public static int Width(IAnsiConsole console) => Math.Clamp(console.Profile.Width, 40, 140);

    public static int Height()
    {
        try { return Console.IsOutputRedirected ? 40 : Math.Max(15, Console.WindowHeight); }
        catch (IOException) { return 30; }
    }

    public static Style S(Color c, bool bold = false) => new(c, decoration: bold ? Decoration.Bold : Decoration.None);

    // ---- glyphs, with ASCII fallbacks for consoles that cannot draw Unicode ---------------------------------------------
    public static string Tick(IAnsiConsole c) => c.Profile.Capabilities.Unicode ? "✔" : "+";
    public static string Cross(IAnsiConsole c) => c.Profile.Capabilities.Unicode ? "✘" : "x";
    public static string Dot(IAnsiConsole c) => c.Profile.Capabilities.Unicode ? "○" : "o";
    public static string Bullet(IAnsiConsole c) => c.Profile.Capabilities.Unicode ? "•" : "-";
    public static string Arrow(IAnsiConsole c) => c.Profile.Capabilities.Unicode ? "↔" : "<->";
    public static string Sep(IAnsiConsole c) => c.Profile.Capabilities.Unicode ? "·" : "|";
    public static string[] Spinner(IAnsiConsole c) =>
        c.Profile.Capabilities.Unicode ? ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] : ["|", "/", "-", "\\"];

    public static BoxBorder Box(IAnsiConsole c) => c.Profile.Capabilities.Unicode ? BoxBorder.Rounded : BoxBorder.Ascii;
    public static TableBorder TableBox(IAnsiConsole c) => c.Profile.Capabilities.Unicode ? TableBorder.Rounded : TableBorder.Ascii;

    // ---- screens -------------------------------------------------------------------------------------------------------
    public static void Banner(IAnsiConsole c)
    {
        if (c.Profile.Capabilities.Unicode && Width(c) >= 64)
        {
            c.Write(new FigletText("UniSlot").Color(Accent).LeftJustified());
            c.MarkupLine($"  [{MutedM}]{Esc(Loc.T("app.tagline"))}  {Sep(c)}  v{Esc(Version())}[/]");
            c.WriteLine();
        }
        else
        {
            c.MarkupLine($"[bold {AccentM}]UniSlot[/] [{MutedM}]v{Esc(Version())} {Sep(c)} {Esc(Loc.T("app.tagline"))}[/]");
            c.WriteLine();
        }
    }

    public static void Header(IAnsiConsole c, string title, string? subtitle = null)
    {
        string text = $"[bold {AccentM}]UniSlot[/] [{MutedM}]{Sep(c)}[/] [bold]{Esc(title)}[/]";
        if (subtitle is not null) text += $"  [{MutedM}]{Esc(subtitle)}[/]";
        c.Write(new Rule(text) { Style = S(Muted), Justification = Justify.Left });
        c.WriteLine();
    }

    /// <summary>Classic mode scrolls like the original command line: screens are never cleared and nothing waits for a key.</summary>
    public static bool Classic { get; set; }

    public static void Clear(IAnsiConsole c)
    {
        if (!Classic && IsInteractive(c)) c.Clear();
    }

    public static IRenderable Card(IAnsiConsole c, string title, string value, string valueColour, string? hint = null)
    {
        var rows = new List<IRenderable>
        {
            new Markup($"[bold {valueColour}]{Esc(value)}[/]"),
            new Markup(hint is null ? " " : $"[{MutedM}]{Esc(hint)}[/]"),
        };
        return new Panel(new Rows(rows))
        {
            Header = new PanelHeader($" {Esc(title)} "),
            Border = Box(c),
            BorderStyle = S(Muted),
            Padding = new Padding(1, 0),
            Expand = true,
        };
    }

    /// <summary>Opens a folder in the system file manager. Returns false when that is not possible.</summary>
    public static bool OpenFolder(string path)
    {
        try
        {
            if (OperatingSystem.IsWindows()) Process.Start(new ProcessStartInfo("explorer.exe", $"\"{path}\"") { UseShellExecute = true });
            else if (OperatingSystem.IsMacOS()) Process.Start("open", [path]);
            else Process.Start("xdg-open", [path]);
            return true;
        }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException or PlatformNotSupportedException)
        {
            return false;
        }
    }
}
