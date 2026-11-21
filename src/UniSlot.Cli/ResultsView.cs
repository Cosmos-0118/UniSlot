using System.Globalization;
using Spectre.Console;
using Spectre.Console.Rendering;
using UniSlot.Application.Workflow;
using UniSlot.Domain;
using UniSlot.Solver;

namespace UniSlot.Cli;

/// <summary>Everything shown once a timetable exists: the results dashboard, schedule and clash tables, and the plain-text summary.</summary>
internal static class ResultsView
{
    public static void Dashboard(IAnsiConsole c, SolveRun run)
    {
        var o = run.Outcome;
        int width = Ui.Width(c);
        c.WriteLine();
        c.Write(new Rule($"[bold {Ui.AccentM}]{Ui.Esc(Loc.T("results.title"))}[/] [{Ui.MutedM}]{Ui.Sep(c)} {Ui.Esc(Loc.F("results.fileLine", Ui.Truncate(o.Source.FileName, 36), Ui.Number(o.Roster.Students.Count), Ui.Number(o.Roster.Courses.Count)))}[/]")
        { Style = Ui.S(Ui.Muted), Justification = Justify.Left });
        c.WriteLine();

        // ---- headline cards --------------------------------------------------------------------------------------------
        string redColour = o.RedStudents == 0 || o.RedAtStructuralBound ? Ui.GoodM : o.RedStudents <= o.Bounds.MinRedStudents * 1.25 + 1 ? Ui.WarnM : Ui.BadM;
        double cleanPct = o.Clash.TotalStudents == 0 ? 100 : o.Clash.ClashFreeStudents * 100.0 / o.Clash.TotalStudents;
        bool rulesOk = o.Audit.IsStructurallyFeasible;
        var cards = new[]
        {
            Ui.Card(c, Loc.T("card.red"), Ui.Number(o.RedStudents), redColour, Loc.F("cli.card.minimum", o.Bounds.MinRedStudents)),
            Ui.Card(c, Loc.T("card.clean"), Ui.Number(o.Clash.ClashFreeStudents), Ui.GoodM, Loc.F("cli.card.cleanHint", cleanPct.ToString("0.#", CultureInfo.CurrentCulture))),
            Ui.Card(c, Loc.T("card.sections"), Ui.Number(o.Sections.Count), Ui.AccentM, Loc.F("cli.card.sectionsHint", Ui.Number(o.Model.Problem.EdgeCount))),
            Ui.Card(c, Loc.T("card.rules"), $"{(rulesOk ? Ui.Tick(c) : Ui.Cross(c))} {(rulesOk ? Loc.T("rules.ok") : Loc.F("rules.bad", o.Audit.Structural.Count))}", rulesOk ? Ui.GoodM : Ui.BadM,
                Loc.F("cli.card.clashWeight", Ui.Number(o.ClashWeight))),
        };
        var grid = new Grid();
        int perRow = width >= 100 ? 4 : 2;
        int cardWidth = (width - (perRow - 1)) / perRow;
        for (int i = 0; i < perRow; i++) grid.AddColumn(new GridColumn { Width = cardWidth, Padding = new Padding(0, 0, i == perRow - 1 ? 0 : 1, 0) });
        for (int i = 0; i < cards.Length; i += perRow) grid.AddRow(cards.Skip(i).Take(perRow).Concat(Enumerable.Repeat<IRenderable>(new Text(""), Math.Max(0, i + perRow - cards.Length))).ToArray());
        c.Write(grid);

        // ---- verdict ---------------------------------------------------------------------------------------------------
        if (!rulesOk)
            foreach (var v in o.Audit.Structural.Take(10)) c.MarkupLine($"  [{Ui.BadM}]{Ui.Cross(c)}[/] {Ui.Esc(v.Detail)}");
        c.MarkupLine(Verdict(c, o));
        if (o.Proof is not null) c.MarkupLine($"  [{Ui.MutedM}]{Ui.Esc(Loc.F("results.bound", o.Proof.RedLowerBound))}[/]");
        c.WriteLine();

        // ---- sections per weekday --------------------------------------------------------------------------------------
        var perDay = o.Metrics.SectionsPerWeekday;
        var chart = new BarChart().Width(Math.Min(width - 8, 70)).CenterLabel().ShowValues();
        chart.WithMaxValue(Math.Max(1, perDay.Max()));
        for (int d = 0; d < perDay.Count; d++) chart.AddItem(Loc.T($"day.{d}"), perDay[d], perDay[d] == 0 ? Ui.Warn : Ui.Accent);
        c.Write(new Panel(chart)
        {
            Header = new PanelHeader($" {Ui.Esc(Loc.T("results.balance"))} "),
            Border = Ui.Box(c),
            BorderStyle = Ui.S(Ui.Muted),
            Padding = new Padding(2, 1),
            Expand = true,
        });

        // ---- insights and data notes -----------------------------------------------------------------------------------
        if (o.Bounds.Insights.Count > 0)
            c.Write(BulletPanel(c, Loc.T("results.insights"), o.Bounds.Insights.Select(InsightText), Ui.Accent, Ui.AccentM));
        if (o.Validation.Warnings.Count > 0)
        {
            var notes = o.Validation.Warnings.Take(8).Select(w => w.Message).ToList();
            if (o.Validation.Warnings.Count > 8) notes.Add($"… +{o.Validation.Warnings.Count - 8}");
            c.Write(BulletPanel(c, Loc.T("results.warnings"), notes, Ui.Warn, Ui.WarnM));
        }

        // ---- where it went ---------------------------------------------------------------------------------------------
        var info = new Grid().AddColumn(new GridColumn().NoWrap()).AddColumn();
        info.AddRow(new Markup($"[{Ui.MutedM}]{Ui.Esc(Loc.T("cli.saved"))}[/]"), new Markup($"[bold]{Ui.Esc(run.Folder)}[/]"));
        foreach (string f in run.Files)
        {
            long size = File.Exists(f) ? new FileInfo(f).Length : 0;
            info.AddRow(new Text(""), new Markup($"{Ui.Esc(Path.GetFileName(f))} [{Ui.MutedM}]{Ui.Esc(Ui.Size(size))}[/]"));
        }
        info.AddRow(new Markup($"[{Ui.MutedM}]{Ui.Esc(Loc.T("results.engine"))}[/]"), new Markup(Ui.Esc(o.Search.Engine + (o.Proof is null ? "" : " + " + o.Proof.Engine))));
        info.AddRow(new Markup($"[{Ui.MutedM}]{Ui.Esc(Loc.T("cli.search"))}[/]"),
            new Markup(Ui.Esc($"{o.Search.TotalMoves / 1e6:N1} M {Loc.T("cli.moves")} {Ui.Sep(c)} {Ui.Seconds(o.Search.Elapsed)}")));
        info.AddRow(new Markup($"[{Ui.MutedM}]{Ui.Esc(Loc.T("results.reproduce"))}[/]"),
            new Markup(Ui.Esc(o.Search.Options.ReproToken) + (o.Search.Options.IsReproducible ? "" : $" [{Ui.WarnM}]{Ui.Esc(Loc.T("cli.notReproducible"))}[/]")));
        info.AddRow(new Markup($"[{Ui.MutedM}]{Ui.Esc(Loc.T("cli.total"))}[/]"), new Markup(Ui.Esc(Ui.Seconds(run.Elapsed))));
        c.Write(new Panel(info)
        {
            Header = new PanelHeader($" {Ui.Esc(Loc.T("cli.output"))} "),
            Border = Ui.Box(c),
            BorderStyle = Ui.S(Ui.Muted),
            Padding = new Padding(2, 0),
            Expand = true,
        });
    }

    internal static string Verdict(IAnsiConsole c, SolveOutcome o)
    {
        if (o.RedProvenOptimal) return $"  [bold {Ui.GoodM}]{Ui.Tick(c)} {Ui.Esc(Loc.T("results.proven"))}[/] [{Ui.MutedM}]{Ui.Esc(Loc.T("cli.verdict.provenNote"))}[/]";
        if (o.RedAtStructuralBound) return $"  [bold {Ui.GoodM}]{Ui.Tick(c)} {Ui.Esc(Loc.T("cli.verdict.atBound"))}[/] [{Ui.MutedM}]{Ui.Esc(Loc.T("cli.verdict.atBoundNote"))}[/]";
        return $"  [bold {Ui.WarnM}]{Ui.Dot(c)} {Ui.Esc(Loc.T("results.notProven"))}[/] [{Ui.MutedM}]{Ui.Esc(Loc.F("cli.verdict.gapNote", o.Bounds.MinRedStudents))}[/]";
    }

    public static string InsightText(Insight i) => Loc.F($"insight.{i.Code}", [.. i.Args.Cast<object>()]);

    private static IRenderable BulletPanel(IAnsiConsole c, string title, IEnumerable<string> lines, Color border, string bulletColour)
    {
        var rows = lines.Select(l => (IRenderable)new Markup($"[{bulletColour}]{Ui.Bullet(c)}[/] {Ui.Esc(l)}")).ToList();
        return new Panel(new Rows(rows))
        {
            Header = new PanelHeader($" {Ui.Esc(title)} "),
            Border = Ui.Box(c),
            BorderStyle = Ui.S(border),
            Padding = new Padding(2, 0),
            Expand = true,
        };
    }

    // ---- tables ----------------------------------------------------------------------------------------------------------
    public static Table ScheduleTable(IAnsiConsole c, IEnumerable<ScheduleEntry> rows)
    {
        var list = rows.ToList();
        bool faculty = list.Any(e => FacultyOf(e).Length > 0);
        bool wide = Ui.Width(c) >= 100;
        int titleMax = Math.Max(16, Ui.Width(c) - 62 - (faculty ? 18 : 0));
        var t = new Table { Border = Ui.TableBox(c), BorderStyle = Ui.S(Ui.Muted), Expand = false };
        t.AddColumn(Loc.T("col.day"));
        t.AddColumn(Loc.T("col.course"));
        t.AddColumn(Loc.T("col.title"));
        t.AddColumn(new TableColumn(Loc.T("col.section")).RightAligned());
        t.AddColumn(new TableColumn(Loc.T("col.students")).RightAligned());
        if (wide) t.AddColumn(Loc.T("col.programs"));
        if (faculty) t.AddColumn(Loc.T("col.faculty"));
        int lastDay = -1;
        foreach (var e in list)
        {
            string day = (int)e.Day == lastDay ? "" : Loc.T($"day.{(int)e.Day}");
            lastDay = (int)e.Day;
            var cells = new List<IRenderable>
            {
                new Markup($"[{Ui.AccentM}]{Ui.Esc(day)}[/]"),
                new Markup($"[bold]{Ui.Esc(e.CourseCode)}[/]"),
                new Markup(Ui.Esc(Ui.Truncate(e.CourseTitle, titleMax))),
                new Markup(e.SectionNumber.ToString(CultureInfo.CurrentCulture)),
                new Markup(Ui.Number(e.Enrollment)),
            };
            if (wide) cells.Add(new Markup($"[{Ui.MutedM}]{Ui.Esc(Ui.Truncate(e.Programs, 28))}[/]"));
            if (faculty) cells.Add(new Markup(Ui.Esc(Ui.Truncate(FacultyOf(e), 20))));
            t.AddRow(cells);
        }
        return t;
    }

    public static string FacultyOf(ScheduleEntry e) =>
        e.Faculty is { } f && !f.StartsWith("Planning:", StringComparison.Ordinal) ? f : "";

    public static Table ClashTable(IAnsiConsole c, IEnumerable<StudentClash> rows)
    {
        bool wide = Ui.Width(c) >= 100;
        var t = new Table { Border = Ui.TableBox(c), BorderStyle = Ui.S(Ui.Muted), Expand = false };
        t.AddColumn(Loc.T("col.register"));
        t.AddColumn(Loc.T("col.student"));
        if (wide) t.AddColumn(Loc.T("col.program"));
        t.AddColumn(Loc.T("col.clash"));
        t.AddColumn(Loc.T("col.day"));
        foreach (var s in rows)
        {
            var cells = new List<IRenderable>
            {
                new Markup(Ui.Esc(s.RegisterNumber)),
                new Markup($"[bold]{Ui.Esc(Ui.Truncate(s.Name, 26))}[/]"),
            };
            if (wide) cells.Add(new Markup($"[{Ui.MutedM}]{Ui.Esc(ProgramNames.Abbreviate(s.Program))}[/]"));
            cells.Add(new Markup($"[{Ui.BadM}]{Ui.Esc(string.Join("\n", s.Pairs.Select(p => $"{p.A} {Ui.Arrow(c)} {p.B}")))}[/]"));
            cells.Add(new Markup(Ui.Esc(string.Join(", ", s.Days.Select(d => Loc.T($"day.{(int)d}"))))));
            t.AddRow(cells);
        }
        return t;
    }

    public static IEnumerable<ScheduleEntry> FilterSchedule(IEnumerable<ScheduleEntry> all, int day, string query)
    {
        query = query.Trim();
        return all.Where(e => (day < 0 || (int)e.Day == day)
            && (query.Length == 0 || e.CourseCode.Contains(query, StringComparison.OrdinalIgnoreCase) || e.CourseTitle.Contains(query, StringComparison.OrdinalIgnoreCase)));
    }

    public static IEnumerable<StudentClash> FilterClashes(IEnumerable<StudentClash> all, string query)
    {
        query = query.Trim();
        return all.Where(s => s.Status == ClashStatus.Red
            && (query.Length == 0 || s.RegisterNumber.Contains(query, StringComparison.OrdinalIgnoreCase) || s.Name.Contains(query, StringComparison.OrdinalIgnoreCase)
                || s.Pairs.Any(p => p.A.Contains(query, StringComparison.OrdinalIgnoreCase) || p.B.Contains(query, StringComparison.OrdinalIgnoreCase))));
    }

    // ---- plain text (redirected output, --quiet): stable English, no markup ---------------------------------------------
    public static void Plain(TextWriter w, SolveRun run, bool quiet)
    {
        var o = run.Outcome;
        var inv = CultureInfo.InvariantCulture;
        w.WriteLine($"UniSlot {Ui.Version()}  ·  {o.Source.FileName}");
        w.WriteLine($"  {o.Roster.Students.Count:N0} students · {o.Roster.Courses.Count:N0} courses · {o.Sections.Count:N0} sections · {o.Model.Problem.EdgeCount:N0} conflict pairs");
        w.WriteLine($"  RED students   {o.RedStudents}   (structural minimum {o.Bounds.MinRedStudents}{(o.Proof is null ? "" : $", proven bound {o.Proof.RedLowerBound}")})");
        w.WriteLine($"  Clash weight   {o.ClashWeight}   (structural minimum {o.Bounds.MinClashWeight})");
        w.WriteLine($"  Balance L1     {o.Metrics.BalanceL1.ToString("0.0", inv)}   ·  sections per weekday {string.Join("/", o.Metrics.SectionsPerWeekday)}");
        w.WriteLine($"  Hard rules     {(o.Audit.IsStructurallyFeasible ? "all satisfied" : $"{o.Audit.Structural.Count} VIOLATION(S)")}");
        foreach (var v in o.Audit.Structural.Take(10)) w.WriteLine($"    ! {v.Detail}");
        w.WriteLine($"  Optimality     {(o.RedProvenOptimal ? "RED proven optimal" : "not proven")}");
        w.WriteLine($"  Search         {o.Search.TotalMoves / 1e6:N1} M moves in {o.Search.Elapsed.TotalSeconds.ToString("0.00", inv)} s · repro {o.Search.Options.ReproToken}{(o.Search.Options.IsReproducible ? "" : " (time-limited, not reproducible)")}");
        if (!quiet)
        {
            foreach (var wn in o.Validation.Warnings.Take(5)) w.WriteLine($"  warning: {wn.Message}");
            if (o.Validation.Warnings.Count > 5) w.WriteLine($"  … and {o.Validation.Warnings.Count - 5} more warning(s)");
        }
        w.WriteLine($"  Done in {run.Elapsed.TotalSeconds.ToString("0.00", inv)} s → {run.Folder}");
    }
}
