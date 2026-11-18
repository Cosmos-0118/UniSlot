using System.Diagnostics;

namespace UniSlot.Solver;

/// <summary>
/// Multi-chain lexicographic simulated annealing. Chains are independent and seeded from the master seed, so the result depends only on
/// (seed, chain count, move budget) — never on thread count, core count or machine speed.
/// </summary>
public sealed class AnnealingEngine : ISearchEngine
{
    public string Name => "UniSlot annealer";

    public SearchResult Search(SchedulingProblem problem, SearchOptions options, IProgress<SearchProgress>? progress, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(problem);
        ArgumentNullException.ThrowIfNull(options);
        if (options.Chains < 1) throw new ArgumentOutOfRangeException(nameof(options), "At least one chain is required.");
        if (options.TimeLimit is null && options.MovesPerChain < 1) throw new ArgumentOutOfRangeException(nameof(options), "Move budget must be positive.");
        if (options.TimeLimit is { } limit && limit <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(options), "Time limit must be positive.");

        int chains = options.Chains;
        int threads = Math.Clamp(options.MaxThreads ?? Environment.ProcessorCount, 1, chains);
        double msPerChain = options.TimeLimit is { } tl
            ? tl.TotalMilliseconds / Math.Ceiling(chains / (double)threads)
            : 0;

        var progresses = new ChainProgress[chains];
        for (int i = 0; i < chains; i++) progresses[i] = new ChainProgress();
        var outcomes = new ChainOutcome?[chains];
        var clock = Stopwatch.StartNew();
        int next = -1;
        Exception? failure = null;

        var workers = new Thread[threads];
        for (int t = 0; t < threads; t++)
        {
            workers[t] = new Thread(() =>
            {
                try
                {
                    while (true)
                    {
                        int i = Interlocked.Increment(ref next);
                        if (i >= chains) break;
                        outcomes[i] = ChainRunner.Run(problem, options.Schedule, ChainSeed(options.Seed, i), options.MovesPerChain,
                            msPerChain, options.VerifyEvery, progresses[i], cancellationToken);
                    }
                }
                catch (Exception ex)
                {
                    Interlocked.CompareExchange(ref failure, ex, null);
                }
            })
            { IsBackground = true, Name = $"UniSlot-chain-{t}" };
            workers[t].Start();
        }

        while (workers.Any(w => w.IsAlive))
        {
            Thread.Sleep(50);
            progress?.Report(Snapshot(progresses, options, clock.Elapsed));
        }
        foreach (var w in workers) w.Join();
        if (failure is not null) throw new InvalidOperationException("A search chain failed.", failure);
        progress?.Report(Snapshot(progresses, options, clock.Elapsed) with { Fraction = 1.0 });

        // Deterministic merge: lexicographic best, ties broken by the lowest chain index.
        int bestIndex = 0;
        for (int i = 1; i < chains; i++)
            if (outcomes[i]!.Evaluation.Score < outcomes[bestIndex]!.Evaluation.Score) bestIndex = i;

        var best = outcomes[bestIndex]!;
        var summaries = new List<ChainSummary>(chains);
        long totalMoves = 0;
        for (int i = 0; i < chains; i++)
        {
            var o = outcomes[i]!;
            totalMoves += o.Moves;
            summaries.Add(new ChainSummary(i, o.Evaluation.Score, o.Moves, o.Accepted, o.WorseRedAccepted, o.WorseRedAcceptedWhileFrozen,
                o.VerifyChecks, o.VerifyMismatches, o.Trace));
        }

        return new SearchResult((byte[])best.Day.Clone(), best.Evaluation.Score, best.Evaluation, Name, options, totalMoves, clock.Elapsed,
            summaries, cancellationToken.IsCancellationRequested);
    }

    private static ulong ChainSeed(ulong master, int chain)
    {
        ulong state = master ^ ((ulong)(chain + 1) * 0x9E3779B97F4A7C15UL);
        return SplitMix64.Next(ref state);
    }

    private static SearchProgress Snapshot(ChainProgress[] chains, SearchOptions options, TimeSpan elapsed)
    {
        long done = 0;
        int bestRed = int.MaxValue, bestClash = int.MaxValue;
        foreach (var c in chains)
        {
            done += Volatile.Read(ref c.Moves);
            int r = Volatile.Read(ref c.BestRed), cl = Volatile.Read(ref c.BestClash);
            if (r < bestRed || (r == bestRed && cl < bestClash)) { bestRed = r; bestClash = cl; }
        }

        double fraction = options.TimeLimit is { } limit
            ? Math.Clamp(elapsed.TotalMilliseconds / limit.TotalMilliseconds, 0, 1)
            : Math.Clamp(done / ((double)options.MovesPerChain * chains.Length), 0, 1);
        return new SearchProgress(fraction, bestRed, bestClash, done, elapsed);
    }
}
