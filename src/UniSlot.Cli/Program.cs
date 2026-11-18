using System.Diagnostics;
using System.Globalization;
using UniSlot.Application.Importing;
using UniSlot.Application.Workflow;
using UniSlot.Domain;
using UniSlot.Infrastructure;
using UniSlot.Infrastructure.Export;
using UniSlot.Solver;

namespace UniSlot.Cli;

internal static class Program
{
    private const int ExitOk = 0, ExitFailure = 1, ExitRejected = 2, ExitInfeasible = 3, ExitUsage = 64;

    private static async Task<int> Main(string[] args)
    {
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        if (args.Length == 0 || args[0] is "-h" or "--help" or "help") { PrintHelp(); return args.Length == 0 ? ExitUsage : ExitOk; }
        if (args[0] is "-v" or "--version" or "version") { Console.WriteLine($"unislot {Version()}"); return ExitOk; }
        if (args[0] != "solve") { Console.Error.WriteLine($"Unknown command '{args[0]}'. Try 'unislot --help'."); return ExitUsage; }

        Options o;
        try { o = Options.Parse(args[1..]); }
        catch (ArgumentException ex) { Console.Error.WriteLine(ex.Message); return ExitUsage; }

        using var cts = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) => { e.Cancel = true; cts.Cancel(); };

        try { return await SolveAsync(o, cts.Token); }
        catch (OperationCanceledException) { Console.Error.WriteLine("\nCancelled."); return ExitFailure; }
        catch (InputRejectedException ex) { PrintRejected(ex.Report); return ExitRejected; }
        catch (Exception ex) when (ex is IOException or InvalidDataException or UnauthorizedAccessException)
        {
            Console.Error.WriteLine($"Could not read or write files: {ex.Message}");
            return ExitFailure;
        }
    }

    private static async Task<int> SolveAsync(Options o, CancellationToken ct)
    {
        var input = await XlsxEnrollmentSource.ReadAsync(o.Input, ct);
        IOptimalityProver? prover = null;
        if (o.Prove) prover = UniSlot.Proof.CpSatProver.Create();

        var workflow = new SolveWorkflow(new AnnealingEngine(), prover);
        var settings = new SolveSettings
        {
            Policy = new SchedulePolicy { AllowSaturdayForMaths = o.Saturday, SaturdayExtraCourses = SchedulePolicy.NormalizeCodes(o.SaturdayCodes) },
            Search = new SearchOptions
            {
                Seed = o.Seed, Chains = o.Chains, MovesPerChain = o.Moves, TimeLimit = o.TimeLimit, MaxThreads = o.Threads, VerifyEvery = o.Verify ? 1 << 20 : 0,
            },
            Prove = o.Prove,
            ProofTimeLimit = o.ProveTime,
        };

        bool live = !Console.IsOutputRedirected && !o.Quiet;
        var progress = new Progress<SolveProgress>(p =>
        {
            if (!live) return;
            string best = p.BestRed is { } r ? $"RED {r}" + (p.BestClash is { } c ? $" · clash {c}" : "") : "";
            Console.Write($"\r  {p.Stage,-10} {p.Fraction * 100,5:0}%  {best,-28}");
        });

        var clock = Stopwatch.StartNew();
        var outcome = await workflow.RunAsync(input, settings, progress, ct);
        if (live) Console.Write("\r" + new string(' ', 70) + "\r");

        var files = await OutputWriter.WriteAsync(outcome, o.Output, new ExportOptions { Institution = o.Institution }, ct);
        clock.Stop();
        PrintSummary(outcome, files, clock.Elapsed, o.Quiet);
        return outcome.Audit.IsStructurallyFeasible ? ExitOk : ExitInfeasible;
    }

    private static void PrintSummary(SolveOutcome o, IReadOnlyList<string> files, TimeSpan total, bool quiet)
    {
        var inv = CultureInfo.InvariantCulture;
        Console.WriteLine($"UniSlot {Version()}  ·  {o.Source.FileName}");
        Console.WriteLine($"  {o.Roster.Students.Count:N0} students · {o.Roster.Courses.Count:N0} courses · {o.Sections.Count:N0} sections · {o.Problem().EdgeCount:N0} conflict pairs");
        Console.WriteLine($"  RED students   {o.RedStudents}   (structural minimum {o.Bounds.MinRedStudents}{(o.Proof is null ? "" : $", proven bound {o.Proof.RedLowerBound}")})");
        Console.WriteLine($"  Clash weight   {o.ClashWeight}   (structural minimum {o.Bounds.MinClashWeight})");
        Console.WriteLine($"  Balance L1     {o.Metrics.BalanceL1.ToString("0.0", inv)}   ·  sections per weekday {string.Join("/", o.Metrics.SectionsPerWeekday)}");
        Console.WriteLine($"  Hard rules     {(o.Audit.IsStructurallyFeasible ? "all satisfied" : $"{o.Audit.Structural.Count} VIOLATION(S)")}");
        foreach (var v in o.Audit.Structural.Take(10)) Console.WriteLine($"    ! {v.Detail}");
        Console.WriteLine($"  Optimality     {(o.RedProvenOptimal ? "RED proven optimal" : "not proven")}");
        Console.WriteLine($"  Search         {o.Search.TotalMoves / 1e6:N1} M moves in {o.Search.Elapsed.TotalSeconds.ToString("0.00", inv)} s · repro {o.Search.Options.ReproToken}{(o.Search.Options.IsReproducible ? "" : " (time-limited, not reproducible)")}");
        if (!quiet)
        {
            foreach (var w in o.Validation.Warnings.Take(5)) Console.WriteLine($"  warning: {w.Message}");
            if (o.Validation.Warnings.Count > 5) Console.WriteLine($"  … and {o.Validation.Warnings.Count - 5} more warning(s)");
        }
        Console.WriteLine($"  Done in {total.TotalSeconds.ToString("0.00", inv)} s → {Path.GetDirectoryName(files[0])}");
    }

    private static void PrintRejected(ValidationReport report)
    {
        Console.Error.WriteLine($"The workbook was rejected: {report.Errors.Count} problem(s) in {report.TotalRows} rows.");
        foreach (var e in report.Errors.Take(15))
            Console.Error.WriteLine($"  {(e.Row is { } r ? $"row {r}: " : "")}{e.Message}");
        if (report.Errors.Count > 15) Console.Error.WriteLine($"  … and {report.Errors.Count - 15} more");
    }

    private static string Version() =>
        typeof(Program).Assembly.GetCustomAttributes(typeof(System.Reflection.AssemblyInformationalVersionAttribute), false)
            .OfType<System.Reflection.AssemblyInformationalVersionAttribute>().FirstOrDefault()?.InformationalVersion.Split('+')[0] ?? "dev";

    private static void PrintHelp() => Console.WriteLine("""
        UniSlot — evening timetable optimiser

        Usage:
          unislot solve -i <enrollment.xlsx> -o <folder> [options]

        Options:
          -i, --input <file>        Enrollment workbook (first sheet)
          -o, --output <folder>     Output folder (default ./unislot-out)
          --seed <n>                Master seed (default 1). Same seed + chains + moves = same schedule on every machine
          --preset <name>           quick | standard | thorough   (6M | 30M | 150M moves per chain; default standard)
          --moves <n>               Moves per chain (overrides --preset)
          --chains <n>              Independent chains (default 12)
          --time <seconds>          Pace by wall-clock instead of moves (not reproducible)
          --threads <n>             Worker threads (default: all logical cores)
          --saturday                Allow mathematics courses on Saturday
          --saturday-codes <list>   Extra course codes allowed on Saturday (comma separated)
          --prove                   Run the exact CP-SAT stage after the search
          --prove-time <seconds>    Time budget for the exact stage (default 60)
          --institution <name>      Name shown in workbook headers
          --verify                  Cross-check incremental scores against full recomputation while searching
          -q, --quiet               Less output

        Exit codes: 0 ok · 2 workbook rejected · 3 hard-rule violation · 64 usage error
        """);

    private sealed record Options
    {
        public string Input { get; init; } = "";
        public string Output { get; init; } = "unislot-out";
        public ulong Seed { get; init; } = 1;
        public long Moves { get; init; } = 30_000_000;
        public int Chains { get; init; } = 12;
        public TimeSpan? TimeLimit { get; init; }
        public int? Threads { get; init; }
        public bool Saturday { get; init; }
        public string[] SaturdayCodes { get; init; } = [];
        public bool Prove { get; init; }
        public TimeSpan ProveTime { get; init; } = TimeSpan.FromSeconds(60);
        public string? Institution { get; init; }
        public bool Verify { get; init; }
        public bool Quiet { get; init; }

        public static Options Parse(string[] a)
        {
            var o = new Options();
            for (int i = 0; i < a.Length; i++)
            {
                string Next() => ++i < a.Length ? a[i] : throw new ArgumentException($"Option '{a[i - 1]}' needs a value.");
                switch (a[i])
                {
                    case "-i" or "--input": o = o with { Input = Next() }; break;
                    case "-o" or "--output": o = o with { Output = Next() }; break;
                    case "--seed": o = o with { Seed = ulong.TryParse(Next(), NumberStyles.None, CultureInfo.InvariantCulture, out var s) ? s : throw new ArgumentException("--seed must be a non-negative integer.") }; break;
                    case "--preset":
                        o = o with
                        {
                            Moves = Next().ToLowerInvariant() switch
                            {
                                "quick" => 6_000_000,
                                "standard" => 30_000_000,
                                "thorough" => 150_000_000,
                                _ => throw new ArgumentException("--preset must be quick, standard or thorough."),
                            },
                        };
                        break;
                    case "--moves": o = o with { Moves = long.TryParse(Next(), CultureInfo.InvariantCulture, out var m) && m > 0 ? m : throw new ArgumentException("--moves must be a positive integer.") }; break;
                    case "--chains": o = o with { Chains = int.TryParse(Next(), CultureInfo.InvariantCulture, out var c) && c > 0 ? c : throw new ArgumentException("--chains must be a positive integer.") }; break;
                    case "--time": o = o with { TimeLimit = double.TryParse(Next(), CultureInfo.InvariantCulture, out var t) && t > 0 ? TimeSpan.FromSeconds(t) : throw new ArgumentException("--time must be a positive number of seconds.") }; break;
                    case "--threads": o = o with { Threads = int.TryParse(Next(), CultureInfo.InvariantCulture, out var th) && th > 0 ? th : throw new ArgumentException("--threads must be a positive integer.") }; break;
                    case "--saturday": o = o with { Saturday = true }; break;
                    case "--saturday-codes": o = o with { SaturdayCodes = Next().Split([',', ';', ' '], StringSplitOptions.RemoveEmptyEntries) }; break;
                    case "--prove": o = o with { Prove = true }; break;
                    case "--prove-time": o = o with { ProveTime = double.TryParse(Next(), CultureInfo.InvariantCulture, out var pt) && pt > 0 ? TimeSpan.FromSeconds(pt) : throw new ArgumentException("--prove-time must be a positive number of seconds.") }; break;
                    case "--institution": o = o with { Institution = Next() }; break;
                    case "--verify": o = o with { Verify = true }; break;
                    case "-q" or "--quiet": o = o with { Quiet = true }; break;
                    default: throw new ArgumentException($"Unknown option '{a[i]}'.");
                }
            }
            if (o.Input.Length == 0) throw new ArgumentException("Missing --input <enrollment.xlsx>.");
            if (!File.Exists(o.Input)) throw new ArgumentException($"Input file not found: {o.Input}");
            return o;
        }
    }

    private static SchedulingProblem Problem(this SolveOutcome o) => o.Model.Problem;
}
