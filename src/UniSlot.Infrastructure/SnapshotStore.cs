using System.Text.Json;
using System.Text.Json.Nodes;
using UniSlot.Application.Editing;
using UniSlot.Application.Workflow;
using UniSlot.Domain;

namespace UniSlot.Infrastructure;

/// <summary>What a saved output folder says about itself, without rebuilding the schedule.</summary>
public sealed record FolderInfo(string Path, string SourceName, int Students, int Courses, int? RedStudents, DateTime Modified);

/// <summary>Reads a saved output folder (<c>snapshot.json</c>) back into an editable <see cref="Workspace"/>. Snapshots from the original tool use the same field names (band-numbered ones from before weekdays are converted); unknown or inconsistent ones are refused with a readable message.</summary>
public static class SnapshotStore
{
    public const string SnapshotFile = "snapshot.json";

    public static bool IsOutputFolder(string folder) => Directory.Exists(folder) && File.Exists(System.IO.Path.Combine(folder, SnapshotFile));

    public static async Task<Workspace> ReadAsync(string folder, CancellationToken ct = default)
    {
        string path = System.IO.Path.Combine(folder, SnapshotFile);
        if (!File.Exists(path)) throw new FileNotFoundException($"{folder} is not a UniSlot output folder: snapshot.json is missing.");
        JsonNode? root;
        try { root = JsonNode.Parse(await File.ReadAllBytesAsync(path, ct).ConfigureAwait(false)); }
        catch (JsonException ex) { throw new InvalidDataException($"snapshot.json in {folder} is damaged: {ex.Message}", ex); }
        return Parse(root as JsonObject ?? throw new InvalidDataException($"snapshot.json in {folder} is not a snapshot."));
    }

    public static Workspace Parse(JsonObject root)
    {
        try
        {
            var rows = (root["enrollmentRows"] as JsonArray ?? throw new InvalidDataException("snapshot.json has no enrollment rows."))
                .OfType<JsonObject>()
                .Select(r => new EnrollmentRow(Str(r, "program") ?? "", Str(r, "register_number") ?? "", Str(r, "student_name") ?? "", Str(r, "mobile_number"),
                    Str(r, "email_id"), Str(r, "course_code") ?? "", Str(r, "course_title") ?? "", Str(r, "faculty"), Str(r, "registration_type"),
                    Str(r, "remarks"), Str(r, "adl_remarks")))
                .ToList();

            var slots = root["slot_assignments"] as JsonObject ?? throw new InvalidDataException("snapshot.json has no weekday assignments.");
            // Runs saved before weekdays replaced intra-day time bands hold band numbers (11 per day); newer ones hold weekday indices.
            string? slotModel = Str(root, "slot_model");
            bool legacyBands = slotModel is null;
            if (slotModel is not null && slotModel != "weekday-v2")
                throw new InvalidDataException($"snapshot.json uses an unknown slot model '{slotModel}' and cannot be read safely.");
            var sections = new List<Section>();
            var days = new Dictionary<string, int>(StringComparer.Ordinal);
            foreach (var (code, node) in root["courseSections"] as JsonObject ?? throw new InvalidDataException("snapshot.json has no sections."))
            {
                foreach (var s in (node as JsonArray ?? []).OfType<JsonObject>())
                {
                    string id = Str(s, "section_id") ?? throw new InvalidDataException("A section has no id.");
                    sections.Add(new Section(id, Str(s, "course_code") ?? code, Str(s, "course_title") ?? "", s["section_number"]?.GetValue<int>() ?? 1,
                        Str(s, "faculty"), s["capacity"]?.GetValue<int>() ?? 60, Strings(s["enrolled_students"]), Strings(s["programs"])));
                    if (slots[id] is not { } d) throw new InvalidDataException($"snapshot.json gives section {id} no weekday, so the timetable cannot be edited safely.");
                    int day = legacyBands ? Math.Clamp(d.GetValue<int>() / 11, 0, 5) : d.GetValue<int>();
                    if (day is < 0 or > 5) throw new InvalidDataException($"snapshot.json places section {id} on weekday {day}, which does not exist.");
                    if (days.TryGetValue(code, out int known) && known != day)
                        throw new InvalidDataException($"snapshot.json places the sections of {code} on different weekdays.");
                    days[code] = day;
                }
            }

            var extras = Strings(root["saturdayExtraCourseCodes"]);
            var policy = new SchedulePolicy
            {
                AllowSaturdayForMaths = root["allowSaturdayForMath"]?.GetValue<bool>() ?? false,
                SaturdayExtraCourses = SchedulePolicy.NormalizeCodes(extras),
            };
            var src = root["source"] as JsonObject;
            var source = new SourceInfo(Str(src, "file_name") ?? "snapshot.json", src?["bytes"]?.GetValue<long>() ?? 0, Str(src, "sha256") ?? "");
            var workspace = new Workspace
            {
                Source = source, Policy = policy, Rows = rows, Sections = sections, Days = days,
                Seed = root["seed"] is { } seed ? (ulong)Math.Max(0, seed.GetValue<long>()) : 1,
                Chains = Math.Max(1, root["workers"]?.GetValue<int>() ?? 12),
                RunLog = [.. (root["run_log"] as JsonArray ?? []).Where(n => n is not null).Select(n => n!.ToJsonString())],
            };
            workspace.Validate();
            return workspace;
        }
        catch (Exception ex) when (ex is InvalidOperationException or FormatException or KeyNotFoundException)
        {
            throw new InvalidDataException($"snapshot.json could not be read: {ex.Message}", ex);
        }
    }

    /// <summary>Output folders worth offering: those with a snapshot, newest first.</summary>
    public static IReadOnlyList<FolderInfo> Discover(IEnumerable<string> roots, int max = 12)
    {
        var found = new Dictionary<string, FolderInfo>(StringComparer.OrdinalIgnoreCase);
        foreach (string root in roots.Where(r => !string.IsNullOrWhiteSpace(r) && Directory.Exists(r)))
        {
            try
            {
                var candidates = new List<string> { root };
                candidates.AddRange(Directory.EnumerateDirectories(root));
                foreach (string dir in candidates)
                {
                    string full = System.IO.Path.GetFullPath(dir);
                    if (!IsOutputFolder(full) || found.ContainsKey(full)) continue;
                    found[full] = Describe(full);
                }
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { /* skip unreadable folders */ }
        }
        return [.. found.Values.OrderByDescending(f => f.Modified).Take(max)];
    }

    public static FolderInfo Describe(string folder)
    {
        string snap = System.IO.Path.Combine(folder, SnapshotFile);
        string source = "";
        int students = 0, courses = 0;
        int? red = null;
        try
        {
            string summary = System.IO.Path.Combine(folder, "summary.json");
            if (File.Exists(summary) && JsonNode.Parse(File.ReadAllText(summary)) is JsonObject s) red = s["red_students"]?.GetValue<int>();
            using var doc = JsonDocument.Parse(File.ReadAllBytes(snap));
            var r = doc.RootElement;
            if (r.TryGetProperty("source", out var src) && src.TryGetProperty("file_name", out var fn)) source = fn.GetString() ?? "";
            if (r.TryGetProperty("students", out var st)) students = st.EnumerateObject().Count();
            if (r.TryGetProperty("courseSections", out var cs)) courses = cs.EnumerateObject().Count();
        }
        catch (Exception ex) when (ex is IOException or JsonException or InvalidOperationException) { /* show what we have */ }
        return new FolderInfo(folder, source, students, courses, red, File.GetLastWriteTime(snap));
    }

    private static string? Str(JsonObject? o, string key) => o?[key] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    private static string[] Strings(JsonNode? node) => node is JsonArray a ? [.. a.Select(n => n?.GetValue<string>() ?? "").Where(s => s.Length > 0)] : [];
}
