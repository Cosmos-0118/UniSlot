using Spectre.Console;
using UniSlot.Application.Workflow;

namespace UniSlot.Cli;

/// <summary>The short result shown after a run in classic mode: one box with the numbers, then where the files went.</summary>
internal static class ClassicView
{
    public static void Done(IAnsiConsole c, SolveRun run)
    {
        var o = run.Outcome;
        bool rulesOk = o.Audit.IsStructurallyFeasible;
        double cleanPct = o.Clash.TotalStudents == 0 ? 100 : o.Clash.ClashFreeStudents * 100.0 / o.Clash.TotalStudents;

        var g = new Grid().AddColumn(new GridColumn().NoWrap()).AddColumn();
        void Row(string label, string value) => g.AddRow(new Markup($"[{Ui.MutedM}]{Ui.Esc(label)}[/]"), new Markup(value));
        string redColour = o.RedStudents == 0 || o.RedAtStructuralBound ? Ui.GoodM : Ui.WarnM;
        Row(Loc.T("card.red"), $"[bold {redColour}]{Ui.Number(o.RedStudents)}[/] [{Ui.MutedM}]{Ui.Esc(Loc.F("cli.card.minimum", o.Bounds.MinRedStudents))}[/]");
        Row(Loc.T("card.clean"), $"[bold]{Ui.Number(o.Clash.ClashFreeStudents)}[/] [{Ui.MutedM}]{Ui.Esc(Loc.F("cli.card.cleanHint", cleanPct.ToString("0.#", System.Globalization.CultureInfo.CurrentCulture)))}[/]");
        Row(Loc.T("card.sections"), Ui.Number(o.Sections.Count));
        Row(Loc.T("classic.clash"), Ui.Number(o.ClashWeight));
        Row(Loc.T("results.balance"), Ui.Esc(string.Join(" / ", o.Metrics.SectionsPerWeekday)));
        Row(Loc.T("card.rules"), rulesOk ? $"[{Ui.GoodM}]{Ui.Tick(c)} {Ui.Esc(Loc.T("rules.ok"))}[/]" : $"[{Ui.BadM}]{Ui.Cross(c)} {Ui.Esc(Loc.F("rules.bad", o.Audit.Structural.Count))}[/]");

        c.WriteLine();
        c.Write(new Panel(g)
        {
            Header = new PanelHeader($" {Ui.Esc(Loc.T("classic.result.title"))} "),
            Border = Ui.Box(c),
            BorderStyle = Ui.S(rulesOk ? Ui.Accent : Ui.Bad),
            Padding = new Padding(2, 0),
            Expand = false,
        });

        if (!rulesOk)
            foreach (var v in o.Audit.Structural.Take(10)) c.MarkupLine($"  [{Ui.BadM}]{Ui.Cross(c)}[/] {Ui.Esc(v.Detail)}");

        c.MarkupLine(ResultsView.Verdict(c, o));
        if (o.Validation.Warnings.Count > 0)
            c.MarkupLine($"  [{Ui.WarnM}]{Ui.Esc(Loc.F("classic.warn.input", o.Validation.Warnings.Count))}[/]");

        c.WriteLine();
        c.MarkupLine($"[bold {Ui.GoodM}]{Ui.Tick(c)} {Ui.Esc(Loc.T("classic.done"))}[/]");
        foreach (string f in run.Files) c.MarkupLine($"  [{Ui.MutedM}]{Ui.Bullet(c)}[/] {Ui.Esc(f)}");
        c.MarkupLine($"[{Ui.MutedM}]{Ui.Esc(Loc.T("results.reproduce"))}: {Ui.Esc(o.Search.Options.ReproToken)}{(o.Search.Options.IsReproducible ? "" : " " + Ui.Esc(Loc.T("cli.notReproducible")))}[/]");
    }
}
