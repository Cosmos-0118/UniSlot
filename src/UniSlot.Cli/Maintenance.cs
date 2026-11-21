using Spectre.Console;
using UniSlot.Application.Editing;
using UniSlot.Application.Importing;
using UniSlot.Application.Workflow;
using UniSlot.Domain;
using UniSlot.Infrastructure;
using UniSlot.Infrastructure.Export;

namespace UniSlot.Cli;

/// <summary>A published timetable plus the edit to apply to it, before anything is written.</summary>
internal sealed record Prepared(Workspace Before, EditPlan Plan);

internal sealed record FilterResult(string Path, int KeptCourses, int KeptSections, IReadOnlyList<string> Missing);

/// <summary>The maintenance operations behind both the scripted commands and the interactive screens.</summary>
internal static class Maintenance
{
    public static async Task<IReadOnlyList<EnrollmentRow>> ReadRowsAsync(string workbook, CancellationToken ct)
    {
        var input = await XlsxEnrollmentSource.ReadAsync(workbook, ct).ConfigureAwait(false);
        var result = RosterBuilder.Build(EnrollmentParser.Parse(input.Grid));
        return result.Roster?.Rows ?? throw new InputRejectedException(result.Validation);
    }

    public static async Task<Prepared> PrepareLate(string previous, string lateFile, FullPolicy onFull, ClashPolicy onClash, CancellationToken ct)
    {
        var ws = await SnapshotStore.ReadAsync(previous, ct).ConfigureAwait(false);
        var rows = await ReadRowsAsync(lateFile, ct).ConfigureAwait(false);
        return new Prepared(ws, Edits.Late(ws, rows, onFull, onClash));
    }

    public static async Task<Prepared> PrepareRectify(string previous, string workbook, CancellationToken ct)
    {
        var ws = await SnapshotStore.ReadAsync(previous, ct).ConfigureAwait(false);
        var input = await XlsxEnrollmentSource.ReadAsync(workbook, ct).ConfigureAwait(false);
        return new Prepared(ws, Edits.Rectify(ws, input.Grid));
    }

    public static async Task<Prepared> PrepareDrop(string previous, string register, string course, CancellationToken ct)
    {
        var ws = await SnapshotStore.ReadAsync(previous, ct).ConfigureAwait(false);
        return new Prepared(ws, Edits.DropCourse(ws, register, course));
    }

    public static async Task<Prepared> PrepareFix(string previous, string register, string from, string to, string? title, CancellationToken ct)
    {
        var ws = await SnapshotStore.ReadAsync(previous, ct).ConfigureAwait(false);
        return new Prepared(ws, Edits.FixCourse(ws, register, from, to, title));
    }

    public static async Task<(Workspace Edited, Workspace Previous, IReadOnlyList<RegistrationChange> Differences)> LoadRevert(string edited, string previous, CancellationToken ct)
    {
        EnsureDifferent(edited, previous);
        var e = await SnapshotStore.ReadAsync(edited, ct).ConfigureAwait(false);
        var p = await SnapshotStore.ReadAsync(previous, ct).ConfigureAwait(false);
        return (e, p, Edits.Differences(e, p));
    }

    public static Prepared PrepareRevert(Workspace edited, Workspace previous, IReadOnlyList<RegistrationChange> selected) =>
        new(edited, Edits.Revert(edited, previous, selected));

    public static IReadOnlyList<RegistrationChange> Select(IReadOnlyList<RegistrationChange> all, string[] registers, string[] courses, bool everything)
    {
        if (everything) return all;
        var regs = registers.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var codes = courses.ToHashSet(StringComparer.OrdinalIgnoreCase);
        return [.. all.Where(c => regs.Contains(c.Register) || codes.Contains(c.Course) || (c.ToCourse is not null && codes.Contains(c.ToCourse)))];
    }

    /// <summary>Audits the edit with the same checks as a fresh solve and writes the full output folder.</summary>
    public static async Task<SolveRun> ApplyAsync(Prepared p, string outFolder, string? institution, ProgressSink? sink, CancellationToken ct)
    {
        var clock = System.Diagnostics.Stopwatch.StartNew();
        EnsureOutputFolder(outFolder);
        IProgress<SolveProgress>? progress = sink is null ? null : new Progress<SolveProgress>(sink.Report);
        var outcome = await EditWorkflow.RunAsync(p.Before, p.Plan, progress, ct).ConfigureAwait(false);
        sink?.Enter(ProgressSink.Saving);
        var files = await OutputWriter.WriteAsync(outcome, outFolder, new ExportOptions { Institution = string.IsNullOrWhiteSpace(institution) ? null : institution }, ct).ConfigureAwait(false);
        sink?.Finish();
        return new SolveRun(outcome, files, outFolder, clock.Elapsed);
    }

    public static void EnsureDifferent(string a, string b)
    {
        if (string.Equals(Path.GetFullPath(a).TrimEnd('\\', '/'), Path.GetFullPath(b).TrimEnd('\\', '/'), StringComparison.OrdinalIgnoreCase))
            throw new EditException("Choose two different folders.");
    }

    /// <summary>An edit never overwrites the timetable it started from.</summary>
    public static void EnsureOutputFolder(string outFolder)
    {
        if (SnapshotStore.IsOutputFolder(outFolder) && Directory.EnumerateFileSystemEntries(outFolder).Any())
            throw new EditException($"{outFolder} already holds a timetable. Choose a new folder so the original stays untouched.");
    }

    public static async Task<(string Path, int Rows)> NameListAsync(string folder, string outDir, CancellationToken ct)
    {
        var ws = await SnapshotStore.ReadAsync(folder, ct).ConfigureAwait(false);
        if (ws.Rows.Count == 0) throw new EditException("snapshot.json has no enrollment rows.");
        return (await OutputWriter.WriteNameListAsync(ws.Rows, outDir, ct).ConfigureAwait(false), ws.Rows.Count);
    }

    public static async Task<FilterResult> FilterAsync(string folder, IEnumerable<string> codes, string outDir, string? institution, CancellationToken ct)
    {
        var ws = await SnapshotStore.ReadAsync(folder, ct).ConfigureAwait(false);
        var (filtered, missing) = Edits.Filter(ws, codes);
        var outcome = await EditWorkflow.RunAsync(filtered, new EditPlan(filtered, new EditInfo { Mode = "filter" }), null, ct).ConfigureAwait(false);
        string path = await OutputWriter.WriteScheduleOnlyAsync(outcome, outDir, new ExportOptions { Institution = string.IsNullOrWhiteSpace(institution) ? null : institution }, ct).ConfigureAwait(false);
        return new FilterResult(path, filtered.Days.Count, filtered.Sections.Count, missing);
    }

    // ---- scripted commands -------------------------------------------------------------------------------------------------
    public static async Task<int> RunScripted(IAnsiConsole c, EditOptions o, bool rich, CancellationToken ct)
    {
        switch (o.Mode)
        {
            case EditOptions.Issues:
                {
                    var input = await XlsxEnrollmentSource.ReadAsync(o.Input!, ct);
                    var report = IssueFinder.Find(input.Grid);
                    if (rich) EditView.Issues(c, report, input.Source.FileName); else EditView.IssuesPlain(Console.Out, report, input.Source.FileName);
                    return report.HasBlocking ? 1 : 0;
                }
            case EditOptions.NameList:
                {
                    var (path, rows) = await NameListAsync(o.SourceFolder!, o.DefaultOutput, ct);
                    Console.WriteLine($"{rows:N0} rows written to {path}");
                    return 0;
                }
            case EditOptions.Filter:
                {
                    var r = await FilterAsync(o.SourceFolder!, o.Courses, o.DefaultOutput, o.Institution, ct);
                    Console.WriteLine($"Kept {r.KeptCourses} course(s) in {r.KeptSections} section(s) → {r.Path}");
                    if (r.Missing.Count > 0) Console.WriteLine($"Not on the schedule: {string.Join(", ", r.Missing)}");
                    return 0;
                }
        }

        string output = o.DefaultOutput;
        var sink = rich ? new ProgressSink() : null;
        async Task<SolveRun> Work()
        {
            sink?.Enter(ProgressSink.Reading);
            var prepared = await Prepare(o, ct);
            if (o.Previous is not null) EnsureDifferent(o.Previous, output);
            if (o.Edited is not null) EnsureDifferent(o.Edited, output);
            return await ApplyAsync(prepared, output, o.Institution, sink, ct);
        }

        SolveRun run;
        if (rich)
        {
            Ui.Banner(c);
            run = await RunView.ShowAsync(c, sink!, false, o.Mode, Task.Run(Work, ct));
            EditView.Show(c, run);
            ResultsView.Dashboard(c, run);
        }
        else
        {
            run = await Work();
            EditView.Plain(Console.Out, run, o.Limit);
        }
        Program.ShowTables(c, o.Show, o.Limit, run.Outcome);
        return run.Outcome.Audit.IsStructurallyFeasible ? 0 : 3;
    }

    private static async Task<Prepared> Prepare(EditOptions o, CancellationToken ct)
    {
        switch (o.Mode)
        {
            case EditOptions.Late: return await PrepareLate(o.Previous!, o.LateFile!, o.OnFull, o.OnClash, ct);
            case EditOptions.Rectify: return await PrepareRectify(o.Previous!, o.RectifiedFile!, ct);
            case EditOptions.DropCourse: return await PrepareDrop(o.Previous!, o.Registers[0], o.Courses[0], ct);
            case EditOptions.FixCourse: return await PrepareFix(o.Previous!, o.Registers[0], o.From!, o.To!, o.ToTitle, ct);
            default:
                {
                    var (edited, previous, diff) = await LoadRevert(o.Edited!, o.Previous!, ct);
                    var chosen = Select(diff, o.Registers, o.Courses, o.All);
                    if (chosen.Count == 0) throw new EditException(diff.Count == 0 ? "The two folders hold the same registrations: nothing to undo." : "None of the differences match the register numbers or course codes given.");
                    return PrepareRevert(edited, previous, chosen);
                }
        }
    }
}
