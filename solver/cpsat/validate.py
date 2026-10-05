"""Validation shared by CP-SAT model and lower-bound construction."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any


def _positive_int(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{label} must be a positive integer")
    return value


def _nonnegative_int(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{label} must be a non-negative integer")
    return value


def _rows(value: Any, label: str) -> list[Mapping[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list) or any(not isinstance(row, Mapping) for row in value):
        raise ValueError(f"{label} must be a list of objects")
    return list(value)


def _course_code(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty course code")
    return value


def validate_instance(instance: dict[str, Any]) -> None:
    """Reject malformed direct solver input before it affects cuts or variables.

    Synthetic weighted graph inputs may omit students; when students are
    supplied, every reference must resolve to a modeled course.
    """
    if not isinstance(instance, dict):
        raise ValueError("instance must be an object")

    courses = _rows(instance.get("courses"), "courses")
    if not courses:
        raise ValueError("instance has no courses")
    codes: list[str] = []
    course_rows: dict[str, Mapping[str, Any]] = {}
    for idx, course in enumerate(courses):
        code = _course_code(course.get("code"), f"courses[{idx}].code")
        if code in course_rows:
            raise ValueError(f"duplicate course code {code!r}")
        course_rows[code] = course
        codes.append(code)
        if "section_count" in course:
            _positive_int(course["section_count"], f"course {code!r} section_count")
        if "section_ids" in course and not isinstance(course["section_ids"], list):
            raise ValueError(f"course {code!r} section_ids must be a list")

    n_days = _positive_int(instance.get("num_weekdays", 6), "num_weekdays")
    saturday = _nonnegative_int(instance.get("saturday_index", 5), "saturday_index")
    allow_saturday = instance.get("allow_saturday", True)
    if not isinstance(allow_saturday, bool):
        raise ValueError("allow_saturday must be a boolean")
    if not allow_saturday:
        n_days = min(n_days, saturday)
        if n_days <= 0:
            raise ValueError("Saturday-disabled domain must contain at least one weekday")

    domains: dict[str, set[int]] = {}
    for code, course in course_rows.items():
        limit = n_days
        if allow_saturday and not bool(course.get("is_math")):
            limit = min(limit, saturday)
        domain = set(range(limit))
        if not domain:
            raise ValueError(f"course {code!r} has an empty weekday domain")
        domains[code] = domain

    edge_rows = _rows(instance.get("conflict_edges"), "conflict_edges")
    edge_pairs: set[tuple[str, str]] = set()
    total_weight = 0
    for idx, edge in enumerate(edge_rows):
        a = _course_code(edge.get("course_a"), f"conflict_edges[{idx}].course_a")
        b = _course_code(edge.get("course_b"), f"conflict_edges[{idx}].course_b")
        if a not in course_rows or b not in course_rows:
            missing = a if a not in course_rows else b
            raise ValueError(f"conflict_edges[{idx}] references unknown course {missing!r}")
        if a == b:
            raise ValueError(f"conflict_edges[{idx}] cannot be a self-edge")
        weight = _positive_int(edge.get("weight"), f"conflict_edges[{idx}].weight")
        edge_pairs.add((a, b) if a < b else (b, a))
        total_weight += weight

    students = _rows(instance.get("students"), "students")
    student_ids: set[str] = set()
    for idx, student in enumerate(students):
        sid = student.get("id")
        if sid is not None:
            if not isinstance(sid, str) or not sid.strip():
                raise ValueError(f"students[{idx}].id must be a non-empty string")
            if sid in student_ids:
                raise ValueError(f"duplicate student id {sid!r}")
            student_ids.add(sid)
        refs = student.get("courses", [])
        if not isinstance(refs, list):
            raise ValueError(f"students[{idx}].courses must be a list")
        for ref in refs:
            code = _course_code(ref, f"students[{idx}].courses entry")
            if code not in course_rows:
                raise ValueError(f"students[{idx}] references unknown course {code!r}")

    groups = _rows(instance.get("faculty_groups"), "faculty_groups")
    for idx, group in enumerate(groups):
        refs = group.get("course_codes", [])
        if not isinstance(refs, list):
            raise ValueError(f"faculty_groups[{idx}].course_codes must be a list")
        for ref in refs:
            code = _course_code(ref, f"faculty_groups[{idx}].course_codes entry")
            if code not in course_rows:
                raise ValueError(f"faculty_groups[{idx}] references unknown course {code!r}")

    pins = instance.get("fixed_days", {})
    if not isinstance(pins, Mapping):
        raise ValueError("fixed_days must be an object")
    for raw_code, raw_day in pins.items():
        code = _course_code(raw_code, "fixed_days key")
        if code not in course_rows:
            raise ValueError(f"fixed_days references unknown course {code!r}")
        day = _nonnegative_int(raw_day, f"fixed_days[{code!r}]")
        if day not in domains[code]:
            raise ValueError(f"fixed_days[{code!r}]={day} is outside its weekday domain")

    cuts = instance.get("clique_cuts", [])
    if not isinstance(cuts, list):
        raise ValueError("clique_cuts must be a list")
    for idx, cut in enumerate(cuts):
        if not isinstance(cut, list) or len(cut) < 2:
            raise ValueError(f"clique_cuts[{idx}] must contain at least two course codes")
        cut_codes = [_course_code(code, f"clique_cuts[{idx}] entry") for code in cut]
        if len(set(cut_codes)) != len(cut_codes):
            raise ValueError(f"clique_cuts[{idx}] contains duplicate course codes")
        for code in cut_codes:
            if code not in course_rows:
                raise ValueError(f"clique_cuts[{idx}] references unknown course {code!r}")
        for i, a in enumerate(cut_codes):
            for b in cut_codes[i + 1 :]:
                key = (a, b) if a < b else (b, a)
                if key not in edge_pairs:
                    raise ValueError(f"clique_cuts[{idx}] is not a clique in conflict_edges")

    if "preferred_parallel" in instance:
        _positive_int(instance["preferred_parallel"], "preferred_parallel")
    for bound_name in ("min_clash_weight_lower_bound", "min_red_students_lower_bound"):
        if bound_name in instance:
            _nonnegative_int(instance[bound_name], bound_name)
    if instance.get("min_clash_weight_lower_bound", 0) > total_weight:
        raise ValueError("min_clash_weight_lower_bound exceeds total conflict weight")
