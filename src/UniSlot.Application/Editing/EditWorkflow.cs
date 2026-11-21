using UniSlot.Application.Workflow;
using UniSlot.Domain;
using UniSlot.Solver;

namespace UniSlot.Application.Editing;

/// <summary>
/// Turns an <see cref="EditPlan"/> into a full outcome: the edited sections are kept exactly, every course that already has a weekday is
/// pinned, and only brand-new courses are searched. The same independent audit as a fresh solve then checks the result.
/// </summary>
public static class EditWorkflow
{
    public static SolveOutcome Run(Workspace before, EditPlan plan, IProgress<SolveProgress>? progress, CancellationToken ct, ISearchEngine? engine = null)
    {
        ArgumentNullException.ThrowIfNull(before);
        ArgumentNullException.ThrowIfNull(plan);
        var ws = plan.Workspace;
        before.Validate();
        ws.Validate(allowUnplaced: true);

        // The state before the edit: its clash report is what "introduced" and "resolved" are measured against.
        ClashReport? previousClash = null;
        try
        {
            var oldRoster = before.ToRoster();
            previousClash = ClashAnalyzer.Analyze(oldRoster, before.Sections, before.ToTimetable());
        }
        catch (InputRejectedException) { /* an unreadable earlier state just means no comparison */ }

        int free = ws.UnplacedCourses().Count();
        var settings = new SolveSettings
        {
            Policy = ws.Policy,
            Search = new SearchOptions
            {
                Seed = ws.Seed,
                Chains = free > 0 ? 8 : 1,
                MovesPerChain = free > 0 ? 4_000_000 : 1_000,
            },
            Prove = false,
            FixedSections = ws.Sections,
            PinnedDays = ws.Days,
            Edit = plan.Info with
            {
                PreviousClash = previousClash,
                PriorRunLog = before.RunLog,
            },
        };

        var workflow = new SolveWorkflow(engine ?? new AnnealingEngine(), null);
        return workflow.Run(new SolveInput(ws.Source, ws.ToGrid()), settings, progress, ct);
    }

    public static Task<SolveOutcome> RunAsync(Workspace before, EditPlan plan, IProgress<SolveProgress>? progress, CancellationToken ct) =>
        Task.Run(() => Run(before, plan, progress, ct), ct);
}
