using System.Globalization;
using Spectre.Console;
using UniSlot.Domain;

namespace UniSlot.Cli;

/// <summary>What the user picked in the "new timetable" wizard.</summary>
internal sealed class Choices
{
    public string File { get; set; } = "";
    public int Quality { get; set; } = 1;
    public bool Prove { get; set; }
    public bool Saturday { get; set; }
    public string SaturdayCodes { get; set; } = "";
}

/// <summary>The guided three-step flow: workbook → method → Saturday, then a summary to confirm.</summary>
internal static class Wizard
{
    private sealed record FileChoice(string? Path, string Label, bool Back = false, bool Browse = false);

    private enum Confirm { Start, Change, Cancel }

    private enum Part { File, Method, Saturday }

    /// <summary>Returns null when the user backs out.</summary>
    public static Choices? Run(IAnsiConsole c, CliSettings prefs, string? preselected = null)
    {
        var ch = new Choices
        {
            File = preselected ?? "",
            Quality = prefs.Quality,
            Prove = prefs.Prove,
            Saturday = prefs.AllowSaturday,
            SaturdayCodes = prefs.SaturdayCodes,
        };

        if (!StepFile(c, prefs, ch)) return null;
        StepMethod(c, ch);
        StepSaturday(c, ch);

        while (true)
        {
            Summary(c, prefs, ch);
            var action = c.Prompt(new SelectionPrompt<Confirm>()
                .Title($"[bold]{Ui.Esc(Loc.T("cli.confirm.title"))}[/]")
                .HighlightStyle(Ui.S(Ui.Accent, true)).WrapAround()
                .AddChoices(Confirm.Start, Confirm.Change, Confirm.Cancel)
                .UseConverter(a => a switch
                {
                    Confirm.Start => $"[bold {Ui.GoodM}]{Ui.Esc(Loc.T("solve.start"))}[/]",
                    Confirm.Change => Ui.Esc(Loc.T("cli.confirm.change")),
                    _ => $"[{Ui.MutedM}]{Ui.Esc(Loc.T("solve.cancel"))}[/]",
                }));
            if (action == Confirm.Start) return ch;
            if (action == Confirm.Cancel) return null;

            var part = c.Prompt(new SelectionPrompt<Part>()
                .Title($"[bold]{Ui.Esc(Loc.T("cli.confirm.which"))}[/]")
                .HighlightStyle(Ui.S(Ui.Accent, true)).WrapAround()
                .AddChoices(Part.File, Part.Method, Part.Saturday)
                .UseConverter(p => p switch { Part.File => Loc.T("solve.step.file"), Part.Method => Loc.T("solve.step.method"), _ => Loc.T("solve.step.saturday") }));
            switch (part)
            {
                case Part.File: StepFile(c, prefs, ch); break;
                case Part.Method: StepMethod(c, ch); break;
                default: StepSaturday(c, ch); break;
            }
        }
    }

    private static void Heading(IAnsiConsole c, int step, string title, string lead)
    {
        Ui.Clear(c);
        Ui.Header(c, Loc.T("solve.title"), $"{Loc.F("cli.step", step, 3)}");
        c.MarkupLine($"[bold {Ui.AccentM}]{Ui.Esc(title)}[/]");
        c.MarkupLine($"[{Ui.MutedM}]{Ui.Esc(lead)}[/]");
        c.WriteLine();
    }

    // ---- step 1: workbook ------------------------------------------------------------------------------------------------
    private static bool StepFile(IAnsiConsole c, CliSettings prefs, Choices ch)
    {
        Heading(c, 1, Loc.T("solve.s1.title"), Loc.T("solve.s1.lead"));
        string? path = PickWorkbook(c, prefs, ch.File, allowBack: false);
        if (path is null) return false;
        ch.File = path;
        return true;
    }

    /// <summary>Lists workbooks nearby (current one and last used first) plus "type a path". Null means the user went back.</summary>
    public static string? PickWorkbook(IAnsiConsole c, CliSettings prefs, string current, bool allowBack)
    {
        // Like the original tool, classic mode opens the system file dialog straight away; cancelling falls back to the list.
        if (Ui.Classic && DialogPick(c) is { } chosen) return chosen;
        var found = FindWorkbooks(prefs, current);
        if (found.Count == 0) return AskPath(c);
        var choices = found.Select(f => new FileChoice(f.FullName, FileLabel(f))).ToList();
        if (FileDialog.Available) choices.Add(new FileChoice(null, $"[{Ui.AccentM}]{Ui.Esc(Loc.T("classic.browse"))}[/]", Browse: true));
        choices.Add(new FileChoice(null, $"[{Ui.AccentM}]{Ui.Esc(Loc.T("cli.file.type"))}[/]"));
        if (allowBack) choices.Add(new FileChoice(null, $"[{Ui.MutedM}]{Ui.Esc(Loc.T("solve.back"))}[/]", Back: true));
        var picked = c.Prompt(new SelectionPrompt<FileChoice>()
            .Title($"[bold]{Ui.Esc(Loc.T("cli.file.found"))}[/]")
            .PageSize(12)
            .HighlightStyle(Ui.S(Ui.Accent, true)).WrapAround()
            .AddChoices(choices)
            .UseConverter(f => f.Label));
        if (picked.Back) return null;
        if (picked.Browse) return DialogPick(c) ?? PickWorkbook(c, prefs, current, allowBack);
        return picked.Path ?? AskPath(c);
    }

    /// <summary>Opens the system file dialog. Null when it is unavailable, cancelled, or the file is not a usable workbook.</summary>
    private static string? DialogPick(IAnsiConsole c)
    {
        if (!FileDialog.Available) return null;
        string? path = FileDialog.PickFile(Loc.T("classic.dialog.file"));
        if (path is null) return null;
        path = Clean(path);
        var check = Validate(path);
        if (check.Successful) return Path.GetFullPath(path);
        c.MarkupLine($"[{Ui.BadM}]{Ui.Esc(Loc.T("cli.file.notxlsx"))}[/]");
        return null;
    }

    private static string? AskPath(IAnsiConsole c)
    {
        string text = c.Prompt(new TextPrompt<string>($"[bold]{Ui.Esc(Loc.T("cli.file.prompt"))}[/]")
            .Validate(s => Validate(Clean(s)))
            .PromptStyle(Ui.S(Ui.Accent)));
        return Path.GetFullPath(Clean(text));
    }

    /// <summary>Handles drag-and-drop quirks: surrounding quotes, a leading <c>~</c> and environment variables.</summary>
    public static string Clean(string s)
    {
        s = s.Trim();
        if (s.Length >= 2 && ((s[0] == '"' && s[^1] == '"') || (s[0] == '\'' && s[^1] == '\''))) s = s[1..^1].Trim();
        if (s.StartsWith('~')) s = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) + s[1..];
        return Environment.ExpandEnvironmentVariables(s);
    }

    public static ValidationResult Validate(string path)
    {
        if (path.Length == 0) return ValidationResult.Error($"[{Ui.BadM}]{Ui.Esc(Loc.T("cli.file.prompt"))}[/]");
        string ext = Path.GetExtension(path);
        if (!ext.Equals(".xlsx", StringComparison.OrdinalIgnoreCase) && !ext.Equals(".xlsm", StringComparison.OrdinalIgnoreCase))
            return ValidationResult.Error($"[{Ui.BadM}]{Ui.Esc(Loc.T("cli.file.notxlsx"))}[/]");
        return File.Exists(path) ? ValidationResult.Success() : ValidationResult.Error($"[{Ui.BadM}]{Ui.Esc(Loc.F("cli.file.notfound", path))}[/]");
    }

    private static string FileLabel(FileInfo f)
    {
        string dir = f.DirectoryName ?? "";
        string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (home.Length > 0 && dir.StartsWith(home, StringComparison.OrdinalIgnoreCase)) dir = "~" + dir[home.Length..];
        return $"[bold]{Ui.Esc(Ui.Truncate(f.Name, 60))}[/]  [{Ui.MutedM}]{Ui.Esc(Ui.Size(f.Length))} · {Ui.Esc(f.LastWriteTime.ToString("g", CultureInfo.CurrentCulture))} · {Ui.Esc(Ui.Truncate(dir, 40))}[/]";
    }

    /// <summary>Workbooks the user probably means: the current one, the last used, then recent files nearby.</summary>
    public static IReadOnlyList<FileInfo> FindWorkbooks(CliSettings prefs, string current)
    {
        var dirs = new List<string> { Directory.GetCurrentDirectory() };
        string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (home.Length > 0)
        {
            dirs.Add(Path.Combine(home, "Downloads"));
            dirs.Add(Path.Combine(home, "Desktop"));
        }
        dirs.Add(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments));

        var files = new List<FileInfo>();
        foreach (string d in dirs.Where(Directory.Exists).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            try
            {
                foreach (string f in Directory.EnumerateFiles(d))
                {
                    string ext = Path.GetExtension(f);
                    string name = Path.GetFileName(f);
                    if ((ext.Equals(".xlsx", StringComparison.OrdinalIgnoreCase) || ext.Equals(".xlsm", StringComparison.OrdinalIgnoreCase)) && !name.StartsWith("~$", StringComparison.Ordinal))
                        files.Add(new FileInfo(f));
                }
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { /* skip unreadable folders */ }
        }
        var recent = files.DistinctBy(f => f.FullName, StringComparer.OrdinalIgnoreCase).OrderByDescending(f => f.LastWriteTimeUtc).Take(8).ToList();

        var result = new List<FileInfo>();
        foreach (string p in new[] { current, prefs.LastFile })
            if (!string.IsNullOrWhiteSpace(p) && File.Exists(p) && result.All(r => !string.Equals(r.FullName, Path.GetFullPath(p), StringComparison.OrdinalIgnoreCase)))
                result.Add(new FileInfo(Path.GetFullPath(p)));
        foreach (var f in recent)
            if (result.All(r => !string.Equals(r.FullName, f.FullName, StringComparison.OrdinalIgnoreCase))) result.Add(f);
        return result;
    }

    // ---- step 2: method --------------------------------------------------------------------------------------------------
    private static void StepMethod(IAnsiConsole c, Choices ch)
    {
        Heading(c, 2, Loc.T("solve.s2.title"), Loc.T("solve.s2.lead"));
        string[] keys = ["solve.quick", "solve.standard", "solve.thorough"];
        string picked = c.Prompt(new SelectionPrompt<string>()
            .Title($"[bold]{Ui.Esc(Loc.T("solve.quality"))}[/]")
            .HighlightStyle(Ui.S(Ui.Accent, true)).WrapAround()
            .AddChoices(keys)
            .UseConverter(k => $"[bold]{Ui.Esc(Loc.T(k))}[/]  [{Ui.MutedM}]{Ui.Esc(Loc.T(k + ".hint"))}[/]"));
        ch.Quality = Array.IndexOf(keys, picked);

        c.WriteLine();
        string[] proof = ["solve.prove.no", "solve.prove"];
        string p = c.Prompt(new SelectionPrompt<string>()
            .Title($"[bold]{Ui.Esc(Loc.T("solve.proofHeading"))}[/]")
            .HighlightStyle(Ui.S(Ui.Accent, true)).WrapAround()
            .AddChoices(proof)
            .UseConverter(k => $"[bold]{Ui.Esc(Loc.T(k))}[/]  [{Ui.MutedM}]{Ui.Esc(Ui.Truncate(Loc.T(k + ".hint"), Math.Max(30, Ui.Width(c) - Loc.T(k).Length - 8)))}[/]"));
        ch.Prove = p == "solve.prove";
    }

    // ---- step 3: Saturday ------------------------------------------------------------------------------------------------
    private static void StepSaturday(IAnsiConsole c, Choices ch)
    {
        Heading(c, 3, Loc.T("solve.s3.title"), Loc.T("solve.s3.lead"));
        string[] keys = ["solve.sat.no", "solve.sat.yes"];
        string picked = c.Prompt(new SelectionPrompt<string>()
            .Title($"[bold]{Ui.Esc(Loc.T("solve.step.saturday"))}[/]")
            .HighlightStyle(Ui.S(Ui.Accent, true)).WrapAround()
            .AddChoices(keys)
            .UseConverter(k => $"[bold]{Ui.Esc(Loc.T(k))}[/]  [{Ui.MutedM}]{Ui.Esc(Loc.T(k + ".hint"))}[/]"));
        ch.Saturday = picked == "solve.sat.yes";

        c.WriteLine();
        c.MarkupLine($"[bold]{Ui.Esc(Loc.T("solve.saturday.codes"))}[/]");
        c.MarkupLine($"[{Ui.MutedM}]{Ui.Esc(Loc.T("solve.saturday.codes.hint"))} {Ui.Esc(Loc.T("solve.saturday.codes.example"))}[/]");
        if (ch.SaturdayCodes.Length > 0) c.MarkupLine($"[{Ui.MutedM}]{Ui.Esc(Loc.F("cli.codes.current", ch.SaturdayCodes))}[/]");
        string text = c.Prompt(new TextPrompt<string>($"{Ui.Esc(Loc.T("cli.codes.prompt"))}")
            .AllowEmpty()
            .PromptStyle(Ui.S(Ui.Accent)));
        text = text.Trim();
        if (text == "-") ch.SaturdayCodes = "";
        else if (text.Length > 0) ch.SaturdayCodes = text;
    }

    // ---- summary ---------------------------------------------------------------------------------------------------------
    public static string SaturdaySummary(Choices ch)
    {
        string codes = string.Join(", ", SchedulePolicy.NormalizeCodes([ch.SaturdayCodes]).Order(StringComparer.Ordinal));
        if (ch.Saturday) return codes.Length > 0 ? Loc.F("solve.summary.sat.both", codes) : Loc.T("solve.summary.sat.maths");
        return codes.Length > 0 ? Loc.F("solve.summary.sat.codes", codes) : Loc.T("solve.summary.sat.none");
    }

    private static void Summary(IAnsiConsole c, CliSettings prefs, Choices ch)
    {
        Ui.Clear(c);
        Ui.Header(c, Loc.T("solve.title"));
        string[] quality = ["solve.quick", "solve.standard", "solve.thorough"];
        var g = new Grid().AddColumn(new GridColumn().NoWrap()).AddColumn();
        void Row(string label, string value) => g.AddRow(new Markup($"[{Ui.MutedM}]{Ui.Esc(label)}[/]"), new Markup(value));
        long size = File.Exists(ch.File) ? new FileInfo(ch.File).Length : 0;
        Row(Loc.T("solve.summary.file"), $"[bold]{Ui.Esc(Path.GetFileName(ch.File))}[/] [{Ui.MutedM}]{Ui.Esc(Ui.Size(size))}[/]");
        Row("", $"[{Ui.MutedM}]{Ui.Esc(Ui.Truncate(Path.GetDirectoryName(ch.File) ?? "", Ui.Width(c) - 24))}[/]");
        Row(Loc.T("solve.summary.search"), Ui.Esc(Loc.T(quality[Math.Clamp(ch.Quality, 0, 2)])));
        Row(Loc.T("solve.summary.proof"), Ui.Esc(Loc.T(ch.Prove ? "solve.summary.proofOn" : "solve.summary.proofOff")));
        Row(Loc.T("solve.summary.saturday"), Ui.Esc(SaturdaySummary(ch)));
        Row(Loc.T("settings.output"), Ui.Esc(Ui.Truncate(prefs.OutputRoot, Ui.Width(c) - 24)));
        c.Write(new Panel(g)
        {
            Header = new PanelHeader($" {Ui.Esc(Loc.T("solve.summary.title"))} "),
            Border = Ui.Box(c),
            BorderStyle = Ui.S(Ui.Accent),
            Padding = new Padding(2, 1),
            Expand = true,
        });
        c.WriteLine();
    }
}
