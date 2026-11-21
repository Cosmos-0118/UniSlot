using Spectre.Console;
using Spectre.Console.Rendering;
using UniSlot.Application.Editing;
using UniSlot.Application.Importing;
using UniSlot.Application.Workflow;

namespace UniSlot.Cli;

/// <summary>Screens for edit runs: what is about to change, what changed, and the enrollment-issue report.</summary>
internal static class EditView
{
    public static string ModeLabel(string mode) => Loc.T($"edit.mode.{mode}");

    private static string KindLabel(string kind) => Loc.T($"edit.kind.{kind}");

    private static string KindColour(string kind) => kind switch { "added" or "restored" => Ui.GoodM, "removed" => Ui.BadM, "parked" => Ui.WarnM, _ => Ui.AccentM };

    // ---- before anything is written -------------------------------------------------------------------------------------------
    public static void Preview(IAnsiConsole c, EditPlan plan, int rows = 10)
    {
        var e = plan.Info;
        var g = new Grid().AddColumn(new GridColumn().NoWrap()).AddColumn();
        g.AddRow(new Markup($"[{Ui.MutedM}]{Ui.Esc(Loc.T("edit.changed.registrations"))}[/]"), new Markup(Counts(c, e)));
        if (e.CoursesAdded > 0) g.AddRow(new Markup($"[{Ui.MutedM}]{Ui.Esc(Loc.T("edit.changed.newCourses"))}[/]"), new Markup(e.CoursesAdded.ToString()));
        if (e.SectionsCreated.Count > 0) g.AddRow(new Markup($"[{Ui.MutedM}]{Ui.Esc(Loc.T("edit.changed.sections"))}[/]"), new Markup(Ui.Esc(string.Join(", ", e.SectionsCreated))));
        if (e.Parked.Count > 0) g.AddRow(new Markup($"[{Ui.MutedM}]{Ui.Esc(Loc.T("edit.changed.parked"))}[/]"), new Markup($"[{Ui.WarnM}]{e.Parked.Count}[/]"));
        var parts = new List<IRenderable> { g };
        foreach (string n in e.Notes) parts.Add(new Markup($"[{Ui.AccentM}]{Ui.Bullet(c)}[/] {Ui.Esc(n)}"));
        c.Write(new Panel(new Rows(parts))
        {
            Header = new PanelHeader($" {Ui.Esc(Loc.T("edit.preview"))} {Ui.Sep(c)} {Ui.Esc(ModeLabel(e.Mode))} "),
            Border = Ui.Box(c),
            BorderStyle = Ui.S(Ui.Accent),
            Padding = new Padding(2, 0),
            Expand = true,
        });
        ChangeTable(c, e.Changes, rows);
    }

    private static string Counts(IAnsiConsole c, EditInfo e) =>
        $"[{Ui.GoodM}]+{Ui.Number(e.RegistrationsAdded)}[/]  [{Ui.BadM}]−{Ui.Number(e.RegistrationsRemoved)}[/]";

    // ---- after the run -----------------------------------------------------------------------------------------------------------
    public static void Show(IAnsiConsole c, SolveRun run)
    {
        var o = run.Outcome;
        if (o.Settings.Edit is not { } e) return;
        var delta = e.PreviousClash is { } before ? ClashDiff.Compare(before, o.Clash) : null;

        c.WriteLine();
        c.Write(new Rule($"[bold {Ui.AccentM}]{Ui.Esc(Loc.T("edit.changed.title"))}[/] [{Ui.MutedM}]{Ui.Sep(c)} {Ui.Esc(ModeLabel(e.Mode))}[/]") { Style = Ui.S(Ui.Muted), Justification = Justify.Left });
        c.WriteLine();

        var g = new Grid().AddColumn(new GridColumn().NoWrap()).AddColumn();
        if (e.PreviousClash is { } prev)
        {
            string colour = o.RedStudents < prev.StudentsWithClashes ? Ui.GoodM : o.RedStudents > prev.StudentsWithClashes ? Ui.BadM : Ui.MutedM;
            g.AddRow(new Markup($"[{Ui.MutedM}]{Ui.Esc(Loc.T("card.red"))}[/]"),
                new Markup($"{prev.StudentsWithClashes} [{Ui.MutedM}]{(c.Profile.Capabilities.Unicode ? "→" : "->")}[/] [bold {colour}]{o.RedStudents}[/]"));
        }
        g.AddRow(new Markup($"[{Ui.MutedM}]{Ui.Esc(Loc.T("edit.changed.registrations"))}[/]"), new Markup(Counts(c, e)));
        if (e.CoursesAdded > 0) g.AddRow(new Markup($"[{Ui.MutedM}]{Ui.Esc(Loc.T("edit.changed.newCourses"))}[/]"), new Markup(e.CoursesAdded.ToString()));
        if (e.SectionsCreated.Count > 0) g.AddRow(new Markup($"[{Ui.MutedM}]{Ui.Esc(Loc.T("edit.changed.sections"))}[/]"), new Markup(Ui.Esc(string.Join(", ", e.SectionsCreated))));
        if (e.Waivers.Count > 0) g.AddRow(new Markup($"[{Ui.MutedM}]{Ui.Esc(Loc.T("edit.changed.waivers"))}[/]"), new Markup($"[{Ui.WarnM}]{e.Waivers.Count}[/]"));
        if (e.Parked.Count > 0) g.AddRow(new Markup($"[{Ui.MutedM}]{Ui.Esc(Loc.T("edit.changed.parked"))}[/]"), new Markup($"[{Ui.WarnM}]{e.Parked.Count}[/]"));
        if (delta is not null)
        {
            g.AddRow(new Markup($"[{Ui.MutedM}]{Ui.Esc(Loc.T("edit.changed.newClashes"))}[/]"), new Markup(delta.Introduced.Count == 0 ? $"[{Ui.GoodM}]0[/]" : $"[bold {Ui.BadM}]{delta.Introduced.Count}[/]"));
            g.AddRow(new Markup($"[{Ui.MutedM}]{Ui.Esc(Loc.T("edit.changed.resolved"))}[/]"), new Markup(delta.Resolved.Count.ToString()));
        }
        var parts = new List<IRenderable> { g };
        foreach (string n in e.Notes) parts.Add(new Markup($"[{Ui.AccentM}]{Ui.Bullet(c)}[/] {Ui.Esc(n)}"));
        c.Write(new Panel(new Rows(parts)) { Border = Ui.Box(c), BorderStyle = Ui.S(Ui.Muted), Padding = new Padding(2, 0), Expand = true });

        ChangeTable(c, e.Changes, 12);
        if (delta is { Introduced.Count: > 0 })
        {
            c.MarkupLine($"\n[bold {Ui.BadM}]{Ui.Esc(Loc.T("edit.changed.newClashes"))}[/]");
            foreach (var x in delta.Introduced.Take(8))
                c.MarkupLine($"  [{Ui.BadM}]{Ui.Cross(c)}[/] {Ui.Esc(x.Register)} {Ui.Esc(Ui.Truncate(x.Name, 24))} [{Ui.MutedM}]{Ui.Sep(c)} {Ui.Esc(Loc.T($"day.{(int)x.Day}"))} {Ui.Sep(c)} {Ui.Esc(string.Join(", ", x.Courses))}[/]");
            if (delta.Introduced.Count > 8) c.MarkupLine($"  [{Ui.MutedM}]{Ui.Esc(Loc.F("edit.changed.more", delta.Introduced.Count - 8))}[/]");
        }
    }

    private static void ChangeTable(IAnsiConsole c, IReadOnlyList<EditChange> changes, int max)
    {
        if (changes.Count == 0) return;
        var t = new Table { Border = Ui.TableBox(c), BorderStyle = Ui.S(Ui.Muted), Expand = false };
        t.AddColumn(Loc.T("col.register"));
        t.AddColumn(Loc.T("col.student"));
        t.AddColumn(Loc.T("col.course"));
        t.AddColumn(Loc.T("edit.col.change"));
        if (Ui.Width(c) >= 90) t.AddColumn(Loc.T("edit.col.detail"));
        foreach (var x in changes.Take(max))
        {
            var cells = new List<IRenderable>
            {
                new Markup(Ui.Esc(x.Register)),
                new Markup(Ui.Esc(Ui.Truncate(x.Name, 24))),
                new Markup($"[bold]{Ui.Esc(x.Course)}[/]"),
                new Markup($"[{KindColour(x.Kind)}]{Ui.Esc(KindLabel(x.Kind))}[/]"),
            };
            if (Ui.Width(c) >= 90) cells.Add(new Markup($"[{Ui.MutedM}]{Ui.Esc(Ui.Truncate(x.Detail, Math.Max(20, Ui.Width(c) - 78)))}[/]"));
            t.AddRow(cells);
        }
        c.Write(t);
        if (changes.Count > max) c.MarkupLine($"[{Ui.MutedM}]{Ui.Esc(Loc.F("edit.changed.more", changes.Count - max))}[/]");
    }

    public static void Plain(TextWriter w, SolveRun run, int limit)
    {
        var o = run.Outcome;
        var e = o.Settings.Edit!;
        var delta = e.PreviousClash is { } before ? ClashDiff.Compare(before, o.Clash) : null;
        w.WriteLine($"UniSlot {Ui.Version()}  ·  {e.Mode}  ·  {o.Source.FileName}");
        if (e.PreviousClash is { } prev) w.WriteLine($"  RED students   {prev.StudentsWithClashes} → {o.RedStudents}");
        w.WriteLine($"  Registrations  +{e.RegistrationsAdded} −{e.RegistrationsRemoved}   ·  new courses {e.CoursesAdded}  ·  sections opened {e.SectionsCreated.Count}  ·  parked {e.Parked.Count}  ·  over capacity {e.Waivers.Count}");
        if (delta is not null) w.WriteLine($"  Clashes        {delta.Introduced.Count} new · {delta.Resolved.Count} resolved · {delta.CarriedOver.Count} unchanged");
        w.WriteLine($"  Hard rules     {(o.Audit.IsStructurallyFeasible ? "all satisfied" : $"{o.Audit.Structural.Count} VIOLATION(S)")}");
        foreach (var v in o.Audit.Structural.Take(10)) w.WriteLine($"    ! {v.Detail}");
        foreach (string n in e.Notes) w.WriteLine($"  note: {n}");
        foreach (var x in e.Changes.Take(limit)) w.WriteLine($"  {x.Kind,-8} {x.Register} {x.Course} {x.Detail}".TrimEnd());
        if (e.Changes.Count > limit) w.WriteLine($"  … and {e.Changes.Count - limit} more (see the report in the output folder)");
        w.WriteLine($"  Done in {run.Elapsed.TotalSeconds:0.00} s → {run.Folder}");
    }

    // ---- enrollment issues --------------------------------------------------------------------------------------------------------
    public static void Issues(IAnsiConsole c, IssueReport report, string fileName)
    {
        c.WriteLine();
        c.Write(new Rule($"[bold {Ui.AccentM}]{Ui.Esc(Loc.T("edit.issues.title"))}[/] [{Ui.MutedM}]{Ui.Sep(c)} {Ui.Esc(Ui.Truncate(fileName, 50))}[/]") { Style = Ui.S(Ui.Muted), Justification = Justify.Left });
        c.WriteLine();
        if (report.Issues.Count == 0)
        {
            c.MarkupLine($"[{Ui.GoodM}]{Ui.Tick(c)} {Ui.Esc(Loc.T("edit.issues.none"))}[/] [{Ui.MutedM}]{Ui.Esc(Loc.F("edit.issues.usable", Ui.Number(report.UsableRows)))}[/]");
            return;
        }
        foreach (var group in report.Issues.GroupBy(i => i.Category).OrderBy(g => g.Key))
        {
            bool blocking = group.Any(i => i.Blocking);
            var rows = group.Take(8).Select(i => (IRenderable)new Markup($"[{(i.Blocking ? Ui.BadM : Ui.WarnM)}]{(i.Blocking ? Ui.Cross(c) : Ui.Bullet(c))}[/] {Ui.Esc(i.Row is { } r ? $"{Loc.T("edit.issues.row")} {r}: {i.Message}" : i.Message)}")).ToList();
            if (group.Count() > 8) rows.Add(new Markup($"[{Ui.MutedM}]{Ui.Esc(Loc.F("edit.changed.more", group.Count() - 8))}[/]"));
            c.Write(new Panel(new Rows(rows))
            {
                Header = new PanelHeader($" {Ui.Esc(Loc.T($"edit.issues.cat.{group.Key.ToString().ToLowerInvariant()}"))} ({group.Count()}) "),
                Border = Ui.Box(c),
                BorderStyle = Ui.S(blocking ? Ui.Bad : Ui.Warn),
                Padding = new Padding(2, 0),
                Expand = true,
            });
        }
        c.MarkupLine(report.HasBlocking
            ? $"[bold {Ui.BadM}]{Ui.Cross(c)} {Ui.Esc(Loc.T("edit.issues.blocking"))}[/]"
            : $"[{Ui.GoodM}]{Ui.Tick(c)} {Ui.Esc(Loc.T("edit.issues.ok"))}[/] [{Ui.MutedM}]{Ui.Esc(Loc.F("edit.issues.usable", Ui.Number(report.UsableRows)))}[/]");
    }

    public static void IssuesPlain(TextWriter w, IssueReport report, string fileName)
    {
        w.WriteLine($"Enrollment issues · {fileName} · {report.UsableRows:N0} usable of {report.TotalRows:N0} rows");
        if (report.Issues.Count == 0) { w.WriteLine("  No issues found."); return; }
        foreach (var group in report.Issues.GroupBy(i => i.Category).OrderBy(g => g.Key))
        {
            w.WriteLine($"  {group.Key} ({group.Count()})");
            foreach (var i in group.Take(15)) w.WriteLine($"    {(i.Blocking ? "!" : "-")} {(i.Row is { } r ? $"row {r}: " : "")}{i.Message}");
            if (group.Count() > 15) w.WriteLine($"    … and {group.Count() - 15} more");
        }
        w.WriteLine(report.HasBlocking ? "  Blocking problems: fix them before scheduling." : "  No blocking problems.");
    }
}
