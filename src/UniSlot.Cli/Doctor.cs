using System.Runtime.InteropServices;
using Spectre.Console;
using UniSlot.Application.Editing;
using UniSlot.Application.Workflow;
using UniSlot.Domain;
using UniSlot.Infrastructure;
using UniSlot.Proof;
using UniSlot.Solver;

namespace UniSlot.Cli;

/// <summary><c>unislot doctor</c>: proves on a tiny timetable that the search engine and the exact CP-SAT stage both work on this machine.</summary>
internal static class Doctor
{
    public static async Task<int> RunAsync(IAnsiConsole c, CliSettings prefs)
    {
        c.MarkupLine($"[bold {Ui.AccentM}]UniSlot[/] [{Ui.MutedM}]v{Ui.Esc(Ui.Version())}[/]");
        Ok(c, $".NET {Environment.Version} · {RuntimeInformation.OSDescription} · {Environment.ProcessorCount} logical CPUs");
        Ok(c, $"Settings: {CliSettings.DefaultPath}");
        Ok(c, $"Output root: {prefs.OutputRoot}");

        var grid = new List<IReadOnlyList<string?>> { Workspace.GridHeader };
        string[][] picks = [["C1", "C2"], ["C1", "C3"], ["C2", "C3"], ["C1", "C2", "C3"], ["C4", "C1"], ["C4", "C2"]];
        for (int s = 0; s < picks.Length; s++)
            foreach (string course in picks[s])
                grid.Add(["B.Tech-Computer Science", $"RD{s:000}", $"doctor student {s}", null, null, course, $"Course {course}", null]);

        bool engineOk = false;
        try
        {
            var plain = await new SolveWorkflow(new AnnealingEngine()).RunAsync(
                new SolveInput(new SourceInfo("doctor", 0, ""), grid), Settings(prove: false), null, CancellationToken.None);
            engineOk = plain.Audit.IsStructurallyFeasible;
            if (engineOk) Ok(c, $"Search engine: {plain.Search.Engine}");
            else Fail(c, "Search engine produced a schedule that breaks the hard rules.");
        }
        catch (Exception ex) when (ex is InvalidOperationException or InvalidDataException or ConsistencyException or InputRejectedException)
        {
            Fail(c, $"Search engine failed: {ex.Message}");
        }

        bool proofOk = false;
        try
        {
            var proven = await new SolveWorkflow(new AnnealingEngine(), CpSatProver.Create()).RunAsync(
                new SolveInput(new SourceInfo("doctor", 0, ""), grid), Settings(prove: true), null, CancellationToken.None);
            proofOk = proven.Proof is not null;
            if (proofOk) Ok(c, $"Exact stage: {proven.Proof!.Engine}");
            else Fail(c, "The exact CP-SAT stage did not run.");
        }
        catch (Exception ex) when (ex is DllNotFoundException or BadImageFormatException or TypeInitializationException or InvalidOperationException or InvalidDataException or ConsistencyException)
        {
            Fail(c, $"The exact CP-SAT stage cannot run on this machine: {ex.Message}");
        }

        c.WriteLine();
        if (engineOk && proofOk) c.MarkupLine($"[bold {Ui.GoodM}]Ready to schedule.[/]");
        else c.MarkupLine(engineOk ? $"[bold {Ui.WarnM}]Ready to schedule, but --prove will not work here.[/]" : $"[bold {Ui.BadM}]Not ready.[/]");
        return engineOk ? 0 : 1;
    }

    private static SolveSettings Settings(bool prove) => new()
    {
        Search = new SearchOptions { Seed = 1, Chains = 2, MovesPerChain = 20_000 },
        Prove = prove,
        ProofTimeLimit = TimeSpan.FromSeconds(20),
    };

    private static void Ok(IAnsiConsole c, string text) => c.MarkupLine($"[{Ui.GoodM}]{Ui.Tick(c)}[/] {Ui.Esc(text)}");

    private static void Fail(IAnsiConsole c, string text) => c.MarkupLine($"[{Ui.BadM}]{Ui.Cross(c)}[/] {Ui.Esc(text)}");
}
