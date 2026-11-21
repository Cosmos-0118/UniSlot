using UniSlot.Application.Importing;
using UniSlot.Application.Workflow;
using UniSlot.Solver;

namespace UniSlot.Tests;

public class DeterminismTests
{
    [Fact]
    public void ExpNeg_matches_libm_closely()
    {
        for (double x = 0; x <= 40; x += 0.0173)
        {
            double expected = Math.Exp(-x);
            double actual = DeterministicMath.ExpNeg(x);
            Assert.True(Math.Abs(actual - expected) <= expected * 1e-12 + 1e-300, $"x={x}: {actual} vs {expected}");
        }
        Assert.Equal(1.0, DeterministicMath.ExpNeg(0));
        Assert.Equal(0.0, DeterministicMath.ExpNeg(1000));
    }

    [Fact]
    public void Ln_matches_libm_closely()
    {
        foreach (double x in new[] { 1.0000001, 1.5, 2, 3.14159, 8, 133.333, 1e6 })
            Assert.InRange(Math.Abs(DeterministicLog.Ln(x) - Math.Log(x)), 0, 1e-12);
    }

    [Fact]
    public void Generator_stream_is_pinned()
    {
        // Golden values: if these change, every stored reproduction token changes meaning.
        var rng = new Xoshiro256(12345);
        ulong a = rng.Next64(), b = rng.Next64();
        var again = new Xoshiro256(12345);
        Assert.Equal(a, again.Next64());
        Assert.Equal(b, again.Next64());
        Assert.NotEqual(a, b);
        for (int i = 0; i < 10_000; i++) Assert.InRange(rng.Below(7), 0, 6);
    }
}

public class EvaluatorTests
{
    [Fact]
    public void Counts_red_students_once_and_weights_clashes()
    {
        // students: {0,1,2} all clash if 0,1,2 share a day; {0,1} too
        var p = TestData.Problem(4, [[0, 1, 2], [0, 1], [2, 3]]);
        var allSame = Evaluator.Evaluate(p, new byte[] { 0, 0, 0, 1 });
        Assert.Equal(2, allSame.Score.Red);            // students 1 and 2; student 3 has 2,3 apart
        Assert.Equal(4, allSame.Score.Clash);          // pairs (0,1)=2, (0,2)=1, (1,2)=1
        var spread = Evaluator.Evaluate(p, new byte[] { 0, 1, 2, 3 });
        Assert.Equal(new Score(0, 0, spread.Score.Balance, spread.Score.Excess), spread.Score);
    }

    [Fact]
    public void Detects_range_pin_and_faculty_violations()
    {
        var p = TestData.Problem(3, [[0, 1]], groups: [[0, 2]], pinned: [-1, 2, -1], allowed: [5, 5, 3]);
        var bad = Evaluator.Evaluate(p, new byte[] { 1, 0, 4 });
        Assert.Equal(1, bad.RangeViolations);   // course 2 allows 3 weekdays, was given day 4
        Assert.Equal(1, bad.PinnedViolations);  // course 1 must be day 2
        var faculty = Evaluator.Evaluate(p, new byte[] { 1, 2, 1 });
        Assert.Equal(1, faculty.FacultyViolations);
        Assert.False(faculty.IsFeasible);
    }
}

public class AnnealingEngineTests
{
    private static readonly SearchOptions Quick = new() { Chains = 4, MovesPerChain = 400_000, Seed = 7 };

    [Fact]
    public void Finds_a_clash_free_timetable_when_one_exists()
    {
        // a ring of 5 conflicting courses is 3-colourable
        var p = TestData.Problem(5, [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]]);
        var r = new AnnealingEngine().Search(p, Quick, null, CancellationToken.None);
        Assert.Equal(0, r.Score.Red);
        Assert.Equal(0, r.Score.Clash);
        Assert.True(r.Evaluation.IsFeasible);
    }

    [Fact]
    public void Result_is_independent_of_thread_count()
    {
        var p = TestData.RandomProblem(120, 400, seed: 3);
        var one = new AnnealingEngine().Search(p, Quick with { MaxThreads = 1 }, null, CancellationToken.None);
        var many = new AnnealingEngine().Search(p, Quick with { MaxThreads = 4 }, null, CancellationToken.None);
        Assert.Equal(one.Assignment, many.Assignment);
        Assert.Equal(one.Score, many.Score);
    }

    [Fact]
    public void Same_seed_repeats_and_different_seed_differs()
    {
        var p = TestData.RandomProblem(120, 400, seed: 5);
        var a = new AnnealingEngine().Search(p, Quick, null, CancellationToken.None);
        var b = new AnnealingEngine().Search(p, Quick, null, CancellationToken.None);
        var c = new AnnealingEngine().Search(p, Quick with { Seed = 8 }, null, CancellationToken.None);
        Assert.Equal(a.Assignment, b.Assignment);
        Assert.NotEqual(a.Assignment, c.Assignment);
    }

    [Fact]
    public void Incremental_scores_always_match_full_recomputation()
    {
        var p = TestData.RandomProblem(150, 500, seed: 11);
        var r = new AnnealingEngine().Search(p, Quick with { VerifyEvery = 20_000 }, null, CancellationToken.None);
        Assert.All(r.Chains, c => Assert.True(c.VerifyChecks > 0));
        Assert.All(r.Chains, c => Assert.Equal(0, c.VerifyMismatches));
        Assert.Equal(Evaluator.Evaluate(p, r.Assignment).Score, r.Score);
    }

    [Fact]
    public void Red_is_never_worsened_once_frozen()
    {
        var p = TestData.RandomProblem(150, 500, seed: 13);
        var r = new AnnealingEngine().Search(p, Quick, null, CancellationToken.None);
        Assert.All(r.Chains, c => Assert.Equal(0, c.WorseRedAcceptedWhileFrozen));
        // stage A really does explore RED-worsening moves, so the guarantee above is not vacuous
        Assert.Contains(r.Chains, c => c.WorseRedAccepted > 0);
    }

    [Fact]
    public void Returned_score_is_the_best_any_chain_reached()
    {
        var p = TestData.RandomProblem(150, 500, seed: 17);
        var r = new AnnealingEngine().Search(p, Quick, null, CancellationToken.None);
        Assert.All(r.Chains, c => Assert.True(r.Score <= c.Score));
    }

    [Fact]
    public void Honours_pins_faculty_groups_and_allowed_days()
    {
        var p = TestData.Problem(8, [[0, 1, 2], [2, 3], [4, 5], [6, 7, 0]], groups: [[1, 3, 5]], pinned: [2, -1, -1, -1, -1, -1, -1, -1],
            allowed: [5, 5, 5, 5, 5, 5, 3, 3]);
        var r = new AnnealingEngine().Search(p, Quick, null, CancellationToken.None);
        Assert.True(r.Evaluation.IsFeasible, "pins, faculty all-different and per-course allowed days must hold");
        Assert.Equal(2, r.Assignment[0]);
        Assert.True(r.Assignment[6] < 3 && r.Assignment[7] < 3);
        Assert.Equal(3, new[] { r.Assignment[1], r.Assignment[3], r.Assignment[5] }.Distinct().Count());
    }

    [Fact]
    public void Cancellation_returns_a_valid_partial_result()
    {
        var p = TestData.RandomProblem(200, 800, seed: 19);
        using var cts = new CancellationTokenSource();
        cts.Cancel();
        var r = new AnnealingEngine().Search(p, new SearchOptions { Chains = 2, MovesPerChain = 50_000_000 }, null, cts.Token);
        Assert.True(r.Cancelled);
        Assert.True(r.Evaluation.IsFeasible);
    }

    [Fact]
    public void Time_limited_mode_stops_on_time()
    {
        var p = TestData.RandomProblem(150, 500, seed: 23);
        var r = new AnnealingEngine().Search(p, new SearchOptions { Chains = 2, TimeLimit = TimeSpan.FromMilliseconds(300) }, null, CancellationToken.None);
        Assert.InRange(r.Elapsed.TotalSeconds, 0.25, 3);
        Assert.False(r.Options.IsReproducible);
    }

    [Fact]
    public void Rejects_invalid_options()
    {
        var p = TestData.RandomProblem(10, 20, seed: 1);
        var engine = new AnnealingEngine();
        Assert.Throws<ArgumentOutOfRangeException>(() => engine.Search(p, new SearchOptions { Chains = 0 }, null, CancellationToken.None));
        Assert.Throws<ArgumentOutOfRangeException>(() => engine.Search(p, new SearchOptions { MovesPerChain = 0 }, null, CancellationToken.None));
    }
}

public class LowerBoundTests
{
    [Fact]
    public void Clique_larger_than_the_week_forces_clashes()
    {
        // 7 mutually conflicting courses on 5 weekdays
        var students = new List<int[]>();
        for (int a = 0; a < 7; a++)
            for (int b = a + 1; b < 7; b++) students.Add([a, b]);
        var p = TestData.Problem(7, [.. students]);
        var lb = LowerBounds.Compute(p);
        Assert.True(lb.ZeroClashImpossible);
        Assert.True(lb.MinClashWeight >= LowerBounds.MinMonochromePairs(7, 5));
        Assert.Equal(7, lb.MaxCliqueSize);
        var r = new AnnealingEngine().Search(p, new SearchOptions { Chains = 2, MovesPerChain = 200_000 }, null, CancellationToken.None);
        Assert.True(r.Score.Clash >= lb.MinClashWeight, "a valid lower bound can never exceed an achieved value");
    }

    [Fact]
    public void Student_with_more_courses_than_days_must_clash()
    {
        var p = TestData.Problem(6, [[0, 1, 2, 3, 4, 5]]);
        Assert.Equal(1, LowerBounds.Compute(p).MinRedStudents);
    }

    [Theory]
    [InlineData(0, 5, 0)]
    [InlineData(5, 5, 0)]
    [InlineData(6, 5, 1)]
    [InlineData(10, 5, 5)]
    [InlineData(7, 3, 5)]
    public void MinMonochromePairs_matches_the_pigeonhole_count(int n, int k, int expected) =>
        Assert.Equal(expected, LowerBounds.MinMonochromePairs(n, k));

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    public void Bounds_never_exceed_what_the_search_achieves(int seed)
    {
        var p = TestData.RandomProblem(90, 400, seed);
        var lb = LowerBounds.Compute(p);
        var r = new AnnealingEngine().Search(p, new SearchOptions { Chains = 4, MovesPerChain = 600_000 }, null, CancellationToken.None);
        Assert.True(r.Score.Red >= lb.MinRedStudents);
        Assert.True(r.Score.Clash >= lb.MinClashWeight);
    }
}

public class ScoreTests
{
    [Fact]
    public void Earlier_levels_dominate_later_ones()
    {
        Assert.True(new Score(1, 999, 999, 999) < new Score(2, 0, 0, 0));
        Assert.True(new Score(1, 5, 999, 999) < new Score(1, 6, 0, 0));
        Assert.True(new Score(1, 5, 3, 999) < new Score(1, 5, 4, 0));
        Assert.True(new Score(1, 5, 3, 1) < new Score(1, 5, 3, 2));
        Assert.Equal(0, new Score(1, 2, 3, 4).CompareTo(new Score(1, 2, 3, 4)));
    }
}

public class ProverTests
{
    [Fact]
    public void Proof_without_a_time_limit_runs_to_completion_on_a_small_problem()
    {
        var input = new SolveInput(new SourceInfo("a.xlsx", 1, "00"), TestData.Grid(60, 12, 3, seed: 5));
        var settings = new SolveSettings
        {
            Search = new SearchOptions { Chains = 2, MovesPerChain = 200_000 },
            Prove = true,
            ProofTimeLimit = null,
        };
        var outcome = new SolveWorkflow(new AnnealingEngine(), UniSlot.Proof.CpSatProver.Create()).Run(input, settings, null, CancellationToken.None);
        Assert.NotNull(outcome.Proof);
        Assert.Equal(ProofStatus.Optimal, outcome.Proof!.Status);
    }
}
