using System.Globalization;
using Spectre.Console;
using UniSlot.Application.Editing;
using UniSlot.Application.Importing;
using UniSlot.Domain;
using UniSlot.Infrastructure;

namespace UniSlot.Cli;

/// <summary>Interactive flows for maintaining a published timetable and checking enrollment data.</summary>
/// <remarks><paramref name="given"/> holds options already typed on the command line; those questions are not asked again.</remarks>
internal sealed class EditScreens(IAnsiConsole c, CliSettings prefs, EditOptions? given = null)
{
    private enum Action { Late, Rectify, Fix, Drop, Revert, Back }

    private enum Answer { Apply, Cancel }

    private sealed record FolderChoice(string? Path, string Label, bool Back = false, bool Browse = false);

    private sealed record RowChoice(EnrollmentRow? Row);

    // ---- menu --------------------------------------------------------------------------------------------------------------------
    /// <summary>Shows the "update a published timetable" menu. Returns the run when an edit was applied.</summary>
    public async Task<SolveRun?> UpdateMenu()
    {
        Ui.Clear(c);
        Ui.Header(c, Loc.T("edit.update.title"));
        var pick = c.Prompt(new SelectionPrompt<Action>()
            .Title($"[bold]{Ui.Esc(Loc.T("edit.update.prompt"))}[/]")
            .HighlightStyle(Ui.S(Ui.Accent, true)).WrapAround()
            .AddChoices(Action.Late, Action.Rectify, Action.Fix, Action.Drop, Action.Revert, Action.Back)
            .UseConverter(a => a switch
            {
                Action.Late => $"{Ui.Esc(Loc.T("edit.mode.late"))}  [{Ui.MutedM}]{Ui.Esc(Loc.T("edit.hint.late"))}[/]",
                Action.Rectify => $"{Ui.Esc(Loc.T("edit.mode.rectify"))}  [{Ui.MutedM}]{Ui.Esc(Loc.T("edit.hint.rectify"))}[/]",
                Action.Fix => $"{Ui.Esc(Loc.T("edit.mode.fix-course"))}  [{Ui.MutedM}]{Ui.Esc(Loc.T("edit.hint.fix"))}[/]",
                Action.Drop => $"{Ui.Esc(Loc.T("edit.mode.drop-course"))}  [{Ui.MutedM}]{Ui.Esc(Loc.T("edit.hint.drop"))}[/]",
                Action.Revert => $"{Ui.Esc(Loc.T("edit.mode.revert"))}  [{Ui.MutedM}]{Ui.Esc(Loc.T("edit.hint.revert"))}[/]",
                _ => $"[{Ui.MutedM}]{Ui.Esc(Loc.T("solve.back"))}[/]",
            }));
        if (pick == Action.Back) return null;

        try
        {
            return pick switch
            {
                Action.Late => await Late(),
                Action.Rectify => await Rectify(),
                Action.Fix => await Fix(),
                Action.Drop => await Drop(),
                _ => await Revert(),
            };
        }
        catch (Exception ex) when (Program.Report(c, ex))
        {
            Browser.Pause(c);
            return null;
        }
    }

    // ---- the five edits ----------------------------------------------------------------------------------------------------------
    public async Task<SolveRun?> Late()
    {
        string? prev = given?.Previous ?? PickFolder(Loc.T("edit.folder.pick"));
        if (prev is null) return null;
        string? file = given?.LateFile;
        if (file is null)
        {
            Section(Loc.T("edit.late.file"));
            file = Wizard.PickWorkbook(c, prefs, "", allowBack: true);
        }
        if (file is null) return null;

        var onFull = given is { OnFullGiven: true } ? given.OnFull : c.Prompt(new SelectionPrompt<FullPolicy>()
            .Title($"[bold]{Ui.Esc(Loc.T("edit.onfull.title"))}[/]").HighlightStyle(Ui.S(Ui.Accent, true)).WrapAround()
            .AddChoices(FullPolicy.NewSection, FullPolicy.Fit, FullPolicy.Park)
            .UseConverter(p => $"{Ui.Esc(Loc.T($"edit.onfull.{p}"))}  [{Ui.MutedM}]{Ui.Esc(Loc.T($"edit.onfull.{p}.hint"))}[/]"));
        var onClash = given is { OnClashGiven: true } ? given.OnClash : c.Prompt(new SelectionPrompt<ClashPolicy>()
            .Title($"[bold]{Ui.Esc(Loc.T("edit.onclash.title"))}[/]").HighlightStyle(Ui.S(Ui.Accent, true)).WrapAround()
            .AddChoices(ClashPolicy.Accept, ClashPolicy.ParkStudent)
            .UseConverter(p => $"{Ui.Esc(Loc.T($"edit.onclash.{p}"))}  [{Ui.MutedM}]{Ui.Esc(Loc.T($"edit.onclash.{p}.hint"))}[/]"));

        var prepared = await Working(() => Maintenance.PrepareLate(prev, file, onFull, onClash, CancellationToken.None));
        return await Confirm(prepared, prev);
    }

    public async Task<SolveRun?> Rectify()
    {
        string? prev = given?.Previous ?? PickFolder(Loc.T("edit.folder.pick"));
        if (prev is null) return null;
        string? file = given?.RectifiedFile;
        if (file is null)
        {
            Section(Loc.T("edit.rectify.file"));
            file = Wizard.PickWorkbook(c, prefs, "", allowBack: true);
        }
        if (file is null) return null;
        var prepared = await Working(() => Maintenance.PrepareRectify(prev, file, CancellationToken.None));
        return await Confirm(prepared, prev);
    }

    public async Task<SolveRun?> Drop()
    {
        string? prev = given?.Previous ?? PickFolder(Loc.T("edit.folder.pick"));
        if (prev is null) return null;
        var ws = await Working(() => SnapshotStore.ReadAsync(prev));
        string? reg = given?.Registers is [var r1] && ws.RowsOf(r1).Any() ? r1 : AskStudent(ws);
        if (reg is null) return null;
        string? course = given?.Courses is [var c1] && ws.IsEnrolled(reg, c1) ? c1 : AskCourse(ws, reg);
        if (course is null) return null;
        return await Confirm(new Prepared(ws, Edits.DropCourse(ws, reg, course)), prev);
    }

    public async Task<SolveRun?> Fix()
    {
        string? prev = given?.Previous ?? PickFolder(Loc.T("edit.folder.pick"));
        if (prev is null) return null;
        var ws = await Working(() => SnapshotStore.ReadAsync(prev));
        string? reg = given?.Registers is [var r1] && ws.RowsOf(r1).Any() ? r1 : AskStudent(ws);
        if (reg is null) return null;
        string? from = given?.From is { } f1 && ws.IsEnrolled(reg, f1) ? f1 : AskCourse(ws, reg);
        if (from is null) return null;

        c.WriteLine();
        string to = given?.To is { } t1 && t1 != from && !ws.IsEnrolled(reg, t1) ? t1 : c.Prompt(new TextPrompt<string>($"[bold]{Ui.Esc(Loc.T("edit.fix.to"))}[/]").PromptStyle(Ui.S(Ui.Accent))
            .Validate(s => s.Trim().ToUpperInvariant() == from ? ValidationResult.Error($"[{Ui.BadM}]{Ui.Esc(Loc.T("edit.fix.same"))}[/]")
                : ws.IsEnrolled(reg, s.Trim().ToUpperInvariant()) ? ValidationResult.Error($"[{Ui.BadM}]{Ui.Esc(Loc.F("edit.fix.already", s.Trim().ToUpperInvariant()))}[/]")
                : ValidationResult.Success())).Trim().ToUpperInvariant();
        string? title = null;
        if (!ws.HasCourse(to))
        {
            c.MarkupLine($"[{Ui.MutedM}]{Ui.Esc(Loc.F("edit.fix.new", to))}[/]");
            title = given?.ToTitle ?? c.Prompt(new TextPrompt<string>($"[bold]{Ui.Esc(Loc.T("edit.fix.title"))}[/]").PromptStyle(Ui.S(Ui.Accent)));
        }
        return await Confirm(new Prepared(ws, Edits.FixCourse(ws, reg, from, to, title)), prev);
    }

    public async Task<SolveRun?> Revert()
    {
        string? edited = given?.Edited ?? PickFolder(Loc.T("edit.edited.pick"));
        if (edited is null) return null;
        string? prev = given?.Previous ?? PickFolder(Loc.T("edit.previous.pick"), exclude: edited);
        if (prev is null) return null;

        var (e, p, diff) = await Working(() => Maintenance.LoadRevert(edited, prev, CancellationToken.None));
        if (diff.Count == 0)
        {
            c.MarkupLine($"\n[{Ui.WarnM}]{Ui.Esc(Loc.T("edit.revert.none"))}[/]");
            Browser.Pause(c);
            return null;
        }

        if (given is not null && (given.All || given.Registers.Length > 0 || given.Courses.Length > 0))
        {
            var picked = Maintenance.Select(diff, given.Registers, given.Courses, given.All);
            if (picked.Count == 0)
            {
                c.MarkupLine($"\n[{Ui.WarnM}]{Ui.Esc(Loc.T("cli.noMatches"))}[/]");
                return null;
            }
            return await Confirm(Maintenance.PrepareRevert(e, p, picked), edited);
        }

        var shown = diff;
        if (diff.Count > 30)
        {
            c.MarkupLine($"\n[{Ui.MutedM}]{Ui.Esc(Loc.F("edit.revert.many", diff.Count))}[/]");
            string q = c.Prompt(new TextPrompt<string>($"[bold]{Ui.Esc(Loc.T("edit.revert.filter"))}[/]").AllowEmpty().PromptStyle(Ui.S(Ui.Accent))).Trim();
            if (q.Length > 0)
            {
                var terms = q.Split([',', ';', ' '], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                shown = [.. diff.Where(d => terms.Any(t => d.Register.Contains(t, StringComparison.OrdinalIgnoreCase) || d.Course.Contains(t, StringComparison.OrdinalIgnoreCase)
                    || (d.ToCourse?.Contains(t, StringComparison.OrdinalIgnoreCase) ?? false)))];
                if (shown.Count == 0) { c.MarkupLine($"[{Ui.WarnM}]{Ui.Esc(Loc.T("cli.noMatches"))}[/]"); Browser.Pause(c); return null; }
            }
        }

        var chosen = c.Prompt(new MultiSelectionPrompt<RegistrationChange>()
            .Title($"[bold]{Ui.Esc(Loc.T("edit.revert.pick"))}[/]")
            .NotRequired()
            .PageSize(Math.Clamp(Ui.Height() - 8, 6, 25))
            .HighlightStyle(Ui.S(Ui.Accent, true))
            .InstructionsText($"[{Ui.MutedM}]{Ui.Esc(Loc.T("edit.revert.instructions"))}[/]")
            .AddChoices(shown)
            .UseConverter(d => $"{Ui.Esc(d.Register)} {Ui.Esc(Ui.Truncate(d.Name, 22))}  [{Ui.MutedM}]{Ui.Esc(d.Describe())}[/]")).ToList();
        if (chosen.Count == 0) chosen = [.. shown];   // nothing ticked: restore everything shown, after the confirmation below

        return await Confirm(Maintenance.PrepareRevert(e, p, chosen), edited);
    }

    // ---- name list, filter, issues -----------------------------------------------------------------------------------------------
    public async Task NameList()
    {
        try
        {
            string? folder = given?.SourceFolder ?? PickFolder(Loc.T("edit.folder.pick"));
            if (folder is null) return;
            var (path, rows) = await Working(() => Maintenance.NameListAsync(folder, given?.Output ?? folder, CancellationToken.None));
            c.MarkupLine($"\n[{Ui.GoodM}]{Ui.Tick(c)}[/] {Ui.Esc(Loc.F("edit.names.done", Ui.Number(rows)))}\n  [bold]{Ui.Esc(path)}[/]\n  [{Ui.MutedM}]{Ui.Esc(Loc.T("edit.names.note"))}[/]");
        }
        catch (Exception ex) when (Program.Report(c, ex)) { /* shown */ }
        Browser.Pause(c);
    }

    public async Task Filter()
    {
        try
        {
            string? folder = given?.SourceFolder ?? PickFolder(Loc.T("edit.folder.pick"));
            if (folder is null) return;
            string codes;
            if (given is { Courses.Length: > 0 }) codes = string.Join(",", given.Courses);
            else
            {
                c.WriteLine();
                c.MarkupLine($"[{Ui.MutedM}]{Ui.Esc(Loc.T("edit.filter.hint"))}[/]");
                codes = c.Prompt(new TextPrompt<string>($"[bold]{Ui.Esc(Loc.T("edit.filter.codes"))}[/]").PromptStyle(Ui.S(Ui.Accent)));
            }
            string outDir = given?.Output ?? (Ui.Classic ? Classic.AskOutput(c, "unislot-filtered", DefaultOut(folder, "filtered")) : DefaultOut(folder, "filtered"));
            var r = await Working(() => Maintenance.FilterAsync(folder, codes.Split([',', ';', ' '], StringSplitOptions.RemoveEmptyEntries), outDir, prefs.Institution, CancellationToken.None));
            c.MarkupLine($"\n[{Ui.GoodM}]{Ui.Tick(c)}[/] {Ui.Esc(Loc.F("edit.filter.done", r.KeptCourses, r.KeptSections))}\n  [bold]{Ui.Esc(r.Path)}[/]");
            if (r.Missing.Count > 0) c.MarkupLine($"  [{Ui.WarnM}]{Ui.Esc(Loc.F("edit.filter.missing", string.Join(", ", r.Missing)))}[/]");
        }
        catch (Exception ex) when (Program.Report(c, ex)) { /* shown */ }
        Browser.Pause(c);
    }

    public async Task Issues()
    {
        try
        {
            Ui.Clear(c);
            Ui.Header(c, Loc.T("edit.menu.issues"));
            string? file = given?.Input ?? Wizard.PickWorkbook(c, prefs, prefs.LastFile, allowBack: true);
            if (file is null) return;
            var input = await Working(() => Infrastructure.XlsxEnrollmentSource.ReadAsync(file));
            EditView.Issues(c, IssueFinder.Find(input.Grid), input.Source.FileName);
        }
        catch (Exception ex) when (Program.Report(c, ex)) { /* shown */ }
        Browser.Pause(c);
    }

    // ---- shared pieces -----------------------------------------------------------------------------------------------------------
    private async Task<SolveRun?> Confirm(Prepared prepared, string prevFolder)
    {
        c.WriteLine();
        EditView.Preview(c, prepared.Plan);
        c.WriteLine();
        var answer = c.Prompt(new SelectionPrompt<Answer>()
            .Title($"[bold]{Ui.Esc(Loc.T("edit.confirm"))}[/]").HighlightStyle(Ui.S(Ui.Accent, true)).WrapAround()
            .AddChoices(Answer.Apply, Answer.Cancel)
            .UseConverter(v => v == Answer.Apply ? $"[bold {Ui.GoodM}]{Ui.Esc(Loc.T("edit.apply"))}[/]" : $"[{Ui.MutedM}]{Ui.Esc(Loc.T("solve.cancel"))}[/]"));
        bool go = answer == Answer.Apply;
        if (!go) return null;

        string mode = prepared.Plan.Info.Mode;
        string outFolder = given?.Output is { } chosenOut ? chosenOut : Ui.Classic
            ? Classic.AskOutput(c, mode switch { EditOptions.Rectify => "unislot-out-rectified", EditOptions.FixCourse or EditOptions.DropCourse => "unislot-out-fix", _ => $"unislot-out-{mode}" }, DefaultOut(prevFolder, mode))
            : DefaultOut(prevFolder, mode);
        var sink = new ProgressSink();
        using var cts = new CancellationTokenSource();
        Ui.Clear(c);
        Ui.Header(c, EditView.ModeLabel(prepared.Plan.Info.Mode));
        try
        {
            Program.SetRunToken(cts);
            var run = await RunView.ShowAsync(c, sink, false, EditView.ModeLabel(prepared.Plan.Info.Mode),
                Task.Run(() => Maintenance.ApplyAsync(prepared, outFolder, prefs.Institution, sink, cts.Token)));
            EditView.Show(c, run);
            return run;
        }
        finally { Program.SetRunToken(null); }
    }

    private string DefaultOut(string source, string mode) =>
        Path.Combine(prefs.OutputRoot, $"{Path.GetFileName(source.TrimEnd('\\', '/'))}-{mode}-{DateTime.Now:yyyyMMdd-HHmmss}");

    private void Section(string title)
    {
        c.WriteLine();
        c.MarkupLine($"[bold {Ui.AccentM}]{Ui.Esc(title)}[/]");
    }

    /// <summary>Runs quick work behind a status spinner (reading folders and workbooks).</summary>
    private async Task<T> Working<T>(Func<Task<T>> work)
    {
        T? result = default;
        await c.Status().Spinner(Spinner.Known.Dots).SpinnerStyle(Ui.S(Ui.Accent)).StartAsync(Loc.T("edit.working"), async _ => result = await work());
        return result!;
    }

    private string? PickFolder(string title, string? exclude = null)
    {
        Ui.Clear(c);
        Ui.Header(c, title);
        var roots = new[] { prefs.OutputRoot, Path.Combine(Directory.GetCurrentDirectory(), "unislot-out"), Directory.GetCurrentDirectory() };
        var found = SnapshotStore.Discover(roots)
            .Where(f => exclude is null || !string.Equals(Path.GetFullPath(f.Path).TrimEnd('\\', '/'), Path.GetFullPath(exclude).TrimEnd('\\', '/'), StringComparison.OrdinalIgnoreCase))
            .ToList();

        bool dialogFirst = Ui.Classic;   // like the original tool: open the system folder dialog straight away, then fall back to the list
        while (true)
        {
            string? chosen = null;
            bool browse = dialogFirst;
            dialogFirst = false;
            if (browse && FileDialog.Available)
            {
                string? d = FileDialog.PickFolder(title);
                if (d is not null && !SnapshotStore.IsOutputFolder(d)) c.MarkupLine($"[{Ui.BadM}]{Ui.Esc(Loc.F("edit.folder.invalid", d))}[/]");
                else chosen = d;
            }
            if (chosen is not null) { /* picked in the dialog */ }
            else if (found.Count == 0) chosen = AskFolder();
            else
            {
                var choices = found.Select(f => new FolderChoice(f.Path, Label(f))).ToList();
                if (FileDialog.Available) choices.Add(new FolderChoice(null, $"[{Ui.AccentM}]{Ui.Esc(Loc.T("classic.browse"))}[/]", Browse: true));
                choices.Add(new FolderChoice(null, $"[{Ui.AccentM}]{Ui.Esc(Loc.T("edit.folder.type"))}[/]"));
                choices.Add(new FolderChoice(null, $"[{Ui.MutedM}]{Ui.Esc(Loc.T("solve.back"))}[/]", Back: true));
                var pick = c.Prompt(new SelectionPrompt<FolderChoice>()
                    .Title($"[bold]{Ui.Esc(Loc.T("edit.folder.found"))}[/]")
                    .PageSize(12).HighlightStyle(Ui.S(Ui.Accent, true)).WrapAround()
                    .AddChoices(choices).UseConverter(f => f.Label));
                if (pick.Back) return null;
                if (pick.Browse) { dialogFirst = true; continue; }
                chosen = pick.Path ?? AskFolder();
            }
            if (chosen is null) return null;
            if (exclude is not null && string.Equals(Path.GetFullPath(chosen).TrimEnd('\\', '/'), Path.GetFullPath(exclude).TrimEnd('\\', '/'), StringComparison.OrdinalIgnoreCase))
            {
                c.MarkupLine($"[{Ui.BadM}]{Ui.Esc(Loc.T("edit.folder.different"))}[/]");
                found = [];
                continue;
            }
            return chosen;
        }
    }

    private string? AskFolder()
    {
        string text = c.Prompt(new TextPrompt<string>($"[bold]{Ui.Esc(Loc.T("edit.folder.prompt"))}[/] [{Ui.MutedM}]({Ui.Esc(Loc.T("edit.empty.back"))})[/]")
            .AllowEmpty().PromptStyle(Ui.S(Ui.Accent))
            .Validate(s =>
            {
                string p = Wizard.Clean(s);
                return p.Length == 0 || SnapshotStore.IsOutputFolder(p) ? ValidationResult.Success()
                    : ValidationResult.Error($"[{Ui.BadM}]{Ui.Esc(Loc.F("edit.folder.invalid", p))}[/]");
            }));
        string path = Wizard.Clean(text);
        return path.Length == 0 ? null : Path.GetFullPath(path);
    }

    private static string Label(FolderInfo f)
    {
        string name = Path.GetFileName(f.Path.TrimEnd('\\', '/'));
        string red = f.RedStudents is { } r ? $" · {Loc.T("card.red")} {r}" : "";
        return $"[bold]{Ui.Esc(Ui.Truncate(name, 40))}[/]  [{Ui.MutedM}]{Ui.Esc(Ui.Truncate(f.SourceName, 28))} · {Ui.Esc(Loc.F("edit.folder.counts", Ui.Number(f.Students), Ui.Number(f.Courses)))}{Ui.Esc(red)} · {Ui.Esc(f.Modified.ToString("g", CultureInfo.CurrentCulture))}[/]";
    }

    /// <summary>Finds a student by register number, or by part of a register number or name.</summary>
    private string? AskStudent(Workspace ws)
    {
        while (true)
        {
            c.WriteLine();
            string text = c.Prompt(new TextPrompt<string>($"[bold]{Ui.Esc(Loc.T("edit.register.prompt"))}[/] [{Ui.MutedM}]({Ui.Esc(Loc.T("edit.empty.back"))})[/]").AllowEmpty().PromptStyle(Ui.S(Ui.Accent))).Trim();
            if (text.Length == 0) return null;
            if (ws.RowsOf(text).Any()) return text;
            var matches = ws.Rows.GroupBy(r => r.RegisterNumber, StringComparer.Ordinal)
                .Where(g => g.Key.Contains(text, StringComparison.OrdinalIgnoreCase) || g.First().StudentName.Contains(text, StringComparison.OrdinalIgnoreCase))
                .Select(g => g.First()).Take(10).ToList();
            if (matches.Count == 0)
            {
                c.MarkupLine($"[{Ui.WarnM}]{Ui.Esc(Loc.F("edit.register.unknown", text))}[/]");
                continue;
            }
            var pick = c.Prompt(new SelectionPrompt<RowChoice>()
                .Title($"[bold]{Ui.Esc(Loc.T("edit.register.pick"))}[/]").HighlightStyle(Ui.S(Ui.Accent, true)).WrapAround()
                .AddChoices([.. matches.Select(m => new RowChoice(m)), new RowChoice(null)])
                .UseConverter(x => x.Row is not { } r ? $"[{Ui.MutedM}]{Ui.Esc(Loc.T("solve.back"))}[/]" : $"{Ui.Esc(r.RegisterNumber)}  [{Ui.MutedM}]{Ui.Esc(r.StudentName)}[/]"));
            if (pick.Row is { } chosen) return chosen.RegisterNumber;
        }
    }

    private string? AskCourse(Workspace ws, string register)
    {
        var rows = ws.RowsOf(register).ToList();
        c.MarkupLine($"\n[{Ui.MutedM}]{Ui.Esc(rows[0].StudentName)} · {Ui.Esc(rows[0].Program)}[/]");
        var pick = c.Prompt(new SelectionPrompt<RowChoice>()
            .Title($"[bold]{Ui.Esc(Loc.T("edit.course.pick"))}[/]").HighlightStyle(Ui.S(Ui.Accent, true)).WrapAround()
            .AddChoices([.. rows.Select(r => new RowChoice(r)), new RowChoice(null)])
            .UseConverter(x => x.Row is not { } r ? $"[{Ui.MutedM}]{Ui.Esc(Loc.T("solve.back"))}[/]"
                : $"[bold]{Ui.Esc(r.CourseCode)}[/]  [{Ui.MutedM}]{Ui.Esc(Ui.Truncate(r.CourseTitle, 44))} · {Ui.Esc(ws.SectionOf(register, r.CourseCode) ?? "")}[/]"));
        return pick.Row?.CourseCode;
    }
}
