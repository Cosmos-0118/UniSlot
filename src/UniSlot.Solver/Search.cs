namespace UniSlot.Solver;

/// <summary>Temperatures and stage boundaries of the three-stage lexicographic schedule.</summary>
public sealed record AnnealingSchedule
{
    /// <summary>Fraction of the budget spent in stage A (RED first). Stage B (clash, RED frozen) runs until <see cref="StageB"/>.</summary>
    public double StageA { get; init; } = 0.75;
    /// <summary>Fraction at which stage C (balance and parallel excess, RED and clash frozen) starts.</summary>
    public double StageB { get; init; } = 0.90;
    public double RedStart { get; init; } = 0.5;
    public double RedEnd { get; init; } = 0.06;
    public double ClashStart { get; init; } = 8;
    public double ClashEnd { get; init; } = 0.4;
    public double ClashStageBStart { get; init; } = 1.5;
    public double ClashStageBEnd { get; init; } = 0.2;
    public double BalanceStart { get; init; } = 6;
    public double BalanceEnd { get; init; } = 0.5;
    public double ExcessStart { get; init; } = 1;
    public double ExcessEnd { get; init; } = 0.2;

    public static AnnealingSchedule Default { get; } = new();
}

public sealed record SearchOptions
{
    /// <summary>Master seed. Together with <see cref="Chains"/> and <see cref="MovesPerChain"/> it fully determines the result.</summary>
    public ulong Seed { get; init; } = 1;
    /// <summary>Independent annealing chains. A logical count: results do not depend on how many threads execute them.</summary>
    public int Chains { get; init; } = 12;
    public long MovesPerChain { get; init; } = 30_000_000;
    /// <summary>When set, each chain is paced by wall-clock time instead of a move count. Faster to bound, but not reproducible.</summary>
    public TimeSpan? TimeLimit { get; init; }
    /// <summary>Worker threads (defaults to the logical processor count, capped at <see cref="Chains"/>).</summary>
    public int? MaxThreads { get; init; }
    public AnnealingSchedule Schedule { get; init; } = AnnealingSchedule.Default;
    /// <summary>Every N moves, recompute the objective from scratch and compare with the incremental state (0 = off). For tests and audits.</summary>
    public int VerifyEvery { get; init; }

    public bool IsReproducible => TimeLimit is null;
    public string ReproToken => $"{Seed}/{Chains}/{MovesPerChain}";
}

public readonly record struct SearchProgress(double Fraction, int BestRed, int BestClash, long MovesDone, TimeSpan Elapsed);

public readonly record struct TracePoint(long Move, int Red, int Clash);

public sealed record ChainSummary(
    int Index,
    Score Score,
    long Moves,
    long Accepted,
    long WorseRedAccepted,
    long WorseRedAcceptedWhileFrozen,
    int VerifyChecks,
    int VerifyMismatches,
    IReadOnlyList<TracePoint> Trace);

public sealed record SearchResult(
    byte[] Assignment,
    Score Score,
    Evaluation Evaluation,
    string Engine,
    SearchOptions Options,
    long TotalMoves,
    TimeSpan Elapsed,
    IReadOnlyList<ChainSummary> Chains,
    bool Cancelled);

public interface ISearchEngine
{
    string Name { get; }

    SearchResult Search(SchedulingProblem problem, SearchOptions options, IProgress<SearchProgress>? progress, CancellationToken cancellationToken);
}
