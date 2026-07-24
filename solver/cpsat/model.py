"""CP-SAT model: course → weekday coloring with lex clash / RED / balance objectives."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ortools.sat.python import cp_model

NUM_WEEKDAYS = 6
SATURDAY = 5
PREFERRED_PARALLEL = 11


@dataclass
class BuiltModel:
    model: cp_model.CpModel
    day: dict[str, cp_model.IntVar]
    clash_weight: cp_model.IntVar
    red_students: cp_model.IntVar
    balance_l1: cp_model.IntVar
    parallel_excess: cp_model.IntVar
    course_codes: list[str]


def _as_courses(instance: dict[str, Any]) -> list[dict[str, Any]]:
    return list(instance.get("courses") or [])


def build_model(instance: dict[str, Any]) -> BuiltModel:
    courses = _as_courses(instance)
    if not courses:
        raise ValueError("instance has no courses")

    num_weekdays = int(instance.get("num_weekdays") or NUM_WEEKDAYS)
    saturday = int(instance.get("saturday_index", SATURDAY))
    preferred = int(instance.get("preferred_parallel") or PREFERRED_PARALLEL)

    model = cp_model.CpModel()
    day: dict[str, cp_model.IntVar] = {}
    section_count: dict[str, int] = {}
    is_math: dict[str, bool] = {}

    for c in courses:
        code = str(c["code"])
        sc = int(c.get("section_count") or len(c.get("section_ids") or []) or 1)
        section_count[code] = max(1, sc)
        is_math[code] = bool(c.get("is_math"))
        day[code] = model.NewIntVar(0, num_weekdays - 1, f"day_{code}")
        if not is_math[code]:
            # Non-mathematics courses: Mon–Fri only (Constraints.md).
            model.Add(day[code] <= saturday - 1)

    course_codes = list(day.keys())

    # Faculty: courses taught by the same person cannot share a weekday.
    for group in instance.get("faculty_groups") or []:
        codes = [str(x) for x in (group.get("course_codes") or []) if str(x) in day]
        uniq = sorted(set(codes))
        for i, a in enumerate(uniq):
            for b in uniq[i + 1 :]:
                model.Add(day[a] != day[b])

    # Clash weight: sum of monochrome course-conflict edge weights.
    clash_terms: list[cp_model.LinearExpr] = []
    max_clash = 0
    for edge in instance.get("conflict_edges") or []:
        a = str(edge["course_a"])
        b = str(edge["course_b"])
        w = int(edge.get("weight") or 0)
        if w <= 0 or a not in day or b not in day or a == b:
            continue
        max_clash += w
        same = model.NewBoolVar(f"same_{a}_{b}")
        model.Add(day[a] == day[b]).OnlyEnforceIf(same)
        model.Add(day[a] != day[b]).OnlyEnforceIf(same.Not())
        clash_terms.append(w * same)

    clash_weight = model.NewIntVar(0, max(0, max_clash), "clash_weight")
    if clash_terms:
        model.Add(clash_weight == sum(clash_terms))
    else:
        model.Add(clash_weight == 0)

    # RED students: a student is RED if any two of their courses share a day.
    red_flags: list[Any] = []
    for idx, student in enumerate(instance.get("students") or []):
        scourses = [str(x) for x in (student.get("courses") or []) if str(x) in day]
        scourses = list(dict.fromkeys(scourses))  # preserve order, unique
        if len(scourses) < 2:
            continue
        pair_same: list[Any] = []
        for i, ca in enumerate(scourses):
            for cb in scourses[i + 1 :]:
                same = model.NewBoolVar(f"stu_{idx}_{ca}_{cb}")
                model.Add(day[ca] == day[cb]).OnlyEnforceIf(same)
                model.Add(day[ca] != day[cb]).OnlyEnforceIf(same.Not())
                pair_same.append(same)
        red = model.NewBoolVar(f"red_{idx}")
        # red <=> OR(pair_same)
        model.AddBoolOr(pair_same).OnlyEnforceIf(red)
        for p in pair_same:
            model.AddImplication(p, red)
        red_flags.append(red)

    n_students = len(red_flags)
    red_students = model.NewIntVar(0, max(0, n_students), "red_students")
    if red_flags:
        model.Add(red_students == sum(red_flags))
    else:
        model.Add(red_students == 0)

    # Day loads (section counts) for balance + soft parallel excess.
    total_sections = sum(section_count.values())
    load = [model.NewIntVar(0, total_sections, f"load_{d}") for d in range(num_weekdays)]
    for d in range(num_weekdays):
        contribs: list[cp_model.LinearExpr] = []
        for code in course_codes:
            on = model.NewBoolVar(f"on_{code}_{d}")
            model.Add(day[code] == d).OnlyEnforceIf(on)
            model.Add(day[code] != d).OnlyEnforceIf(on.Not())
            sc = section_count[code]
            contribs.append(sc * on)
        if contribs:
            model.Add(load[d] == sum(contribs))
        else:
            model.Add(load[d] == 0)

    # L1 distance from even spread (integer: scale ideal by n days via abs(n*load - total)).
    # weekday_balance_l1 = Σ |load_d - total/n| ; we optimize Σ |n*load_d - total| (same argmin).
    n = num_weekdays
    abs_devs: list[cp_model.IntVar] = []
    for d in range(n):
        scaled = model.NewIntVar(-total_sections * n, total_sections * n, f"scaled_dev_{d}")
        model.Add(scaled == n * load[d] - total_sections)
        abs_d = model.NewIntVar(0, total_sections * n, f"abs_dev_{d}")
        model.AddAbsEquality(abs_d, scaled)
        abs_devs.append(abs_d)
    balance_l1 = model.NewIntVar(0, total_sections * n * n, "balance_l1_scaled")
    model.Add(balance_l1 == sum(abs_devs))

    excess_terms: list[cp_model.LinearExpr] = []
    zero = model.NewConstant(0)
    for d in range(n):
        # excess_d = max(0, load_d - preferred)
        diff = model.NewIntVar(-preferred, total_sections, f"diff_{d}")
        model.Add(diff == load[d] - preferred)
        ex = model.NewIntVar(0, total_sections, f"excess_{d}")
        model.AddMaxEquality(ex, [diff, zero])
        excess_terms.append(ex)
    parallel_excess = model.NewIntVar(0, total_sections * n, "parallel_excess")
    if excess_terms:
        model.Add(parallel_excess == sum(excess_terms))
    else:
        model.Add(parallel_excess == 0)

    hint = instance.get("hint") or {}
    if isinstance(hint, dict):
        for code, slot in hint.items():
            c = str(code)
            if c in day:
                try:
                    model.AddHint(day[c], int(slot))
                except (TypeError, ValueError):
                    pass

    return BuiltModel(
        model=model,
        day=day,
        clash_weight=clash_weight,
        red_students=red_students,
        balance_l1=balance_l1,
        parallel_excess=parallel_excess,
        course_codes=course_codes,
    )
