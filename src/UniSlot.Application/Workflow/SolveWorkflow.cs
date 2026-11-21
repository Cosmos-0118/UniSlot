using System.Diagnostics;
using UniSlot.Application.Importing;
using UniSlot.Application.Planning;
using UniSlot.Domain;
using UniSlot.Solver;

namespace UniSlot.Application.Workflow;

public sealed record SourceInfo(string FileName, long Bytes, string Sha256);

public sealed record SolveInput(SourceInfo Source, IReadOnlyList<IReadOnlyList<string?>> Grid);

public sealed record SolveSettings
{
    public SchedulePolicy Policy { get; init; } = SchedulePolicy.Default;
    public SearchOptions Search { get; init; } = new();
    /// <summary>Run the exact stage after the search (requires a prover to be supplied).</summary>
    public bool Prove { get; init; }
    /// <summary>Budget for the exact stage; null lets it run until the result is proven.</summary>
    public TimeSpan? ProofTimeLimit { get; init; } = TimeSpan.FromSeconds(60);
    /// <summary>Use these sections instead of planning them from the roster (edits keep published sections exactly).</summary>
    public IReadOnlyList<Section>? FixedSections { get; init; }
    /// <summary>Course weekdays that must not move; courses not listed are free.</summary>
    public IReadOnlyDictionary<string, int>? PinnedDays { get; init; }
    /// <summary>Set by the edit workflows (late enrollment, rectify, fix, drop, revert).</summary>
    public EditInfo? Edit { get; init; }
}

public enum SolveStage { Reading, Planning, Bounds, Searching, Proving, Auditing, Done }

public readonly record struct SolveProgress(SolveStage Stage, double Fraction, int? BestRed = null, int? BestClash = null);

public sealed record SolveOutcome(
    SourceInfo Source,
    SolveSettings Settings,
    ValidationReport Validation,
    Roster Roster,
    IReadOnlyList<Section> Sections,
    ProblemModel Model,
    Timetable Timetable,
    SearchResult Search,
    ProofResult? Proof,
    Evaluation Evaluation,
    AuditReport Audit,
    ClashReport Clash,
    ScheduleMetrics Metrics,
    IReadOnlyList<ScheduleEntry> Schedule,
    LowerBoundReport Bounds,
    IReadOnlyDictionary<string, TimeSpan> Timings)
{
    public int RedStudents => Clash.StudentsWithClashes;
    public int ClashWeight => Evaluation.Score.Clash;
    public bool RedProvenOptimal => Proof is { RedProven: true } && Proof.RedLowerBound >= RedStudents;
    public bool RedAtStructuralBound => RedStudents <= Bounds.MinRedStudents;
}

public sealed class InputRejectedException(ValidationReport report) : Exception("The enrollment workbook was rejected.")
{
    public ValidationReport Report { get; } = report;
}

/// <summary>The solver and the independent domain audit disagree. Never expected; surfaced loudly rather than shipping a wrong timetable.</summary>
public sealed class ConsistencyException(string message) : Exception(message);

/// <summary>
/// The use case: parse → plan sections → build the integer problem → bounds → search → (optionally prove) → audit and report.
/// Pure orchestration: no file, UI or Excel knowledge.
/// </summary>
public sealed class SolveWorkflow(ISearchEngine engine, IOptimalityProver? prover = null)
{
    public Task<SolveOutcome> RunAsync(SolveInput input, SolveSettings settings, IProgress<SolveProgress>? progress, CancellationToken ct) =>
        Task.Run(() => Run(input, settings, progress, ct), ct);

    public SolveOutcome Run(SolveInput input, SolveSettings settings, IProgress<SolveProgress>? progress, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(settings);
        var timings = new Dictionary<string, TimeSpan>();
        var clock = Stopwatch.StartNew();
        TimeSpan Lap() { var t = clock.Elapsed; clock.Restart(); return t; }
        void Report(SolveStage stage, double f, int? red = null, int? clash = null) => progress?.Report(new SolveProgress(stage, f, red, clash));

        Report(SolveStage.Reading, 0.0);
        var parsed = EnrollmentParser.Parse(input.Grid);
        var rosterResult = RosterBuilder.Build(parsed);
        if (rosterResult.Roster is null || !rosterResult.Validation.IsValid) throw new InputRejectedException(rosterResult.Validation);
        var roster = rosterResult.Roster;
        timings["parse"] = Lap();
        ct.ThrowIfCancellationRequested();

        Report(SolveStage.Planning, 0.05);
        var sections = settings.FixedSections ?? SectionPlanner.Plan(roster);
        var model = ProblemBuilder.Build(roster, sections, settings.Policy, settings.PinnedDays);
        timings["plan"] = Lap();

        Report(SolveStage.Bounds, 0.08);
        var bounds = LowerBounds.Compute(model.Problem);
        timings["bounds"] = Lap();
        ct.ThrowIfCancellationRequested();

        bool prove = settings.Prove && prover is not null;
        double searchEnd = prove ? 0.80 : 0.95;
        Report(SolveStage.Searching, 0.10);
        var searchProgress = new Progress<SearchProgress>(p =>
            Report(SolveStage.Searching, 0.10 + (searchEnd - 0.10) * p.Fraction, p.BestRed == int.MaxValue ? null : p.BestRed, p.BestClash == int.MaxValue ? null : p.BestClash));
        var search = engine.Search(model.Problem, settings.Search, searchProgress, ct);
        timings["search"] = Lap();
        ct.ThrowIfCancellationRequested();

        byte[] assignment = search.Assignment;
        Evaluation evaluation = search.Evaluation;
        ProofResult? proof = null;
        if (prove)
        {
            Report(SolveStage.Proving, searchEnd, evaluation.Score.Red, evaluation.Score.Clash);
            var proofProgress = new Progress<ProofProgress>(p => Report(SolveStage.Proving, searchEnd + (0.97 - searchEnd) * p.Fraction, p.RedUpperBound));
            proof = prover!.ProveAsync(model.Problem, assignment, evaluation.Score,
                new ProofOptions { TimeLimit = settings.ProofTimeLimit, Seed = (int)(settings.Search.Seed & 0x7FFFFFFF) }, proofProgress, ct)
                .GetAwaiter().GetResult();
            if (proof.ImprovedAssignment is { } better)
            {
                var candidate = Evaluator.Evaluate(model.Problem, better);
                if (candidate.IsFeasible && candidate.Score < evaluation.Score)
                {
                    assignment = better;
                    evaluation = candidate;
                }
            }
            timings["proof"] = Lap();
        }

        Report(SolveStage.Auditing, 0.97);
        var timetable = model.ToTimetable(assignment);
        var audit = ScheduleAuditor.Audit(sections, timetable, settings.Policy);
        var clash = ClashAnalyzer.Analyze(roster, sections, timetable);
        var metrics = MetricsCalculator.Compute(sections, timetable, settings.Policy);
        var schedule = ScheduleBuilder.Build(sections, timetable);
        timings["report"] = Lap();

        // Two independent implementations must agree on the primary objective.
        if (evaluation.Score.Red != clash.StudentsWithClashes)
            throw new ConsistencyException($"Solver counts {evaluation.Score.Red} RED students but the audit counts {clash.StudentsWithClashes}.");
        if (!evaluation.IsFeasible)
            throw new ConsistencyException("The solver returned an assignment that breaks its own hard rules.");

        Report(SolveStage.Done, 1.0, evaluation.Score.Red, evaluation.Score.Clash);
        return new SolveOutcome(input.Source, settings, rosterResult.Validation, roster, sections, model, timetable, search, proof, evaluation,
            audit, clash, metrics, schedule, bounds, timings);
    }
}
