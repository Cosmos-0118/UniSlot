using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using UniSlot.Application.Workflow;
using UniSlot.Domain;

namespace UniSlot.Infrastructure.Export;

/// <summary>
/// <c>snapshot.json</c> keeps the schema-2 layout that earlier UniSlot releases wrote, so output folders stay interchangeable, and adds a
/// <c>unislot</c> block describing the engine and reproduction token.
/// </summary>
internal static class SnapshotJson
{
    public const string ObjectivePolicy = "red-first-v1";
    public const int SchemaVersion = 2;

    public static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static JsonObject Build(SolveOutcome o, DateTimeOffset at)
    {
        var sectionDays = o.Timetable.SectionDays(o.Sections);
        var slotAssignments = new JsonObject();
        foreach (var s in o.Sections) slotAssignments[s.Id] = sectionDays[s.Id];

        var courseSections = new JsonObject();
        foreach (var group in o.Sections.GroupBy(s => s.CourseCode, StringComparer.Ordinal))
            courseSections[group.Key] = new JsonArray([.. group.Select(SectionNode)]);

        var students = new JsonObject();
        foreach (var s in o.Roster.Students)
            students[s.RegisterNumber] = new JsonObject
            {
                ["register_number"] = s.RegisterNumber,
                ["name"] = s.Name,
                ["program"] = s.Program,
                ["email"] = s.Email,
                ["mobile"] = s.Mobile,
                ["enrolled_courses"] = new JsonArray([.. s.Courses.Select(c => (JsonNode?)JsonValue.Create(c))]),
            };

        var rows = new JsonArray([.. o.Roster.Rows.Select(r => (JsonNode?)new JsonObject
        {
            ["program"] = r.Program,
            ["register_number"] = r.RegisterNumber,
            ["student_name"] = r.StudentName,
            ["mobile_number"] = r.Mobile,
            ["email_id"] = r.Email,
            ["course_code"] = r.CourseCode,
            ["course_title"] = r.CourseTitle,
            ["faculty"] = r.Faculty,
            ["registration_type"] = r.RegistrationType,
            ["remarks"] = r.Remarks,
            ["adl_remarks"] = r.AdditionalRemarks,
        })]);

        var lanes = new JsonObject();
        foreach (var e in o.Schedule) lanes[e.SectionId] = e.Lane;

        var search = o.Search.Options;
        var root = new JsonObject
        {
            ["objective_policy"] = ObjectivePolicy,
            ["schema_version"] = SchemaVersion,
            ["source"] = new JsonObject { ["file_name"] = o.Source.FileName, ["sha256"] = o.Source.Sha256, ["bytes"] = o.Source.Bytes },
            ["slot_model"] = "weekday-v2",
            ["slot_assignments"] = slotAssignments,
            ["courseSections"] = courseSections,
            ["students"] = students,
            ["enrollmentRows"] = rows,
            ["allowSaturdayForMath"] = o.Settings.Policy.AllowSaturdayForMaths,
        };
        if (o.Settings.Policy.SaturdayExtraCourses.Count > 0)
            root["saturdayExtraCourseCodes"] = new JsonArray([.. o.Settings.Policy.SaturdayExtraCourses.Order(StringComparer.Ordinal).Select(c => (JsonNode?)JsonValue.Create(c))]);
        root["seed"] = (long)search.Seed;
        root["workers"] = search.Chains;
        root["portfolio"] = 0;
        root["section_lanes"] = lanes;
        root["run_log"] = RunLog(o, at);
        root["clash_provenance"] = new JsonObject();
        root["unislot"] = new JsonObject
        {
            ["generator"] = "UniSlot 2",
            ["engine"] = o.Search.Engine,
            ["proof_engine"] = o.Proof?.Engine,
            ["repro_token"] = search.ReproToken,
            ["reproducible"] = search.IsReproducible,
            ["chains"] = search.Chains,
            ["moves_per_chain"] = search.MovesPerChain,
            ["generated_at"] = at.ToString("O", CultureInfo.InvariantCulture),
        };
        return root;
    }

    private static JsonNode SectionNode(Section s) => new JsonObject
    {
        ["section_id"] = s.Id,
        ["course_code"] = s.CourseCode,
        ["course_title"] = s.CourseTitle,
        ["section_number"] = s.Number,
        ["faculty"] = s.Faculty,
        ["capacity"] = s.Capacity,
        ["enrolled_students"] = new JsonArray([.. s.Students.Select(x => (JsonNode?)JsonValue.Create(x))]),
        ["programs"] = new JsonArray([.. s.Programs.Select(x => (JsonNode?)JsonValue.Create(x))]),
    };

    internal static JsonNode? WaiverNode(WaiverItem w) => new JsonObject { ["section_id"] = w.SectionId, ["enrollment"] = w.Enrollment, ["capacity"] = w.Capacity };

    internal static JsonNode? ParkedNode(ParkedItem p) => new JsonObject { ["register_number"] = p.Register, ["course_code"] = p.Course, ["reason"] = p.Reason };

    private static JsonArray RunLog(SolveOutcome o, DateTimeOffset at)
    {
        var log = new JsonArray();
        if (o.Settings.Edit is { } edit)
            foreach (string prior in edit.PriorRunLog)
                if (JsonNode.Parse(prior) is { } node) log.Add(node);
        log.Add(RunLogEntry(o, at, log.Count + 1));
        return log;
    }

    private static JsonObject RunLogEntry(SolveOutcome o, DateTimeOffset at, int seq)
    {
        var edit = o.Settings.Edit;
        var delta = edit?.PreviousClash is { } before ? ClashDiff.Compare(before, o.Clash) : null;
        int studentsBefore = edit?.StudentsBefore ?? 0;
        return new JsonObject
        {
            ["seq"] = seq,
            ["at"] = at.ToString("O", CultureInfo.InvariantCulture),
            ["mode"] = edit?.Mode ?? "solve",
            ["inputs"] = new JsonObject([.. (edit?.Inputs ?? new Dictionary<string, string>()).Select(kv => KeyValuePair.Create(kv.Key, (JsonNode?)JsonValue.Create(kv.Value)))]),
            ["seed"] = (long)o.Search.Options.Seed,
            ["solver_status"] = o.RedProvenOptimal ? "OPTIMAL" : "FEASIBLE",
            ["students_before"] = studentsBefore,
            ["students_after"] = o.Roster.Students.Count,
            ["students_added"] = Math.Max(0, o.Roster.Students.Count - studentsBefore),
            ["registrations_added"] = edit?.RegistrationsAdded ?? o.Roster.Rows.Count,
            ["registrations_removed"] = edit?.RegistrationsRemoved ?? 0,
            ["courses_added"] = edit?.CoursesAdded ?? o.Roster.Courses.Count,
            ["sections_created"] = new JsonArray([.. (edit?.SectionsCreated ?? []).Select(x => (JsonNode?)JsonValue.Create(x))]),
            ["students_moved_between_sections"] = 0,
            ["capacity_waivers"] = new JsonArray([.. (edit?.Waivers ?? []).Select(WaiverNode)]),
            ["parked"] = new JsonArray([.. (edit?.Parked ?? []).Select(ParkedNode)]),
            ["red_before"] = edit?.PreviousClash?.StudentsWithClashes ?? 0,
            ["red_after"] = o.RedStudents,
            ["clashes_introduced"] = delta?.Introduced.Count ?? o.Clash.Students.Sum(s => s.Pairs.Count),
            ["clashes_resolved"] = delta?.Resolved.Count ?? 0,
            ["decisions"] = new JsonArray(),
            ["notes"] = new JsonArray([.. (edit?.Notes ?? []).Select(x => (JsonNode?)JsonValue.Create(x))]),
        };
    }
}

/// <summary>The human-readable record of one edit run: <c>late-enrollment-report.json</c>, <c>fix-report.json</c>, <c>rectify-report.json</c>, <c>revert-report.json</c>.</summary>
internal static class EditReportJson
{
    public static string FileName(string mode) => mode switch
    {
        "late" => "late-enrollment-report.json",
        "rectify" => "rectify-report.json",
        "revert" => "revert-report.json",
        _ => "fix-report.json",
    };

    public static JsonObject Build(SolveOutcome o)
    {
        var edit = o.Settings.Edit!;
        var delta = edit.PreviousClash is { } before ? ClashDiff.Compare(before, o.Clash) : null;
        static JsonArray Entries(IEnumerable<ClashEntry>? e) => new([.. (e ?? []).Select(x => (JsonNode?)new JsonObject
        {
            ["register_number"] = x.Register,
            ["student_name"] = x.Name,
            ["day"] = x.Day.ToString(),
            ["courses"] = new JsonArray([.. x.Courses.Select(c => (JsonNode?)JsonValue.Create(c))]),
        })]);
        return new JsonObject
        {
            ["mode"] = edit.Mode,
            ["inputs"] = new JsonObject([.. edit.Inputs.Select(kv => KeyValuePair.Create(kv.Key, (JsonNode?)JsonValue.Create(kv.Value)))]),
            ["red_before"] = edit.PreviousClash?.StudentsWithClashes,
            ["red_after"] = o.RedStudents,
            ["clash_weight"] = o.ClashWeight,
            ["hard_constraints_ok"] = o.Audit.IsStructurallyFeasible,
            ["registrations_added"] = edit.RegistrationsAdded,
            ["registrations_removed"] = edit.RegistrationsRemoved,
            ["courses_added"] = edit.CoursesAdded,
            ["sections_created"] = new JsonArray([.. edit.SectionsCreated.Select(x => (JsonNode?)JsonValue.Create(x))]),
            ["capacity_waivers"] = new JsonArray([.. edit.Waivers.Select(SnapshotJson.WaiverNode)]),
            ["parked"] = new JsonArray([.. edit.Parked.Select(SnapshotJson.ParkedNode)]),
            ["notes"] = new JsonArray([.. edit.Notes.Select(x => (JsonNode?)JsonValue.Create(x))]),
            ["changes"] = new JsonArray([.. edit.Changes.Select(c => (JsonNode?)new JsonObject
            {
                ["register_number"] = c.Register, ["student_name"] = c.Name, ["course_code"] = c.Course, ["kind"] = c.Kind, ["detail"] = c.Detail,
            })]),
            ["new_clashes"] = Entries(delta?.Introduced),
            ["carried_over_clashes"] = Entries(delta?.CarriedOver),
            ["resolved_clashes"] = Entries(delta?.Resolved),
        };
    }
}

internal static class SummaryJson
{
    public static JsonObject Build(SolveOutcome o)
    {
        var b = o.Bounds;
        var search = o.Search.Options;
        var status = o.RedProvenOptimal ? "OPTIMAL" : "FEASIBLE";
        var summary = new JsonObject
        {
            ["status"] = status,
            ["mode"] = o.Settings.Edit?.Mode ?? "solve",
            ["objective_policy"] = SnapshotJson.ObjectivePolicy,
            ["proven_optimal"] = o.RedProvenOptimal,
            ["red_students"] = o.RedStudents,
            ["clash_weight"] = o.ClashWeight,
            ["red_bound"] = o.Proof?.RedLowerBound ?? b.MinRedStudents,
            ["red_gap"] = o.RedStudents - (o.Proof?.RedLowerBound ?? b.MinRedStudents),
            ["hard_constraints_ok"] = o.Audit.IsStructurallyFeasible,
            ["hard_constraint_violations"] = new JsonArray([.. o.Audit.Structural.Select(v => (JsonNode?)JsonValue.Create(v.Detail))]),
            ["lower_bounds"] = new JsonObject
            {
                ["max_clique_size"] = b.MaxCliqueSize,
                ["available_colors"] = b.AvailableColors,
                ["min_red_students_lower_bound"] = b.MinRedStudents,
                ["min_clash_weight_lower_bound"] = b.MinClashWeight,
                ["zero_clash_structurally_impossible"] = b.ZeroClashImpossible,
                ["zero_red_structurally_impossible"] = b.ZeroRedImpossible,
            },
            ["solver_used"] = o.Search.Engine + (o.Proof is null ? "" : " + " + o.Proof.Engine),
            ["solver_time_seconds"] = Math.Round(o.Timings.GetValueOrDefault("search").TotalSeconds + o.Timings.GetValueOrDefault("proof").TotalSeconds, 3),
            ["seed"] = (long)search.Seed,
            ["workers"] = search.Chains,
            ["portfolio"] = 0,
            ["moves_per_chain"] = search.MovesPerChain,
            ["reproducible"] = search.IsReproducible,
            ["repro_token"] = search.ReproToken,
            ["allow_saturday_for_math"] = o.Settings.Policy.AllowSaturdayForMaths,
            ["saturday_extra_course_codes"] = new JsonArray([.. o.Settings.Policy.SaturdayExtraCourses.Order(StringComparer.Ordinal).Select(c => (JsonNode?)JsonValue.Create(c))]),
            ["timings_seconds"] = new JsonObject([.. o.Timings.Select(t => KeyValuePair.Create(t.Key, (JsonNode?)JsonValue.Create(Math.Round(t.Value.TotalSeconds, 3))))]),
        };
        if (o.Proof is { } p)
        {
            summary["proof"] = new JsonObject
            {
                ["status"] = p.Status.ToString(),
                ["red_lower_bound"] = p.RedLowerBound,
                ["red_proven"] = p.RedProven,
                ["clash_lower_bound"] = p.ClashLowerBound,
                ["clash_proven"] = p.ClashProven,
                ["seconds"] = Math.Round(p.Elapsed.TotalSeconds, 3),
            };
        }
        return summary;
    }
}
