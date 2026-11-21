using System.Text;
using Spectre.Console;
using UniSlot.Application.Editing;
using UniSlot.Application.Importing;
using UniSlot.Application.Workflow;
using UniSlot.Domain;

namespace UniSlot.Cli;

internal static class Program
{
    private const int ExitOk = 0, ExitFailure = 1, ExitRejected = 2, ExitInfeasible = 3, ExitUsage = 64;

    private static CancellationTokenSource? _runToken;

    /// <summary>While a run is active Ctrl+C cancels it instead of killing the process, so the screen is restored cleanly.</summary>
    internal static void SetRunToken(CancellationTokenSource? cts) => Volatile.Write(ref _runToken, cts);

    private static async Task<int> Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        try { Console.InputEncoding = Encoding.UTF8; }
        catch (IOException) { /* no console attached */ }

        Console.CancelKeyPress += (_, e) =>
        {
            var cts = Volatile.Read(ref _runToken);
            if (cts is not null)
            {
                e.Cancel = true;
                try { cts.Cancel(); }
                catch (ObjectDisposedException) { /* the run already ended */ }
            }
            else
            {
                try { AnsiConsole.Cursor.Show(); }
                catch (IOException) { /* nothing to restore */ }
            }
        };

        var c = AnsiConsole.Console;
        return await RunAsync(args, c, CliSettings.Load(), Ui.IsInteractive(c));
    }

    /// <summary>Everything <c>Main</c> does after the console is set up; separate so tests can drive it with a scripted console.</summary>
    internal static async Task<int> RunAsync(string[] args, IAnsiConsole c, CliSettings prefs, bool interactive)
    {
        Ui.Classic = false;
        Loc.Set(Environment.GetEnvironmentVariable("UNISLOT_LANG") ?? prefs.Language);

        if (args.Length > 0 && args[0] is "-h" or "--help" or "help") { PrintHelp(); return ExitOk; }
        if (args.Length > 0 && args[0] is "-v" or "-V" or "--version" or "version") { Console.WriteLine($"unislot {Ui.Version()}"); return ExitOk; }

        // The full-screen application: `unislot --tui` (or `unislot tui`).
        if (args.Contains("--tui") || (args.Length > 0 && args[0] == "tui"))
        {
            if (!interactive) { Console.Error.WriteLine("--tui needs an interactive terminal."); return ExitUsage; }
            return await new App(c, prefs).RunAsync(startWithWizard: false);
        }

        if (args.Length == 0)
        {
            if (!interactive) { PrintHelp(); return ExitUsage; }
            return await new Classic(c, prefs).MenuAsync();
        }

        if (args[0] == "doctor") return await Doctor.RunAsync(c, prefs);
        if (EditOptions.Modes.Contains(args[0])) return await MaintenanceCommand(c, prefs, args, interactive);

        // Like the original tool, `solve` is the default command: `unislot -i data.xlsx -o out -y` works as it did.
        if (args[0] != "solve")
        {
            if (!args[0].StartsWith('-'))
            {
                Console.Error.WriteLine($"Unknown command '{args[0]}'. Try 'unislot --help'.");
                return ExitUsage;
            }
            args = ["solve", .. args];
        }

        Options o;
        try { o = Options.Parse(args[1..]); }
        catch (ArgumentException ex) { Console.Error.WriteLine(ex.Message); return ExitUsage; }
        if (o.Lang is not null && !Loc.Set(o.Lang))
        {
            Console.Error.WriteLine($"Unknown language '{o.Lang}'. Available: {string.Join(", ", Loc.Languages.Select(l => l.Code))}.");
            return ExitUsage;
        }

        NoteIgnored(o.Ignored);

        // Missing the workbook or the output folder on a terminal (and no -y): ask, as the original tool did.
        bool ask = interactive && !o.Quiet && !o.Yes && (o.Input.Length == 0 || o.Output is null);
        if (ask)
        {
            if (o.Input.Length > 0)
            {
                try { o.RequireInput(); }
                catch (ArgumentException ex) { Console.Error.WriteLine(ex.Message); return ExitUsage; }
            }
            using var cts = new CancellationTokenSource();
            return await new Classic(c, prefs).SolveAsync(o);
        }

        try { o.RequireInput(); }
        catch (ArgumentException ex) { Console.Error.WriteLine(ex.Message); return ExitUsage; }

        return await SolveCommand(c, o, rich: interactive && !o.Quiet);
    }

    private static async Task<int> MaintenanceCommand(IAnsiConsole c, CliSettings prefs, string[] args, bool interactive)
    {
        EditOptions o;
        try
        {
            o = EditOptions.Parse(args[0], args[1..]);
            if (o.Lang is not null && !Loc.Set(o.Lang)) throw new ArgumentException($"Unknown language '{o.Lang}'. Available: {string.Join(", ", Loc.Languages.Select(l => l.Code))}.");
        }
        catch (ArgumentException ex) { Console.Error.WriteLine(ex.Message); return ExitUsage; }
        NoteIgnored(o.Ignored);

        // Missing options on a terminal (and no -y): ask for them, as the original tool did.
        if (!o.IsComplete && interactive && !o.Yes && !o.Quiet && Classic.FromMode(o.Mode) is { } choice)
            return await new Classic(c, prefs).RunAsync(choice, new Options(), o);

        try { o.Require(); }
        catch (ArgumentException ex) { Console.Error.WriteLine(ex.Message); return ExitUsage; }

        bool rich = interactive && !o.Quiet;
        using var cts = new CancellationTokenSource();
        SetRunToken(cts);
        try { return await Maintenance.RunScripted(c, o, rich, cts.Token); }
        catch (Exception ex) when (Report(rich ? c : null, ex, out int code)) { return code; }
        finally { SetRunToken(null); }
    }

    private static void NoteIgnored(string[] ignored)
    {
        if (ignored.Length > 0)
            Console.Error.WriteLine($"Note: {string.Join(", ", ignored.Distinct())} {(ignored.Distinct().Count() == 1 ? "has" : "have")} no effect in this version and {(ignored.Distinct().Count() == 1 ? "was" : "were")} ignored.");
    }

    /// <summary>The scripted command. It ignores stored preferences so the same flags always mean the same run.</summary>
    private static async Task<int> SolveCommand(IAnsiConsole c, Options o, bool rich)
    {
        var settings = SolveRunner.BuildSettings(new CliSettings(), o);
        var request = new SolveRequest(o.Input, o.Output ?? "unislot-out", settings, o.Institution);
        using var cts = new CancellationTokenSource();
        SetRunToken(cts);
        try
        {
            SolveRun run;
            if (rich)
            {
                Ui.Banner(c);
                var sink = new ProgressSink();
                run = await RunView.ShowAsync(c, sink, settings.Prove, Path.GetFileName(o.Input), Task.Run(() => SolveRunner.RunAsync(request, sink, cts.Token)));
                ResultsView.Dashboard(c, run);
            }
            else
            {
                run = await SolveRunner.RunAsync(request, null, cts.Token);
                ResultsView.Plain(Console.Out, run, o.Quiet);
            }
            ShowTables(c, o, run.Outcome);
            return run.Outcome.Audit.IsStructurallyFeasible ? ExitOk : ExitInfeasible;
        }
        catch (Exception ex) when (Report(rich ? c : null, ex, out int code))
        {
            return code;
        }
        finally { SetRunToken(null); }
    }

    private static void ShowTables(IAnsiConsole c, Options o, SolveOutcome outcome) => ShowTables(c, o.Show, o.Limit, outcome);

    internal static void ShowTables(IAnsiConsole c, string[] show, int limit, SolveOutcome outcome)
    {
        var o = (Show: show, Limit: limit);
        if (o.Show.Contains("schedule"))
        {
            c.Write(new Rule(Loc.T("schedule.title")) { Justification = Justify.Left });
            c.Write(ResultsView.ScheduleTable(c, outcome.Schedule.Take(o.Limit)));
            if (outcome.Schedule.Count > o.Limit) c.WriteLine($"… +{outcome.Schedule.Count - o.Limit}");
        }
        if (o.Show.Contains("clashes"))
        {
            var red = ResultsView.FilterClashes(outcome.Clash.Students, "").ToList();
            c.Write(new Rule(Loc.T("clashes.title")) { Justification = Justify.Left });
            c.Write(ResultsView.ClashTable(c, red.Take(o.Limit)));
            if (red.Count > o.Limit) c.WriteLine($"… +{red.Count - o.Limit}");
        }
    }

    // ---- error reporting ---------------------------------------------------------------------------------------------------
    /// <summary>Exception filter for interactive screens: shows the problem and returns true when it is a known failure.</summary>
    internal static bool Report(IAnsiConsole c, Exception ex) => Report(c, ex, out _);

    /// <summary>Shows a known failure and gives its exit code; unknown exceptions are not handled (false).</summary>
    internal static bool Report(IAnsiConsole? rich, Exception ex, out int code)
    {
        code = ExitFailure;
        switch (ex)
        {
            case OperationCanceledException:
                if (rich is not null) rich.MarkupLine($"\n[{Ui.WarnM}]{Ui.Esc(Loc.T("solve.cancelled"))}[/]");
                else Console.Error.WriteLine("\nCancelled.");
                return true;
            case InputRejectedException rejected:
                code = ExitRejected;
                if (rich is not null) ErrorPanel(rich, Loc.T("solve.rejected"), RejectedLines(rejected.Report));
                else PrintRejected(rejected.Report);
                return true;
            case EditException edit:
                if (rich is not null) ErrorPanel(rich, Loc.T("solve.failed"), [edit.Message]);
                else Console.Error.WriteLine(edit.Message);
                return true;
            case ConsistencyException consistency:
                if (rich is not null) ErrorPanel(rich, Loc.T("solve.failed"), [consistency.Message]);
                else Console.Error.WriteLine($"Internal consistency check failed: {consistency.Message}");
                return true;
            case InvalidDataException:
                if (rich is not null) ErrorPanel(rich, Loc.T("solve.failed"), [ex.Message]);
                else Console.Error.WriteLine(ex.Message);
                return true;
            case IOException or UnauthorizedAccessException:
                if (rich is not null) ErrorPanel(rich, Loc.T("solve.failed"), [ex.Message]);
                else Console.Error.WriteLine($"Could not read or write files: {ex.Message}");
                return true;
            default:
                return false;
        }
    }

    private static IEnumerable<string> RejectedLines(ValidationReport report)
    {
        foreach (var e in report.Errors.Take(12)) yield return e.Row is { } r ? $"{r}: {e.Message}" : e.Message;
        if (report.Errors.Count > 12) yield return $"… +{report.Errors.Count - 12}";
    }

    private static void ErrorPanel(IAnsiConsole c, string title, IEnumerable<string> lines)
    {
        c.WriteLine();
        c.Write(new Panel(new Rows(lines.Select(l => (Spectre.Console.Rendering.IRenderable)new Markup($"[{Ui.BadM}]{Ui.Cross(c)}[/] {Ui.Esc(l)}"))))
        {
            Header = new PanelHeader($" {Ui.Esc(title)} "),
            Border = Ui.Box(c),
            BorderStyle = Ui.S(Ui.Bad),
            Padding = new Padding(2, 0),
            Expand = true,
        });
    }

    private static void PrintRejected(ValidationReport report)
    {
        Console.Error.WriteLine($"The workbook was rejected: {report.Errors.Count} problem(s) in {report.TotalRows} rows.");
        foreach (var e in report.Errors.Take(15))
            Console.Error.WriteLine($"  {(e.Row is { } r ? $"row {r}: " : "")}{e.Message}");
        if (report.Errors.Count > 15) Console.Error.WriteLine($"  … and {report.Errors.Count - 15} more");
    }

    private static void PrintHelp() => Console.WriteLine("""
        UniSlot — evening timetable optimiser

        Usage:
          unislot                          Choose what to do from a menu, then answer a few questions
          unislot <command> [options]      Run one command; anything missing is asked for (add -y to never ask)
          unislot --tui                    The full-screen application (menus, live results browser, settings)

        Commands:
          solve        Create schedule (the default: `unislot -i data.xlsx -o out -y` works)
          rectify      Rectify schedule             --previous <folder> --rectified <xlsx> -o <folder>
          late         Add late enrollments         --previous <folder> --late <xlsx> -o <folder> [--on-full new-section|fit|park] [--on-clash accept|park-student]
          fix-course   Fix wrong student course     --previous <folder> --register <no> --from <code> --to <code> [--to-title <text>] -o <folder>
          drop-course  Remove student from a course --previous <folder> --register <no> --course <code> -o <folder>
          revert       Undo a wrong delete or fix   --edited <folder> --previous <folder> (--register <list> | --course <list> | --all) -o <folder>
          name-list    Export name list             --folder <folder> [-o <dir>]
          filter       Filter schedule              -i <folder> -c <codes> -o <dir>      (--folder is the same as -i)
          issues       Find enrollment issues       -i <enrollment.xlsx>
          doctor       Check that the search engine and the exact CP-SAT stage work here

        Solve options:
          -i, --input <file>        Enrollment workbook (first sheet)
          -o, --output <folder>     Output folder (default ./unislot-out)
          -y, --yes                 Never ask; use defaults for anything not given
          --seed <n|token>          Seed, or a reproduction token printed by an earlier run (seed/chains/moves)
          --saturday | --no-saturday    Allow mathematics courses on Saturday (default: no)
          --saturday-codes <list>   Extra course codes allowed on Saturday (comma separated)
          --prove                   Run the exact CP-SAT stage after the search
          --prove-time <seconds>    Time budget for the exact stage (default 60)
          --preset <name>           quick | standard | thorough   (6M | 30M | 150M moves per chain; default standard)
          --moves <n>               Moves per chain (overrides --preset)
          --chains <n>              Independent chains (default 12)
          --workers <n>             Worker threads (default: all logical cores; same as --threads)
          --time-limit <seconds>    Pace by wall-clock instead of moves (not reproducible; same as --time)
          --institution <name>      Name shown in workbook headers
          --show <list>             Also print tables: schedule, clashes (comma separated)
          --limit <n>               Rows per printed table (default 40)
          --lang <code>             Interface language: en, hi, ta, es, fr, de (default: saved setting)
          --verify                  Cross-check incremental scores against full recomputation while searching
          -q, --quiet               Plain, less output

        Accepted for compatibility and ignored: --portfolio, --absolute-gap, --prove-plateau, --prove-strategy, --nomenclature, --baseline.
        Scripted runs ignore saved preferences. Output is plain text when redirected or with --quiet.
        Exit codes: 0 ok · 1 failure or cancelled · 2 workbook rejected · 3 hard-rule violation · 64 usage error
        """);
}
