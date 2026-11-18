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
        root["run_log"] = new JsonArray(RunLogEntry(o, at));
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

    private static JsonNode RunLogEntry(SolveOutcome o, DateTimeOffset at) => new JsonObject
    {
        ["seq"] = 1,
        ["at"] = at.ToString("O", CultureInfo.InvariantCulture),
        ["mode"] = "solve",
        ["inputs"] = new JsonObject(),
        ["seed"] = (long)o.Search.Options.Seed,
        ["solver_status"] = o.RedProvenOptimal ? "OPTIMAL" : "FEASIBLE",
        ["students_before"] = 0,
        ["students_after"] = o.Roster.Students.Count,
        ["students_added"] = o.Roster.Students.Count,
        ["registrations_added"] = o.Roster.Rows.Count,
        ["courses_added"] = o.Roster.Courses.Count,
        ["sections_created"] = new JsonArray(),
        ["students_moved_between_sections"] = 0,
        ["capacity_waivers"] = new JsonArray(),
        ["parked"] = new JsonArray(),
        ["red_before"] = 0,
        ["red_after"] = o.RedStudents,
        ["clashes_introduced"] = o.Clash.Students.Sum(s => s.Pairs.Count),
        ["clashes_resolved"] = 0,
        ["decisions"] = new JsonArray(),
        ["notes"] = new JsonArray(),
    };
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
