using System.Globalization;
using Spectre.Console;
using UniSlot.Application.Importing;
using UniSlot.Application.Workflow;

namespace UniSlot.Cli;

/// <summary>The interactive application: main menu, wizard, live run, results actions and settings.</summary>
internal sealed class App(IAnsiConsole c, CliSettings prefs)
{
    private enum Menu { New, Update, Results, Issues, Names, Filter, Settings, Quit }

    private enum After { Schedule, Clashes, Open, New, Menu, Quit }

    private enum Setting { Language, Institution, Output, Seed, Back }

    private SolveRun? _last;

    /// <summary>Runs until the user quits. <paramref name="startWithWizard"/> skips the menu for the first screen.</summary>
    public async Task<int> RunAsync(bool startWithWizard, string? preselected = null)
    {
        bool direct = startWithWizard;
        while (true)
        {
            if (!direct)
            {
                Ui.Clear(c);
                Ui.Banner(c);
                var pick = c.Prompt(new SelectionPrompt<Menu>()
                    .Title($"[bold]{Ui.Esc(Loc.T("cli.menu.title"))}[/]")
                    .HighlightStyle(Ui.S(Ui.Accent, true)).WrapAround()
                    .AddChoices(_last is null ? [Menu.New, Menu.Update, Menu.Issues, Menu.Names, Menu.Filter, Menu.Settings, Menu.Quit] : [Menu.New, Menu.Update, Menu.Results, Menu.Issues, Menu.Names, Menu.Filter, Menu.Settings, Menu.Quit])
                    .UseConverter(m => m switch
                    {
                        Menu.New => Loc.T("nav.solve"),
                        Menu.Update => $"{Ui.Esc(Loc.T("edit.menu.update"))}  [{Ui.MutedM}]{Ui.Esc(Loc.T("edit.menu.update.hint"))}[/]",
                        Menu.Issues => $"{Ui.Esc(Loc.T("edit.menu.issues"))}  [{Ui.MutedM}]{Ui.Esc(Loc.T("edit.menu.issues.hint"))}[/]",
                        Menu.Names => $"{Ui.Esc(Loc.T("edit.menu.names"))}  [{Ui.MutedM}]{Ui.Esc(Loc.T("edit.menu.names.hint"))}[/]",
                        Menu.Filter => $"{Ui.Esc(Loc.T("edit.menu.filter"))}  [{Ui.MutedM}]{Ui.Esc(Loc.T("edit.menu.filter.hint"))}[/]",
                        Menu.Results => $"{Ui.Esc(Loc.T("nav.results"))} [{Ui.MutedM}]{Ui.Esc(_last?.Outcome.Source.FileName ?? "")}[/]",
                        Menu.Settings => Loc.T("nav.settings"),
                        _ => $"[{Ui.MutedM}]{Ui.Esc(Loc.T("cli.quit"))}[/]",
                    }));
                if (pick == Menu.Quit) return 0;
                if (pick == Menu.Settings) { SettingsScreen(); continue; }
                var edits = new EditScreens(c, prefs);
                if (pick == Menu.Issues) { await edits.Issues(); continue; }
                if (pick == Menu.Names) { await edits.NameList(); continue; }
                if (pick == Menu.Filter) { await edits.Filter(); continue; }
                if (pick == Menu.Update)
                {
                    var edited = await edits.UpdateMenu();
                    if (edited is null) continue;
                    _last = edited;
                    if (await ResultsLoop(edited, showFirst: false) == After.Quit) return 0;
                    continue;
                }
                if (pick == Menu.Results && _last is not null)
                {
                    if (await ResultsLoop(_last, showFirst: true) == After.Quit) return 0;
                    continue;
                }
            }
            direct = false;

            var choices = Wizard.Run(c, prefs, preselected);
            preselected = null;
            if (choices is null) continue;
            if (!await RunSolve(choices)) { Browser.Pause(c); continue; }
            if (await ResultsLoop(_last!, showFirst: false) == After.Quit) return 0;
        }
    }

    // ---- one run -------------------------------------------------------------------------------------------------------
    private async Task<bool> RunSolve(Choices ch)
    {
        prefs.Quality = ch.Quality;
        prefs.Prove = ch.Prove;
        prefs.AllowSaturday = ch.Saturday;
        prefs.SaturdayCodes = ch.SaturdayCodes;
        prefs.LastFile = ch.File;
        prefs.Save();

        var request = new SolveRequest(ch.File, SolveRunner.DefaultFolder(prefs, ch.File), SolveRunner.BuildSettings(prefs, null, untimedProof: true), prefs.Institution);
        var sink = new ProgressSink();
        using var cts = new CancellationTokenSource();
        Ui.Clear(c);
        Ui.Header(c, Loc.T("solve.running.title"));
        c.MarkupLine($"[{Ui.MutedM}]{Ui.Esc(Loc.T("solve.running.hint"))}[/]\n");
        try
        {
            Program.SetRunToken(cts);
            _last = await RunView.ShowAsync(c, sink, request.Settings.Prove, Path.GetFileName(ch.File), Task.Run(() => SolveRunner.RunAsync(request, sink, cts.Token)));
            return true;
        }
        catch (Exception ex) when (Program.Report(c, ex)) { return false; }
        finally { Program.SetRunToken(null); }
    }

    // ---- what to do with a finished timetable --------------------------------------------------------------------------
    private async Task<After> ResultsLoop(SolveRun run, bool showFirst)
    {
        bool first = !showFirst;
        while (true)
        {
            if (!first)
            {
                Ui.Clear(c);
                ResultsView.Dashboard(c, run);
            }
            else
            {
                ResultsView.Dashboard(c, run);
            }
            first = false;

            var o = run.Outcome;
            var options = new List<After> { After.Schedule };
            if (o.RedStudents > 0) options.Add(After.Clashes);
            options.AddRange([After.Open, After.New, After.Menu, After.Quit]);
            c.WriteLine();
            var next = c.Prompt(new SelectionPrompt<After>()
                .Title($"[bold]{Ui.Esc(Loc.T("cli.after.title"))}[/]")
                .HighlightStyle(Ui.S(Ui.Accent, true)).WrapAround()
                .AddChoices(options)
                .UseConverter(a => a switch
                {
                    After.Schedule => Loc.T("cli.after.schedule"),
                    After.Clashes => Loc.F("cli.after.clashes", Ui.Number(o.RedStudents)),
                    After.Open => Loc.T("results.openFolder"),
                    After.New => Loc.T("nav.solve"),
                    After.Menu => $"[{Ui.MutedM}]{Ui.Esc(Loc.T("cli.after.menu"))}[/]",
                    _ => $"[{Ui.MutedM}]{Ui.Esc(Loc.T("cli.quit"))}[/]",
                }));
            switch (next)
            {
                case After.Schedule: Browser.Schedule(c, o); break;
                case After.Clashes: Browser.Clashes(c, o); break;
                case After.Open:
                    if (!Ui.OpenFolder(run.Folder)) c.MarkupLine($"[{Ui.WarnM}]{Ui.Esc(run.Folder)}[/]");
                    break;
                case After.New:
                    {
                        var choices = Wizard.Run(c, prefs, prefs.LastFile);
                        if (choices is null) break;
                        if (await RunSolve(choices)) { run = _last!; first = true; }
                        else Browser.Pause(c);
                        break;
                    }
                default: return next;
            }
        }
    }

    // ---- settings --------------------------------------------------------------------------------------------------------
    private void SettingsScreen()
    {
        while (true)
        {
            Ui.Clear(c);
            Ui.Header(c, Loc.T("settings.title"));
            string lang = Loc.Languages.First(l => l.Code == Loc.Code).NativeName;
            string inst = prefs.Institution.Length > 0 ? prefs.Institution : Loc.T("cli.settings.none");
            var pick = c.Prompt(new SelectionPrompt<Setting>()
                .HighlightStyle(Ui.S(Ui.Accent, true)).WrapAround()
                .AddChoices(Setting.Language, Setting.Institution, Setting.Output, Setting.Seed, Setting.Back)
                .UseConverter(s => s switch
                {
                    Setting.Language => $"{Ui.Esc(Loc.T("settings.language"))}  [{Ui.MutedM}]{Ui.Esc(lang)}[/]",
                    Setting.Institution => $"{Ui.Esc(Loc.T("settings.institution"))}  [{Ui.MutedM}]{Ui.Esc(inst)}[/]",
                    Setting.Output => $"{Ui.Esc(Loc.T("settings.output"))}  [{Ui.MutedM}]{Ui.Esc(prefs.OutputRoot)}[/]",
                    Setting.Seed => $"{Ui.Esc(Loc.T("settings.seed"))}  [{Ui.MutedM}]{prefs.Seed.ToString(CultureInfo.InvariantCulture)}[/]",
                    _ => $"[{Ui.MutedM}]{Ui.Esc(Loc.T("solve.back"))}[/]",
                }));
            switch (pick)
            {
                case Setting.Language:
                    {
                        var l = c.Prompt(new SelectionPrompt<LanguageInfo>()
                            .Title($"[bold]{Ui.Esc(Loc.T("settings.language"))}[/]")
                            .HighlightStyle(Ui.S(Ui.Accent, true)).WrapAround()
                            .AddChoices(Loc.Languages)
                            .UseConverter(x => Ui.Esc(x.NativeName)));
                        Loc.Set(l.Code);
                        prefs.Language = l.Code;
                        break;
                    }
                case Setting.Institution:
                    c.MarkupLine($"[{Ui.MutedM}]{Ui.Esc(Loc.T("settings.institution.hint"))} {Ui.Esc(Loc.T("settings.institution.placeholder"))}[/]");
                    prefs.Institution = c.Prompt(new TextPrompt<string>($"[bold]{Ui.Esc(Loc.T("settings.institution"))}[/]").AllowEmpty().PromptStyle(Ui.S(Ui.Accent))).Trim();
                    break;
                case Setting.Output:
                    {
                        string v = Wizard.Clean(c.Prompt(new TextPrompt<string>($"[bold]{Ui.Esc(Loc.T("settings.output"))}[/]").DefaultValue(prefs.OutputRoot).PromptStyle(Ui.S(Ui.Accent))));
                        if (v.Length > 0) prefs.OutputRoot = Path.GetFullPath(v);
                        break;
                    }
                case Setting.Seed:
                    c.MarkupLine($"[{Ui.MutedM}]{Ui.Esc(Loc.T("settings.seed.hint"))}[/]");
                    prefs.Seed = (long)c.Prompt(new TextPrompt<ulong>($"[bold]{Ui.Esc(Loc.T("settings.seed"))}[/]")
                        .DefaultValue((ulong)Math.Max(0, prefs.Seed)).PromptStyle(Ui.S(Ui.Accent))
                        .Validate(n => n <= long.MaxValue ? ValidationResult.Success() : ValidationResult.Error()));
                    break;
                default:
                    prefs.Save();
                    return;
            }
            prefs.Save();
        }
    }
}
