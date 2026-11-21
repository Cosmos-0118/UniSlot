using System.Diagnostics;
using UniSlot.Application.Importing;
using UniSlot.Application.Workflow;
using UniSlot.Domain;
using UniSlot.Infrastructure;
using UniSlot.Infrastructure.Export;
using UniSlot.Proof;
using UniSlot.Solver;

namespace UniSlot.Cli;

internal sealed record SolveRequest(string InputPath, string OutputFolder, SolveSettings Settings, string? Institution);

internal sealed record SolveRun(SolveOutcome Outcome, IReadOnlyList<string> Files, string Folder, TimeSpan Elapsed);

/// <summary>An immutable view of how far a run has got.</summary>
internal sealed record ProgressSnapshot(int Rank, double Fraction, int? BestRed, int? BestClash, IReadOnlyList<TimeSpan?> Entered, TimeSpan Elapsed, bool Finished);

/// <summary>
/// Thread-safe progress state. Progress callbacks from the workflow arrive on thread-pool threads, possibly out of order or after
/// the work has returned, so every update only moves forward; the display polls <see cref="Snapshot"/> on its own timer.
/// </summary>
internal sealed class ProgressSink
{
    public const int Reading = 0, Planning = 1, Bounds = 2, Searching = 3, Proving = 4, Auditing = 5, Saving = 6, StepCount = 7;

    private readonly object _gate = new();
    private readonly Stopwatch _clock = Stopwatch.StartNew();
    private readonly TimeSpan?[] _entered = new TimeSpan?[StepCount];
    private int _rank = -1;
    private double _fraction;
    private int? _red, _clash;
    private bool _finished;

    public static int RankOf(SolveStage stage) => stage switch
    {
        SolveStage.Reading => Reading,
        SolveStage.Planning => Planning,
        SolveStage.Bounds => Bounds,
        SolveStage.Searching => Searching,
        SolveStage.Proving => Proving,
        SolveStage.Auditing => Auditing,
        _ => Saving,
    };

    public void Enter(int rank)
    {
        lock (_gate)
        {
            if (rank <= _rank) return;
            for (int r = _rank + 1; r <= rank; r++) _entered[r] = _clock.Elapsed;
            _rank = rank;
        }
    }

    public void Report(SolveProgress p)
    {
        lock (_gate)
        {
            int rank = RankOf(p.Stage);
            if (rank > _rank)
            {
                for (int r = _rank + 1; r <= rank; r++) _entered[r] = _clock.Elapsed;
                _rank = rank;
            }
            if (rank == _rank) _fraction = Math.Max(_fraction, Math.Min(p.Fraction, 1.0));
            if (p.BestRed is { } red && (_red is null || red < _red || (red == _red && p.BestClash < _clash)))
            {
                _red = red;
                _clash = p.BestClash ?? _clash;
            }
        }
    }

    public void Finish()
    {
        lock (_gate)
        {
            _finished = true;
            _fraction = 1.0;
        }
    }

    public ProgressSnapshot Snapshot()
    {
        lock (_gate) return new ProgressSnapshot(_rank, _fraction, _red, _clash, [.. _entered], _clock.Elapsed, _finished);
    }
}

internal static class SolveRunner
{
    /// <summary>Reads, solves, audits and writes the output folder. Reports progress through <paramref name="sink"/> when given.</summary>
    public static async Task<SolveRun> RunAsync(SolveRequest request, ProgressSink? sink, CancellationToken ct)
    {
        var clock = Stopwatch.StartNew();
        sink?.Enter(ProgressSink.Reading);
        var input = await XlsxEnrollmentSource.ReadAsync(request.InputPath, ct).ConfigureAwait(false);

        IOptimalityProver? prover = request.Settings.Prove ? CpSatProver.Create() : null;
        var workflow = new SolveWorkflow(new AnnealingEngine(), prover);
        IProgress<SolveProgress>? progress = sink is null ? null : new Progress<SolveProgress>(sink.Report);
        var outcome = await workflow.RunAsync(input, request.Settings, progress, ct).ConfigureAwait(false);

        sink?.Enter(ProgressSink.Saving);
        var files = await OutputWriter.WriteAsync(outcome, request.OutputFolder, new ExportOptions { Institution = string.IsNullOrWhiteSpace(request.Institution) ? null : request.Institution }, ct)
            .ConfigureAwait(false);
        sink?.Finish();
        return new SolveRun(outcome, files, request.OutputFolder, clock.Elapsed);
    }

    /// <summary>Builds solver settings from stored preferences, with optional command-line overrides.</summary>
    public static SolveSettings BuildSettings(CliSettings prefs, Options? o = null, bool untimedProof = false)
    {
        o ??= new Options();
        bool saturday = o.Saturday ?? prefs.AllowSaturday;
        string[] codes = o.SaturdayCodes ?? [prefs.SaturdayCodes];
        bool prove = o.Prove ?? prefs.Prove;
        long moves = o.Moves ?? prefs.Quality switch { 0 => Options.Quick, 2 => Options.Thorough, _ => Options.Standard };
        return new SolveSettings
        {
            Policy = new SchedulePolicy { AllowSaturdayForMaths = saturday, SaturdayExtraCourses = SchedulePolicy.NormalizeCodes(codes) },
            Search = new SearchOptions
            {
                Seed = o.Seed ?? (ulong)Math.Max(0, prefs.Seed),
                Chains = o.Chains,
                MovesPerChain = moves,
                TimeLimit = o.TimeLimit,
                MaxThreads = o.Threads,
                VerifyEvery = o.Verify ? 1 << 20 : 0,
            },
            Prove = prove,
            // Interactive runs let the exact stage finish (the user can cancel); scripted runs keep a budget.
            ProofTimeLimit = o.ProveTime ?? (untimedProof ? null : TimeSpan.FromSeconds(60)),
        };
    }

    public static string DefaultFolder(CliSettings prefs, string inputPath)
    {
        string name = Path.GetFileNameWithoutExtension(inputPath);
        foreach (char c in Path.GetInvalidFileNameChars()) name = name.Replace(c, '_');
        if (name.Length > 60) name = name[..60];
        return Path.Combine(prefs.OutputRoot, $"{name}-{DateTime.Now:yyyyMMdd-HHmmss}");
    }
}
