using Spectre.Console;
using UniSlot.Application.Workflow;
using UniSlot.Infrastructure;

namespace UniSlot.Cli;

/// <summary>
/// The default interactive mode: the same nine choices, in the same order and wording, as the original command line, followed by plain questions one
/// after another and a short result. Nothing is cleared, nothing needs a mouse, and every question has the answer the original tool defaulted to.
/// The full-screen application stays available as <c>unislot --tui</c>.
/// </summary>
internal sealed class Classic(IAnsiConsole c, CliSettings prefs)
{
    internal enum Choice { Solve, Rectify, Late, Fix, Drop, Revert, Names, Filter, Issues }

    public static Choice? FromMode(string mode) => mode switch
    {
        EditOptions.Rectify => Choice.Rectify,
        EditOptions.Late => Choice.Late,
        EditOptions.FixCourse => Choice.Fix,
        EditOptions.DropCourse => Choice.Drop,
        EditOptions.Revert => Choice.Revert,
        EditOptions.NameList => Choice.Names,
        EditOptions.Filter => Choice.Filter,
        EditOptions.Issues => Choice.Issues,
        _ => null,
    };

    /// <summary>The menu shown when <c>unislot</c> starts with no command on a terminal.</summary>
    public async Task<int> MenuAsync()
    {
        Ui.Classic = true;
        Intro();
        var pick = c.Prompt(new SelectionPrompt<Choice>()
            .Title($"[bold]{Ui.Esc(Loc.T("cli.menu.title"))}[/]")
            .HighlightStyle(Ui.S(Ui.Accent, true)).WrapAround().PageSize(12)
            .AddChoices(Enum.GetValues<Choice>())
            .UseConverter(Label));
        return await RunAsync(pick, new Options());
    }

    public static string Label(Choice choice)
    {
        (string label, string hint) = choice switch
        {
            Choice.Solve => (Loc.T("classic.menu.solve"), Loc.T("classic.menu.solve.hint")),
            Choice.Rectify => (Loc.T("edit.mode.rectify"), Loc.T("classic.hint.rectify")),
            Choice.Late => (Loc.T("edit.mode.late"), Loc.T("classic.hint.late")),
            Choice.Fix => (Loc.T("edit.mode.fix-course"), Loc.T("classic.hint.fix")),
            Choice.Drop => (Loc.T("edit.mode.drop-course"), Loc.T("classic.hint.drop")),
            Choice.Revert => (Loc.T("edit.mode.revert"), Loc.T("classic.hint.revert")),
            Choice.Names => (Loc.T("edit.menu.names"), Loc.T("classic.hint.names")),
            Choice.Filter => (Loc.T("edit.menu.filter"), Loc.T("classic.hint.filter")),
            _ => (Loc.T("edit.menu.issues"), Loc.T("edit.menu.issues.hint")),
        };
        return $"[bold]{Ui.Esc(label)}[/]  [{Ui.MutedM}]{Ui.Esc(hint)}[/]";
    }

    /// <summary>Runs one choice from start to finish and returns the process exit code. <paramref name="solveFlags"/> carries any options given on the command line.</summary>
    public async Task<int> RunAsync(Choice choice, Options solveFlags, EditOptions? given = null)
    {
        Ui.Classic = true;
        var edits = new EditScreens(c, prefs, given);
        try
        {
            switch (choice)
            {
                case Choice.Solve: return await SolveAsync(solveFlags);
                case Choice.Names: await edits.NameList(); return 0;
                case Choice.Filter: await edits.Filter(); return 0;
                case Choice.Issues: await edits.Issues(); return 0;
            }

            SolveRun? run = choice switch
            {
                Choice.Rectify => await edits.Rectify(),
                Choice.Late => await edits.Late(),
                Choice.Fix => await edits.Fix(),
                Choice.Drop => await edits.Drop(),
                _ => await edits.Revert(),
            };
            if (run is null)
            {
                c.MarkupLine($"\n[{Ui.WarnM}]{Ui.Esc(Loc.T("solve.cancelled"))}[/]");
                return 1;
            }
            ClassicView.Done(c, run);
            return run.Outcome.Audit.IsStructurallyFeasible ? 0 : 3;
        }
        catch (Exception ex) when (Program.Report(c, ex, out int code))
        {
            return code;
        }
    }

    // ---- create schedule ---------------------------------------------------------------------------------------------------------
    /// <summary>The original questions in the original order: seed, Saturday, workbook. The output folder is asked before the run instead of after it, so a finished search is never lost. Anything already given as an option is not asked.</summary>
    public async Task<int> SolveAsync(Options flags)
    {
        Ui.Classic = true;
        if (flags.Input.Length == 0) Intro();
        Ui.Header(c, Loc.T("classic.menu.solve"));

        var o = flags;
        if (o.Seed is null && !flags.Yes && c.Confirm($"[bold]{Ui.Esc(Loc.T("classic.seed.ask"))}[/]", false))
        {
            string token = c.Prompt(new TextPrompt<string>($"[bold]{Ui.Esc(Loc.T("classic.seed.prompt"))}[/]").PromptStyle(Ui.S(Ui.Accent))
                .Validate(s => Reusable(s) ? ValidationResult.Success() : ValidationResult.Error($"[{Ui.BadM}]{Ui.Esc(Loc.T("classic.seed.invalid"))}[/]")));
            o = Options.ApplySeed(o, token);
        }

        bool saturday = flags.Saturday ?? c.Confirm($"[bold]{Ui.Esc(Loc.T("classic.sat.ask"))}[/]", prefs.AllowSaturday);
        string codes = flags.SaturdayCodes is { } given ? string.Join(",", given) : AskCodes();
        o = o with { Saturday = saturday, SaturdayCodes = [codes] };

        string file = flags.Input.Length > 0 ? flags.Input : Wizard.PickWorkbook(c, prefs, prefs.LastFile, allowBack: false)!;

        string output = flags.Output ?? AskOutput(c, "unislot-out", SolveRunner.DefaultFolder(prefs, file));

        prefs.AllowSaturday = saturday;
        prefs.SaturdayCodes = codes;
        prefs.LastFile = file;
        prefs.Save();

        var settings = SolveRunner.BuildSettings(prefs, o, untimedProof: true);
        var request = new SolveRequest(file, output, settings, prefs.Institution);
        Summary(file, settings, output);

        using var cts = new CancellationTokenSource();
        SolveRun run;
        try
        {
            Program.SetRunToken(cts);
            var sink = new ProgressSink();
            run = await RunView.ShowAsync(c, sink, settings.Prove, Path.GetFileName(file), Task.Run(() => SolveRunner.RunAsync(request, sink, cts.Token)));
        }
        finally { Program.SetRunToken(null); }

        ClassicView.Done(c, run);
        return run.Outcome.Audit.IsStructurallyFeasible ? 0 : 3;
    }

    private static bool Reusable(string text)
    {
        try { Options.ApplySeed(new Options(), text); return true; }
        catch (ArgumentException) { return false; }
    }

    private string AskCodes()
    {
        c.WriteLine();
        c.MarkupLine($"[bold]{Ui.Esc(Loc.T("classic.codes"))}[/]");
        c.MarkupLine($"[{Ui.MutedM}]{Ui.Esc(Loc.T("solve.saturday.codes.example"))}[/]");
        if (prefs.SaturdayCodes.Length > 0) c.MarkupLine($"[{Ui.MutedM}]{Ui.Esc(Loc.F("cli.codes.current", prefs.SaturdayCodes))}[/]");
        string text = c.Prompt(new TextPrompt<string>(Ui.Esc(Loc.T("cli.codes.prompt"))).AllowEmpty().PromptStyle(Ui.S(Ui.Accent))).Trim();
        return text == "-" ? "" : text.Length > 0 ? text : prefs.SaturdayCodes;
    }

    private void Summary(string file, SolveSettings settings, string output)
    {
        c.WriteLine();
        var g = new Grid().AddColumn(new GridColumn().NoWrap()).AddColumn();
        void Row(string label, string value) => g.AddRow(new Markup($"[{Ui.MutedM}]{Ui.Esc(label)}[/]"), new Markup(Ui.Esc(value)));
        Row(Loc.T("solve.summary.file"), Path.GetFileName(file));
        Row(Loc.T("results.reproduce"), settings.Search.ReproToken);
        Row(Loc.T("solve.summary.saturday"), Wizard.SaturdaySummary(new Choices { Saturday = settings.Policy.AllowSaturdayForMaths, SaturdayCodes = string.Join(",", settings.Policy.SaturdayExtraCourses) }));
        Row(Loc.T("classic.out.prompt"), output);
        c.Write(g);
        c.WriteLine();
    }

    // ---- shared pieces -----------------------------------------------------------------------------------------------------------
    private void Intro()
    {
        string mark = c.Profile.Capabilities.Unicode ? "▲" : "^";
        c.MarkupLine($"[bold {Ui.AccentM}]{mark} UniSlot[/] [{Ui.MutedM}]{Ui.Sep(c)} {Ui.Esc(Loc.T("app.tagline"))} {Ui.Sep(c)} v{Ui.Esc(Ui.Version())}[/]");
        c.WriteLine();
    }

    /// <summary>Asks for a new output folder. The suggestion is the original tool's default name in the current directory, unless a timetable is already there.</summary>
    public static string AskOutput(IAnsiConsole c, string defaultName, string fallback)
    {
        // Like the original tool: offer the system folder dialog first.
        if (FileDialog.Available && c.Confirm($"[bold]{Ui.Esc(Loc.T("classic.dialog.pickout"))}[/]", true))
        {
            string? picked = FileDialog.PickFolder(Loc.T("classic.dialog.folder"));
            if (picked is not null && IsFree(picked)) return Path.GetFullPath(picked);
            if (picked is not null) c.MarkupLine($"[{Ui.BadM}]{Ui.Esc(Loc.F("classic.out.exists", picked))}[/]");
        }
        string suggested = IsFree(defaultName) ? Path.GetFullPath(defaultName) : fallback;
        string text = c.Prompt(new TextPrompt<string>($"[bold]{Ui.Esc(Loc.T("classic.out.prompt"))}[/]").DefaultValue(suggested).PromptStyle(Ui.S(Ui.Accent))
            .Validate(s =>
            {
                string p = Wizard.Clean(s);
                return p.Length > 0 && IsFree(p) ? ValidationResult.Success() : ValidationResult.Error($"[{Ui.BadM}]{Ui.Esc(Loc.F("classic.out.exists", p))}[/]");
            }));
        return Path.GetFullPath(Wizard.Clean(text));
    }

    private static bool IsFree(string folder) => !(SnapshotStore.IsOutputFolder(folder) && Directory.EnumerateFileSystemEntries(folder).Any());
}
