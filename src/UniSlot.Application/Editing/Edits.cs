using UniSlot.Application.Importing;
using UniSlot.Application.Planning;
using UniSlot.Application.Workflow;
using UniSlot.Domain;

namespace UniSlot.Application.Editing;

/// <summary>A request the edit cannot satisfy (unknown student, course already held, unrelated folders …). The message is for the user.</summary>
public sealed class EditException(string message) : Exception(message);

/// <summary>The edited state plus what was done, ready for <see cref="EditWorkflow"/>.</summary>
public sealed record EditPlan(Workspace Workspace, EditInfo Info);

public enum RegistrationChangeKind { Removed, Added, Moved }

/// <summary>One difference between an edited folder and an earlier one. A <c>Moved</c> change pairs the removed and the added course of one student.</summary>
public sealed record RegistrationChange(string Register, string Name, RegistrationChangeKind Kind, string Course, string? ToCourse, string Title)
{
    public string Describe() => Kind switch
    {
        RegistrationChangeKind.Removed => $"{Course} removed",
        RegistrationChangeKind.Added => $"{Course} added",
        _ => $"{Course} → {ToCourse}",
    };
}

public static class Edits
{
    // ---- late enrollment ---------------------------------------------------------------------------------------------------
    /// <summary>
    /// Adds late registrations without moving anything published. Rows already on the schedule are skipped, so the late file may be a delta or
    /// the full updated workbook. Courses that already have a weekday keep it; brand-new courses are left for the solver to place.
    /// </summary>
    public static EditPlan Late(Workspace previous, IReadOnlyList<EnrollmentRow> lateRows, FullPolicy onFull, ClashPolicy onClash)
    {
        var ws = previous.Clone();
        var have = new HashSet<(string, string)>(previous.Rows.Select(r => (r.RegisterNumber, r.CourseCode)));
        var fresh = new List<EnrollmentRow>();
        var seen = new HashSet<(string, string)>();
        int alreadyThere = 0;
        foreach (var r in lateRows)
        {
            if (have.Contains((r.RegisterNumber, r.CourseCode)) || !seen.Add((r.RegisterNumber, r.CourseCode))) { alreadyThere++; continue; }
            fresh.Add(r);
        }
        if (fresh.Count == 0) throw new EditException("The late file has no new registrations: every row is already on the schedule.");

        var changes = new List<EditChange>();
        var parked = new List<ParkedItem>();
        var created = new List<string>();
        var waivers = new List<WaiverItem>();
        var newCourses = new HashSet<string>(StringComparer.Ordinal);
        int added = 0;

        foreach (var group in fresh.GroupBy(r => r.RegisterNumber, StringComparer.Ordinal))
        {
            var rows = group.ToList();
            string name = rows[0].StudentName;
            if (onClash == ClashPolicy.ParkStudent && WouldClash(ws, group.Key, rows, out string why))
            {
                foreach (var r in rows)
                {
                    parked.Add(new ParkedItem(group.Key, r.CourseCode, why));
                    changes.Add(new EditChange(group.Key, name, r.CourseCode, "parked", why));
                }
                continue;
            }
            foreach (var r in rows)
            {
                bool courseWasNew = !ws.HasCourse(r.CourseCode);
                var res = ws.Add(r, onFull);
                switch (res.Kind)
                {
                    case PlacementKind.Parked:
                        parked.Add(new ParkedItem(r.RegisterNumber, r.CourseCode, res.Reason ?? ""));
                        changes.Add(new EditChange(r.RegisterNumber, name, r.CourseCode, "parked", res.Reason ?? ""));
                        break;
                    default:
                        added++;
                        if (courseWasNew) newCourses.Add(r.CourseCode);
                        if (res.Kind == PlacementKind.NewSection && !created.Contains(res.SectionId!)) created.Add(res.SectionId!);
                        if (res.Kind == PlacementKind.Overfilled)
                        {
                            var over = ws.Sections.First(x => x.Id == res.SectionId);
                            waivers.Add(new WaiverItem(over.Id, over.Students.Count, over.Capacity));
                        }
                        changes.Add(new EditChange(r.RegisterNumber, name, r.CourseCode, "added", Describe(res)));
                        break;
                }
            }
        }

        var notes = new List<string>();
        if (alreadyThere > 0) notes.Add($"{alreadyThere} row(s) were already on the schedule and were skipped.");
        if (newCourses.Count > 0) notes.Add($"New course(s) placed by the solver: {string.Join(", ", newCourses.Order(StringComparer.Ordinal))}.");
        if (created.Count > 0) notes.Add($"New section(s) opened: {string.Join(", ", created)}.");
        if (parked.Count > 0) notes.Add($"{parked.Count} registration(s) were parked and are not on the schedule.");
        if (waivers.Count > 0) notes.Add($"{waivers.Count} registration(s) were placed over capacity (waiver).");

        return new EditPlan(ws, new EditInfo
        {
            Mode = "late",
            StudentsBefore = previous.Rows.Select(r => r.RegisterNumber).Distinct(StringComparer.Ordinal).Count(),
            RegistrationsAdded = added,
            CoursesAdded = newCourses.Count,
            SectionsCreated = created,
            Parked = parked,
            Waivers = waivers,
            Changes = changes,
            Notes = notes,
            Inputs = new Dictionary<string, string> { ["on_full"] = onFull.ToString(), ["on_clash"] = onClash.ToString() },
        });
    }

    private static string Describe(PlacementResult r) => r.Kind switch
    {
        PlacementKind.NewSection => $"new section {r.SectionId}",
        PlacementKind.Overfilled => $"{r.SectionId} (over capacity)",
        PlacementKind.NewCourse => $"new course, section {r.SectionId}",
        _ => r.SectionId ?? "",
    };

    private static bool WouldClash(Workspace ws, string register, List<EnrollmentRow> lateRows, out string why)
    {
        var byDay = new Dictionary<int, string>();
        foreach (string course in ws.RowsOf(register).Select(r => r.CourseCode).Concat(lateRows.Select(r => r.CourseCode)).Distinct(StringComparer.Ordinal))
        {
            if (!ws.Days.TryGetValue(course, out int day)) continue;
            if (byDay.TryGetValue(day, out string? other) && lateRows.Any(r => r.CourseCode == course || r.CourseCode == other))
            {
                why = $"{course} and {other} are both on {(Weekday)day}";
                return true;
            }
            byDay[day] = course;
        }
        why = "";
        return false;
    }

    // ---- surgical single-student edits -------------------------------------------------------------------------------------
    public static EditPlan DropCourse(Workspace previous, string register, string course)
    {
        var ws = previous.Clone();
        var row = RequireEnrolled(ws, register, course);
        ws.Remove(register, course, out string? section, out bool gone);
        return Surgical("drop-course", previous, ws, row, [new EditChange(register, row.StudentName, course, "removed", gone ? $"{section} (course now empty, removed)" : section ?? "")],
            new Dictionary<string, string> { ["register"] = register, ["course"] = course });
    }

    public static EditPlan FixCourse(Workspace previous, string register, string from, string to, string? toTitle, FullPolicy onFull = FullPolicy.NewSection)
    {
        to = to.Trim().ToUpperInvariant();
        if (to == from) throw new EditException("The correct course is the same as the wrong one.");
        var ws = previous.Clone();
        var row = RequireEnrolled(ws, register, from);
        if (ws.IsEnrolled(register, to)) throw new EditException($"{register} is already enrolled in {to}.");

        string? title = ws.SectionsOf(to).FirstOrDefault()?.CourseTitle ?? toTitle?.Trim();
        if (string.IsNullOrEmpty(title)) throw new EditException($"{to} is not on the schedule yet. Give it a title so the new course can be created.");

        ws.Remove(register, from, out string? oldSection, out bool gone);
        bool isNew = !ws.HasCourse(to);
        var res = ws.Add(row with { CourseCode = to, CourseTitle = title, Faculty = null }, onFull);
        if (res.Kind == PlacementKind.Parked) throw new EditException($"{to} is full and the policy does not allow another section.");
        var change = new EditChange(register, row.StudentName, from, "moved", $"{from} → {to} ({Describe(res)})");
        var plan = Surgical("fix-course", previous, ws, row, [change],
            new Dictionary<string, string> { ["register"] = register, ["from"] = from, ["to"] = to });
        var notes = new List<string>(plan.Info.Notes);
        if (gone) notes.Add($"{from} had no other students and was removed from the timetable.");
        if (isNew) notes.Add($"{to} is a new course; the solver places its weekday with every other course pinned.");
        return plan with { Info = plan.Info with { Notes = notes, CoursesAdded = isNew ? 1 : 0, RegistrationsAdded = 1, SectionsCreated = res.Kind == PlacementKind.NewSection ? [res.SectionId!] : [] } };
    }

    private static EnrollmentRow RequireEnrolled(Workspace ws, string register, string course)
    {
        if (!ws.RowsOf(register).Any()) throw new EditException($"No student with register number {register} on this schedule.");
        return ws.Rows.FirstOrDefault(r => r.RegisterNumber == register && r.CourseCode == course)
               ?? throw new EditException($"{register} is not enrolled in {course}.");
    }

    private static EditPlan Surgical(string mode, Workspace previous, Workspace ws, EnrollmentRow who, List<EditChange> changes, Dictionary<string, string> inputs) =>
        new(ws, new EditInfo
        {
            Mode = mode,
            StudentsBefore = previous.Rows.Select(r => r.RegisterNumber).Distinct(StringComparer.Ordinal).Count(),
            RegistrationsRemoved = 1,
            Changes = changes,
            Notes = ws.RowsOf(who.RegisterNumber).Any() ? [] : [$"{who.RegisterNumber} has no courses left and is no longer on the schedule."],
            Inputs = inputs,
        });

    // ---- rectify -----------------------------------------------------------------------------------------------------------
    /// <summary>
    /// Re-plans sections for a changed enrollment while every course that continues keeps its weekday. New courses are left for the solver.
    /// </summary>
    public static EditPlan Rectify(Workspace previous, IReadOnlyList<IReadOnlyList<string?>> rectifiedGrid)
    {
        var parsed = RosterBuilder.Build(EnrollmentParser.Parse(rectifiedGrid));
        if (parsed.Roster is null) throw new InputRejectedException(parsed.Validation);
        var roster = parsed.Roster;
        var sections = SectionPlanner.Plan(roster);

        var days = previous.Days.Where(kv => roster.HasCourse(kv.Key)).ToDictionary(kv => kv.Key, kv => kv.Value, StringComparer.Ordinal);
        var ws = new Workspace
        {
            Source = previous.Source, Policy = previous.Policy, Rows = [.. roster.Rows], Sections = [.. sections], Days = days,
            Seed = previous.Seed, Chains = previous.Chains, RunLog = previous.RunLog,
        };

        var before = previous.Rows.Select(r => (r.RegisterNumber, r.CourseCode)).ToHashSet();
        var after = roster.Rows.Select(r => (r.RegisterNumber, r.CourseCode)).ToHashSet();
        var names = roster.Rows.Concat(previous.Rows).GroupBy(r => r.RegisterNumber).ToDictionary(g => g.Key, g => g.First().StudentName);
        var changes = new List<EditChange>();
        foreach (var (reg, code) in after.Except(before).OrderBy(x => x.Item1, StringComparer.Ordinal).ThenBy(x => x.Item2, StringComparer.Ordinal))
            changes.Add(new EditChange(reg, names[reg], code, "added", ""));
        foreach (var (reg, code) in before.Except(after).OrderBy(x => x.Item1, StringComparer.Ordinal).ThenBy(x => x.Item2, StringComparer.Ordinal))
            changes.Add(new EditChange(reg, names[reg], code, "removed", ""));

        var oldCourses = previous.Days.Keys.ToHashSet(StringComparer.Ordinal);
        var newCourses = roster.Courses.Select(c => c.Code).Where(c => !oldCourses.Contains(c)).Order(StringComparer.Ordinal).ToList();
        var removedCourses = oldCourses.Where(c => !roster.HasCourse(c)).Order(StringComparer.Ordinal).ToList();
        var notes = new List<string> { $"{days.Count} continuing course(s) keep their weekday." };
        if (newCourses.Count > 0) notes.Add($"New course(s) placed by the solver: {string.Join(", ", newCourses)}.");
        if (removedCourses.Count > 0) notes.Add($"Course(s) no longer enrolled and removed: {string.Join(", ", removedCourses)}.");
        foreach (var g in sections.GroupBy(s => s.CourseCode))
        {
            int was = previous.SectionsOf(g.Key).Count;
            if (was > 0 && was != g.Count()) notes.Add($"{g.Key}: {was} → {g.Count()} section(s) because enrollment crossed a capacity threshold.");
        }
        if (changes.Count == 0) throw new EditException("The rectified workbook has the same registrations as the schedule: nothing to change.");

        return new EditPlan(ws, new EditInfo
        {
            Mode = "rectify",
            StudentsBefore = previous.Rows.Select(r => r.RegisterNumber).Distinct(StringComparer.Ordinal).Count(),
            RegistrationsAdded = changes.Count(c => c.Kind == "added"),
            RegistrationsRemoved = changes.Count(c => c.Kind == "removed"),
            CoursesAdded = newCourses.Count,
            Changes = changes,
            Notes = notes,
            Inputs = new Dictionary<string, string>(),
        });
    }

    // ---- revert ------------------------------------------------------------------------------------------------------------
    /// <summary>Everything that differs between an edited schedule and the one from before the edit, grouped per student.</summary>
    public static IReadOnlyList<RegistrationChange> Differences(Workspace edited, Workspace previous)
    {
        RequireRelated(edited, previous);
        var inEdited = edited.Rows.ToDictionary(r => (r.RegisterNumber, r.CourseCode));
        var inPrevious = previous.Rows.ToDictionary(r => (r.RegisterNumber, r.CourseCode));
        var removed = inPrevious.Keys.Where(k => !inEdited.ContainsKey(k)).GroupBy(k => k.Item1).ToDictionary(g => g.Key, g => g.Select(k => k.Item2).Order(StringComparer.Ordinal).ToList());
        var added = inEdited.Keys.Where(k => !inPrevious.ContainsKey(k)).GroupBy(k => k.Item1).ToDictionary(g => g.Key, g => g.Select(k => k.Item2).Order(StringComparer.Ordinal).ToList());

        var result = new List<RegistrationChange>();
        foreach (string reg in removed.Keys.Concat(added.Keys).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal))
        {
            var rem = removed.GetValueOrDefault(reg) ?? [];
            var add = added.GetValueOrDefault(reg) ?? [];
            string name = (inEdited.Values.Concat(inPrevious.Values).First(r => r.RegisterNumber == reg)).StudentName;
            int pairs = Math.Min(rem.Count, add.Count);
            for (int i = 0; i < pairs; i++)
                result.Add(new RegistrationChange(reg, name, RegistrationChangeKind.Moved, rem[i], add[i], inPrevious[(reg, rem[i])].CourseTitle));
            foreach (string c in rem.Skip(pairs)) result.Add(new RegistrationChange(reg, name, RegistrationChangeKind.Removed, c, null, inPrevious[(reg, c)].CourseTitle));
            foreach (string c in add.Skip(pairs)) result.Add(new RegistrationChange(reg, name, RegistrationChangeKind.Added, c, null, inEdited[(reg, c)].CourseTitle));
        }
        return result;
    }

    private static void RequireRelated(Workspace edited, Workspace previous)
    {
        if (ReferenceEquals(edited, previous)) throw new EditException("Choose two different folders.");

        // The earlier folder's history must be the start of the edited folder's history; anything else is a swap or an unrelated schedule.
        var edits = RunHistory(edited);
        var before = RunHistory(previous);
        if (before.Count > 0 && edits.Count > 0)
        {
            if (edits.Count < before.Count)
                throw new EditException("The folder with the mistake has a shorter history than the folder from before it, so they look swapped. Choose them the other way round.");
            for (int i = 0; i < before.Count; i++)
                if (edits[i] != before[i])
                    throw new EditException("These folders do not belong together: they come from different runs. The folder from before the mistake must be an earlier state of the edited one.");
        }

        var a = edited.Rows.Select(r => r.RegisterNumber).ToHashSet(StringComparer.Ordinal);
        var b = previous.Rows.Select(r => r.RegisterNumber).ToHashSet(StringComparer.Ordinal);
        int overlap = a.Count(b.Contains);
        if (overlap == 0 || overlap < 0.5 * Math.Min(a.Count, b.Count))
            throw new EditException("These folders do not belong together: they share too few students. Check that the edited and previous folders are not swapped or from different schedules.");
    }

    private static List<(int Seq, string At, string Mode)> RunHistory(Workspace w)
    {
        var list = new List<(int, string, string)>();
        foreach (string entry in w.RunLog)
        {
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(entry);
                var r = doc.RootElement;
                list.Add((r.TryGetProperty("seq", out var seq) && seq.TryGetInt32(out int n) ? n : list.Count + 1,
                    r.TryGetProperty("at", out var at) ? at.GetString() ?? "" : "",
                    r.TryGetProperty("mode", out var mode) ? mode.GetString() ?? "" : ""));
            }
            catch (System.Text.Json.JsonException) { list.Add((list.Count + 1, "", "")); }
        }
        return list;
    }

    /// <summary>Undoes the chosen differences: removed registrations return to their original section (or the course returns on its original weekday), added ones are taken out again.</summary>
    public static EditPlan Revert(Workspace edited, Workspace previous, IReadOnlyList<RegistrationChange> selected)
    {
        if (selected.Count == 0) throw new EditException("Nothing selected to restore.");
        var ws = edited.Clone();
        var oldRows = previous.Rows.ToDictionary(r => (r.RegisterNumber, r.CourseCode));
        var changes = new List<EditChange>();
        int restored = 0, taken = 0;

        foreach (var c in selected)
        {
            if (c.Kind is RegistrationChangeKind.Added or RegistrationChangeKind.Moved)
            {
                string undo = c.Kind == RegistrationChangeKind.Added ? c.Course : c.ToCourse!;
                if (ws.Remove(c.Register, undo, out _, out bool gone))
                {
                    taken++;
                    changes.Add(new EditChange(c.Register, c.Name, undo, "removed", gone ? "course now empty, removed" : "undone"));
                }
            }
            if (c.Kind is RegistrationChangeKind.Removed or RegistrationChangeKind.Moved)
            {
                var row = oldRows[(c.Register, c.Course)];
                string detail = Restore(ws, previous, row);
                restored++;
                changes.Add(new EditChange(c.Register, c.Name, c.Course, "restored", detail));
            }
        }

        return new EditPlan(ws, new EditInfo
        {
            Mode = "revert",
            StudentsBefore = edited.Rows.Select(r => r.RegisterNumber).Distinct(StringComparer.Ordinal).Count(),
            RegistrationsAdded = restored,
            RegistrationsRemoved = taken,
            Changes = changes,
            Notes = RevertNotes(edited, previous, restored, taken),
            Inputs = new Dictionary<string, string>(),
        });
    }

    private static List<string> RevertNotes(Workspace edited, Workspace previous, int restored, int taken)
    {
        var notes = new List<string> { $"{restored} registration(s) restored, {taken} undone. Every other edit in the edited folder is kept." };
        var between = RunHistory(edited).Skip(RunHistory(previous).Count).Select(h => h.Mode).Where(m => m is "late" or "rectify").Distinct().ToList();
        if (between.Count > 0)
            notes.Add($"Warning: {string.Join(" and ", between)} run(s) happened between the two folders. Only fix-course and drop-course edits revert cleanly; check the result.");
        return notes;
    }

    private static string Restore(Workspace ws, Workspace previous, EnrollmentRow row)
    {
        string course = row.CourseCode;
        string? oldSectionId = previous.SectionOf(row.RegisterNumber, course);
        var oldSection = oldSectionId is null ? null : previous.Sections.FirstOrDefault(s => s.Id == oldSectionId);

        if (!ws.HasCourse(course) && oldSection is not null)
        {
            // The course vanished because it became empty: bring it back on its original weekday, in its original section.
            ws.Sections.Add(oldSection with { Students = [row.RegisterNumber] });
            ws.Rows.Add(row);
            if (previous.Days.TryGetValue(course, out int day)) ws.Days[course] = day;
            return $"{oldSection.Id} (course restored on {(Weekday)ws.Days.GetValueOrDefault(course)})";
        }

        int i = oldSectionId is null ? -1 : ws.Sections.FindIndex(s => s.Id == oldSectionId);
        if (i >= 0)
        {
            var s = ws.Sections[i];
            ws.Sections[i] = s with { Students = [.. s.Students, row.RegisterNumber] };
            ws.Rows.Add(row);
            return s.Id;
        }
        var res = ws.Add(row, FullPolicy.Fit);
        return res.SectionId ?? "";
    }

    // ---- filter ------------------------------------------------------------------------------------------------------------
    /// <summary>A copy of the schedule holding only the listed courses (same layout, subset of courses). Returns the codes that are not on the schedule.</summary>
    public static (Workspace Workspace, IReadOnlyList<string> Missing) Filter(Workspace source, IEnumerable<string> codes)
    {
        var wanted = codes.Select(c => c.Trim().ToUpperInvariant()).Where(c => c.Length > 0).Distinct(StringComparer.Ordinal).ToList();
        var present = source.Days.Keys.ToHashSet(StringComparer.Ordinal);
        var keep = wanted.Where(present.Contains).ToHashSet(StringComparer.Ordinal);
        var missing = wanted.Where(c => !present.Contains(c)).ToList();
        if (keep.Count == 0) throw new EditException("None of those course codes are on the schedule.");
        var ws = new Workspace
        {
            Source = source.Source, Policy = source.Policy, Seed = source.Seed, Chains = source.Chains, RunLog = source.RunLog,
            Rows = [.. source.Rows.Where(r => keep.Contains(r.CourseCode))],
            Sections = [.. source.Sections.Where(s => keep.Contains(s.CourseCode))],
            Days = source.Days.Where(kv => keep.Contains(kv.Key)).ToDictionary(kv => kv.Key, kv => kv.Value, StringComparer.Ordinal),
        };
        return (ws, missing);
    }
}
