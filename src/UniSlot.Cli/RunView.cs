using Spectre.Console;
using Spectre.Console.Rendering;

namespace UniSlot.Cli;

/// <summary>The live "building your timetable" screen: stage checklist, progress bar, best-so-far and elapsed time.</summary>
internal static class RunView
{
    /// <summary>Runs <paramref name="work"/> while a live dashboard polls <paramref name="sink"/>. Exceptions from the work surface here.</summary>
    public static async Task<T> ShowAsync<T>(IAnsiConsole c, ProgressSink sink, bool withProof, string fileName, Task<T> work)
    {
        await c.Live(Render(c, sink.Snapshot(), withProof, fileName, 0))
            .AutoClear(false)
            .Overflow(VerticalOverflow.Ellipsis)
            .StartAsync(async ctx =>
            {
                int tick = 0;
                while (!work.IsCompleted)
                {
                    ctx.UpdateTarget(Render(c, sink.Snapshot(), withProof, fileName, tick++));
                    await Task.WhenAny(work, Task.Delay(100)).ConfigureAwait(false);
                }
                ctx.UpdateTarget(Render(c, sink.Snapshot(), withProof, fileName, tick));
            }).ConfigureAwait(false);
        return await work.ConfigureAwait(false);
    }

    public static IRenderable Render(IAnsiConsole c, ProgressSnapshot s, bool withProof, string fileName, int tick)
    {
        var spin = Ui.Spinner(c);
        var rows = new List<IRenderable>();
        var steps = Enumerable.Range(0, ProgressSink.StepCount).Where(r => withProof || r != ProgressSink.Proving).ToList();

        var grid = new Grid().AddColumn(new GridColumn().NoWrap()).AddColumn(new GridColumn().NoWrap()).AddColumn(new GridColumn().NoWrap().RightAligned());
        foreach (int r in steps)
        {
            bool done = s.Finished || r < s.Rank;
            bool active = !done && r == s.Rank;
            string glyph = done ? $"[{Ui.GoodM}]{Ui.Tick(c)}[/]" : active ? $"[{Ui.AccentM}]{spin[tick % spin.Length]}[/]" : $"[{Ui.MutedM}]{Ui.Dot(c)}[/]";
            string label = Ui.Esc(StageLabel(r));
            string text = done ? label : active ? $"[bold]{label}[/]" : $"[{Ui.MutedM}]{label}[/]";
            string time = "";
            if (s.Entered[r] is { } start)
            {
                int following = NextShown(steps, r);
                TimeSpan end = following != r && s.Entered[following] is { } next ? next : s.Elapsed;
                if (done || active) time = Ui.Seconds(end - start);
            }
            grid.AddRow(new Markup(glyph), new Markup(text), new Markup($"[{Ui.MutedM}]{time}[/]"));
        }
        rows.Add(grid);
        rows.Add(new Text(" "));
        rows.Add(new Markup(Bar(c, s, tick)));
        rows.Add(new Text(" "));
        rows.Add(new Markup(s.BestRed is { } red
            ? $"[{Ui.AccentM}]{Ui.Bullet(c)}[/] {Ui.Esc(Loc.F("live.best", red, s.BestClash ?? 0))}"
            : $"[{Ui.MutedM}]{Ui.Bullet(c)} {Ui.Esc(Loc.T("cli.run.noBest"))}[/]"));
        rows.Add(new Markup($"[{Ui.MutedM}]{Ui.Esc(Loc.T("cli.run.elapsed"))} {Ui.Clock(s.Elapsed)}{(s.Finished ? "" : $"   {Ui.Sep(c)}   {Ui.Esc(Loc.T("cli.run.cancelHint"))}")}[/]"));

        return new Panel(new Rows(rows))
        {
            Header = new PanelHeader($" {Ui.Esc(Loc.T("solve.running.title"))} {Ui.Sep(c)} {Ui.Esc(Ui.Truncate(fileName, 36))} "),
            Border = Ui.Box(c),
            BorderStyle = Ui.S(Ui.Accent),
            Padding = new Padding(2, 1),
            Expand = true,
        };
    }

    private static int NextShown(List<int> steps, int r)
    {
        int i = steps.IndexOf(r);
        return i >= 0 && i + 1 < steps.Count ? steps[i + 1] : r;
    }

    public static string StageLabel(int rank) => rank switch
    {
        ProgressSink.Reading => Loc.T("stage.reading"),
        ProgressSink.Planning => Loc.T("stage.planning"),
        ProgressSink.Bounds => Loc.T("stage.bounds"),
        ProgressSink.Searching => Loc.T("stage.searching"),
        ProgressSink.Proving => Loc.T("stage.proving"),
        ProgressSink.Auditing => Loc.T("stage.auditing"),
        _ => Loc.T("cli.stage.saving"),
    };

    /// <summary>A determinate bar, or a sliding marker while the exact proof runs (it has no known end).</summary>
    private static string Bar(IAnsiConsole c, ProgressSnapshot s, int tick)
    {
        int width = Math.Clamp(Ui.Width(c) - 24, 12, 64);
        bool unicode = c.Profile.Capabilities.Unicode;
        string full = unicode ? "█" : "#", empty = unicode ? "░" : "-";
        if (s.Rank == ProgressSink.Proving && !s.Finished)
        {
            int marker = 6, span = Math.Max(1, width - marker);
            int pos = tick % (2 * span);
            if (pos > span) pos = 2 * span - pos;
            return $"[{Ui.AccentM}]{string.Concat(Enumerable.Repeat(empty, pos))}[/][bold {Ui.AccentM}]{string.Concat(Enumerable.Repeat(full, marker))}[/][{Ui.MutedM}]{string.Concat(Enumerable.Repeat(empty, span - pos))}[/]";
        }
        double f = s.Finished ? 1 : Math.Clamp(s.Fraction, 0, 1);
        int filled = (int)Math.Round(f * width);
        return $"[{Ui.AccentM}]{string.Concat(Enumerable.Repeat(full, filled))}[/][{Ui.MutedM}]{string.Concat(Enumerable.Repeat(empty, width - filled))}[/]  [bold]{f * 100,3:0}%[/]";
    }
}
