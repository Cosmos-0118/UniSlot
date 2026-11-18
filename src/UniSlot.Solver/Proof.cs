namespace UniSlot.Solver;

public enum ProofStatus
{
    /// <summary>The lexicographic optimum was proven for every level requested.</summary>
    Optimal,
    /// <summary>A solution is known but at least one level is not yet proven.</summary>
    Feasible,
    Unknown,
    Infeasible,
}

public sealed record ProofOptions
{
    public TimeSpan TimeLimit { get; init; } = TimeSpan.FromSeconds(60);
    public int Workers { get; init; } = Environment.ProcessorCount;
    public int Seed { get; init; } = 1;
}

public readonly record struct ProofProgress(double Fraction, int? RedLowerBound, int? RedUpperBound, TimeSpan Elapsed);

/// <summary>
/// Result of an exact stage. <see cref="RedLowerBound"/> is a proven bound; when it equals the incumbent RED the primary objective is
/// optimal. <see cref="ImprovedAssignment"/> is set only when the prover found a strictly better lexicographic score.
/// </summary>
public sealed record ProofResult(
    ProofStatus Status,
    int RedLowerBound,
    int? RedUpperBound,
    bool RedProven,
    int? ClashLowerBound,
    bool ClashProven,
    byte[]? ImprovedAssignment,
    Score? ImprovedScore,
    TimeSpan Elapsed,
    string Engine);

/// <summary>An exact method (for example CP-SAT) that tightens bounds and may improve the incumbent. Optional; the annealer never needs it.</summary>
public interface IOptimalityProver
{
    string Name { get; }

    Task<ProofResult> ProveAsync(
        SchedulingProblem problem,
        byte[] incumbent,
        Score incumbentScore,
        ProofOptions options,
        IProgress<ProofProgress>? progress,
        CancellationToken cancellationToken);
}
