using System.Text.Json.Nodes;
using UniSlot.Application.Editing;
using UniSlot.Application.Workflow;
using UniSlot.Domain;
using UniSlot.Infrastructure;
using UniSlot.Infrastructure.Export;
using UniSlot.Solver;

namespace UniSlot.Tests;

/// <summary>Folders written by earlier releases (or damaged ones) must load correctly or fail loudly; reverts must refuse unrelated folders.</summary>
public sealed class CompatibilityTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("unislot-compat-").FullName;

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private async Task<(Workspace Space, string Folder)> Publish(string name, ulong seed = 5, int students = 90)
    {
        var settings = new SolveSettings { Search = new SearchOptions { Seed = seed, Chains = 4, MovesPerChain = 300_000 } };
        var outcome = new SolveWorkflow(new AnnealingEngine()).Run(new SolveInput(new SourceInfo("enrol.xlsx", 10, "abc"), TestData.Grid(students, 14, 4, seed: 7)), settings, null, CancellationToken.None);
        string folder = Path.Combine(_dir, name);
        await OutputWriter.WriteAsync(outcome, folder);
        return (await SnapshotStore.ReadAsync(folder), folder);
    }

    private static JsonObject Load(string folder) => (JsonObject)JsonNode.Parse(File.ReadAllText(Path.Combine(folder, "snapshot.json")))!;

    private static void Save(string folder, JsonObject root) => File.WriteAllText(Path.Combine(folder, "snapshot.json"), root.ToJsonString());

    private string Copy(string folder, string name, Action<JsonObject> change)
    {
        string target = Path.Combine(_dir, name);
        Directory.CreateDirectory(target);
        var root = Load(folder);
        change(root);
        Save(target, root);
        return target;
    }

    [Fact]
    public async Task A_snapshot_from_before_weekdays_replaced_time_bands_reads_as_weekdays()
    {
        var (space, folder) = await Publish("base");
        string legacy = Copy(folder, "legacy", root =>
        {
            root.Remove("slot_model");
            root.Remove("schema_version");
            root.Remove("source");
            root.Remove("run_log");
            root.Remove("clash_provenance");
            root.Remove("section_lanes");
            root.Remove("unislot");
            var slots = (JsonObject)root["slot_assignments"]!;
            foreach (var key in slots.Select(kv => kv.Key).ToList()) slots[key] = slots[key]!.GetValue<int>() * 11 + 4;   // band 4 of that day
        });

        var old = await SnapshotStore.ReadAsync(legacy);
        Assert.Equal(space.Days.OrderBy(k => k.Key), old.Days.OrderBy(k => k.Key));
        Assert.Empty(old.RunLog);

        // and it can be edited: nothing else moves
        var row = old.Rows[0];
        var outcome = EditWorkflow.Run(old, Edits.DropCourse(old, row.RegisterNumber, row.CourseCode), null, CancellationToken.None);
        foreach (var (code, day) in space.Days.Where(kv => kv.Key != row.CourseCode || space.Rows.Count(r => r.CourseCode == row.CourseCode) > 1))
            if (outcome.Timetable.TryDayOf(code, out int d)) Assert.Equal(day, d);
    }

    [Fact]
    public async Task An_unknown_slot_model_or_a_section_without_a_weekday_is_refused()
    {
        var (space, folder) = await Publish("base");
        string unknown = Copy(folder, "unknown", root => root["slot_model"] = "future-v9");
        var ex = await Assert.ThrowsAsync<InvalidDataException>(() => SnapshotStore.ReadAsync(unknown));
        Assert.Contains("slot model", ex.Message, StringComparison.Ordinal);

        string victim = space.Sections[0].Id;
        string missing = Copy(folder, "missing", root => ((JsonObject)root["slot_assignments"]!).Remove(victim));
        ex = await Assert.ThrowsAsync<InvalidDataException>(() => SnapshotStore.ReadAsync(missing));
        Assert.Contains(victim, ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Rows_and_sections_that_disagree_fail_with_a_readable_message()
    {
        var (space, folder) = await Publish("base");
        string code = space.Sections[0].CourseCode;
        string mismatched = Copy(folder, "mismatch", root =>
        {
            // a different spelling of the course code in the sections only
            foreach (var node in (JsonArray)((JsonObject)root["courseSections"]!)[code]!)
                node!["course_code"] = code.ToLowerInvariant();
        });
        var ex = await Assert.ThrowsAsync<InvalidDataException>(() => SnapshotStore.ReadAsync(mismatched));
        Assert.Contains("inconsistent", ex.Message, StringComparison.Ordinal);

        string orphan = Copy(folder, "orphan", root =>
        {
            var section = (JsonObject)((JsonArray)((JsonObject)root["courseSections"]!)[code]!)[0]!;
            ((JsonArray)section["enrolled_students"]!).Add("RA-NOT-ENROLLED");
        });
        ex = await Assert.ThrowsAsync<InvalidDataException>(() => SnapshotStore.ReadAsync(orphan));
        Assert.Contains("RA-NOT-ENROLLED", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Revert_refuses_swapped_folders_and_folders_from_different_runs()
    {
        var (original, _) = await Publish("orig");
        var row = original.Rows[0];
        var dropped = EditWorkflow.Run(original, Edits.DropCourse(original, row.RegisterNumber, row.CourseCode), null, CancellationToken.None);
        await OutputWriter.WriteAsync(dropped, Path.Combine(_dir, "edited"));
        var edited = await SnapshotStore.ReadAsync(Path.Combine(_dir, "edited"));

        Assert.Single(Edits.Differences(edited, original));                       // the right way round
        var swapped = Assert.Throws<EditException>(() => Edits.Differences(original, edited));
        Assert.Contains("swapped", swapped.Message, StringComparison.OrdinalIgnoreCase);

        // the same enrollment solved again (different seed, different run) is not an earlier state of the edited folder
        var (other, _) = await Publish("other", seed: 99);
        var different = Assert.Throws<EditException>(() => Edits.Differences(edited, other));
        Assert.Contains("different runs", different.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Revert_warns_when_a_late_or_rectify_run_happened_in_between()
    {
        var (original, _) = await Publish("orig");
        var late = new EnrollmentRow("B.Tech-Computer Science", "RALATE", "late", null, null, original.Days.Keys.First(), "t", null, null, null, null);
        var afterLate = EditWorkflow.Run(original, Edits.Late(original, [late], FullPolicy.NewSection, ClashPolicy.Accept), null, CancellationToken.None);
        await OutputWriter.WriteAsync(afterLate, Path.Combine(_dir, "late"));
        var lateSpace = await SnapshotStore.ReadAsync(Path.Combine(_dir, "late"));

        var row = lateSpace.Rows[0];
        var dropped = EditWorkflow.Run(lateSpace, Edits.DropCourse(lateSpace, row.RegisterNumber, row.CourseCode), null, CancellationToken.None);
        await OutputWriter.WriteAsync(dropped, Path.Combine(_dir, "dropped"));
        var edited = await SnapshotStore.ReadAsync(Path.Combine(_dir, "dropped"));

        // reverting against the folder from before the late run: the history covers a late run
        var plan = Edits.Revert(edited, original, Edits.Differences(edited, original).Where(d => d.Register == row.RegisterNumber).ToList());
        Assert.Contains(plan.Info.Notes, n => n.Contains("late", StringComparison.Ordinal) && n.Contains("Warning", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Parked_registrations_and_capacity_waivers_are_logged_as_objects_like_the_original_tool()
    {
        var grid = TestData.Grid(60, 10, 3, seed: 2);
        for (int i = 0; i < 64; i++)
            grid.Add(["B.Tech-Computer Science", $"RF{i:000}", $"full {i}", null, null, "21FUL001T", "Full Course", null]);
        var (space, _) = await Published(grid);

        var late = new[] { new EnrollmentRow("B.Tech-Computer Science", "RAL1", "late", null, null, "21FUL001T", "Full Course", null, null, null, null) };
        var fit = EditWorkflow.Run(space, Edits.Late(space, late, FullPolicy.Fit, ClashPolicy.Accept), null, CancellationToken.None);
        await OutputWriter.WriteAsync(fit, Path.Combine(_dir, "fit"));
        var log = (JsonArray)Load(Path.Combine(_dir, "fit"))["run_log"]!;
        var waiver = log[^1]!["capacity_waivers"]![0]!;
        Assert.Equal(("21FUL001T", 65, 65), (waiver["section_id"]!.GetValue<string>(), waiver["enrollment"]!.GetValue<int>(), waiver["capacity"]!.GetValue<int>()));

        var park = EditWorkflow.Run(space, Edits.Late(space, [.. late, late[0] with { RegisterNumber = "RAL2", CourseCode = "21CS001T", CourseTitle = "x" }], FullPolicy.Park, ClashPolicy.Accept), null, CancellationToken.None);
        await OutputWriter.WriteAsync(park, Path.Combine(_dir, "park"));
        var parked = ((JsonArray)Load(Path.Combine(_dir, "park"))["run_log"]!)[^1]!["parked"]![0]!;
        Assert.Equal("RAL1", parked["register_number"]!.GetValue<string>());
        Assert.Contains("full", parked["reason"]!.GetValue<string>(), StringComparison.OrdinalIgnoreCase);
    }

    private async Task<(Workspace, string)> Published(List<IReadOnlyList<string?>> grid)
    {
        var outcome = new SolveWorkflow(new AnnealingEngine()).Run(new SolveInput(new SourceInfo("enrol.xlsx", 10, "abc"), grid),
            new SolveSettings { Search = new SearchOptions { Seed = 5, Chains = 4, MovesPerChain = 300_000 } }, null, CancellationToken.None);
        string folder = Path.Combine(_dir, "grid-" + Guid.NewGuid().ToString("N")[..6]);
        await OutputWriter.WriteAsync(outcome, folder);
        return (await SnapshotStore.ReadAsync(folder), folder);
    }
}
