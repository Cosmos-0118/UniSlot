using Spectre.Console;
using Spectre.Console.Rendering;
using UniSlot.Application.Workflow;
using UniSlot.Domain;

namespace UniSlot.Cli;

/// <summary>Paged, searchable views of the finished schedule and the students who still have a clash.</summary>
internal static class Browser
{
    private enum Nav { Next, Previous, Filter, Back }

    private static int PageSize(IAnsiConsole c) => Math.Clamp(Ui.Height() - 16, 5, 40);

    public static void Schedule(IAnsiConsole c, SolveOutcome o)
    {
        int day = -1;
        string query = "";
        int page = 0;
        int days = o.Metrics.SectionsPerWeekday.Count;
        while (true)
        {
            var rows = ResultsView.FilterSchedule(o.Schedule, day, query).ToList();
            if (!Page(c, Loc.T("schedule.title"), FilterText(day, query), Loc.F("schedule.count", Ui.Number(rows.Count)), rows.Count, ref page,
                    (skip, take) => ResultsView.ScheduleTable(c, rows.Skip(skip).Take(take)))) return;

            // Page() returned because the user chose "change filter".
            var dayChoice = c.Prompt(new SelectionPrompt<int>()
                .Title($"[bold]{Ui.Esc(Loc.T("cli.filter.day"))}[/]")
                .HighlightStyle(Ui.S(Ui.Accent, true)).WrapAround()
                .AddChoices(Enumerable.Range(-1, days + 1))
                .UseConverter(d => d < 0 ? Loc.T("schedule.all") : Loc.T($"day.{d}")));
            day = dayChoice;
            query = c.Prompt(new TextPrompt<string>($"[bold]{Ui.Esc(Loc.T("schedule.search"))}[/] [{Ui.MutedM}]({Ui.Esc(Loc.T("cli.filter.hint"))})[/]").AllowEmpty().PromptStyle(Ui.S(Ui.Accent))).Trim();
            page = 0;
        }
    }

    public static void Clashes(IAnsiConsole c, SolveOutcome o)
    {
        string query = "";
        int page = 0;
        while (true)
        {
            var rows = ResultsView.FilterClashes(o.Clash.Students, query).ToList();
            if (o.RedStudents == 0)
            {
                Ui.Clear(c);
                Ui.Header(c, Loc.T("clashes.title"));
                c.MarkupLine($"[{Ui.GoodM}]{Ui.Tick(c)} {Ui.Esc(Loc.T("clashes.none"))}[/]");
                Pause(c);
                return;
            }
            if (!Page(c, Loc.T("clashes.title"), query.Length > 0 ? $"“{query}”" : null, Loc.F("clashes.count", Ui.Number(rows.Count)), rows.Count, ref page,
                    (skip, take) => ResultsView.ClashTable(c, rows.Skip(skip).Take(take)))) return;

            query = c.Prompt(new TextPrompt<string>($"[bold]{Ui.Esc(Loc.T("cli.clashes.search"))}[/] [{Ui.MutedM}]({Ui.Esc(Loc.T("cli.filter.hint"))})[/]").AllowEmpty().PromptStyle(Ui.S(Ui.Accent))).Trim();
            page = 0;
        }
    }

    private static string? FilterText(int day, string query)
    {
        var parts = new List<string>();
        if (day >= 0) parts.Add(Loc.T($"day.{day}"));
        if (query.Length > 0) parts.Add($"“{query}”");
        return parts.Count == 0 ? null : string.Join(" · ", parts);
    }

    /// <summary>
    /// Shows one page and handles next/previous itself. Returns true when the user asked to change the filter, false to leave.
    /// </summary>
    private static bool Page(IAnsiConsole c, string title, string? filter, string count, int total, ref int page, Func<int, int, IRenderable> table)
    {
        int size = PageSize(c);
        while (true)
        {
            int pages = Math.Max(1, (total + size - 1) / size);
            page = Math.Clamp(page, 0, pages - 1);
            Ui.Clear(c);
            Ui.Header(c, title, filter);
            if (total == 0) c.MarkupLine($"[{Ui.WarnM}]{Ui.Esc(Loc.T("cli.noMatches"))}[/]");
            else c.Write(table(page * size, size));
            c.MarkupLine($"[{Ui.MutedM}]{Ui.Esc(count)}  {Ui.Sep(c)}  {Ui.Esc(Loc.F("cli.page", page + 1, pages))}[/]");
            c.WriteLine();

            var choices = new List<Nav>();
            if (page < pages - 1) choices.Add(Nav.Next);
            if (page > 0) choices.Add(Nav.Previous);
            choices.Add(Nav.Filter);
            choices.Add(Nav.Back);
            var nav = c.Prompt(new SelectionPrompt<Nav>()
                .HighlightStyle(Ui.S(Ui.Accent, true)).WrapAround()
                .AddChoices(choices)
                .UseConverter(n => n switch
                {
                    Nav.Next => Loc.T("cli.page.next"),
                    Nav.Previous => Loc.T("cli.page.prev"),
                    Nav.Filter => Loc.T("cli.page.filter"),
                    _ => $"[{Ui.MutedM}]{Ui.Esc(Loc.T("solve.back"))}[/]",
                }));
            switch (nav)
            {
                case Nav.Next: page++; break;
                case Nav.Previous: page--; break;
                case Nav.Filter: return true;
                default: return false;
            }
        }
    }

    public static void Pause(IAnsiConsole c)
    {
        if (Ui.Classic) return;
        c.MarkupLine($"\n[{Ui.MutedM}]{Ui.Esc(Loc.T("cli.pressKey"))}[/]");
        try { Console.ReadKey(true); }
        catch (InvalidOperationException) { /* no console to wait on */ }
    }
}
