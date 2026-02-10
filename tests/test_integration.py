"""Integration tests for the full scheduling pipeline."""

import tempfile
from pathlib import Path

import pandas as pd
import pytest

from unislot.parser import load_and_validate
from unislot.preprocessing import (
    assign_students_to_sections,
    build_conflict_graph,
    compute_section_splits,
    extract_faculty_constraints,
)
from unislot.scheduler import build_schedule, compute_clash_report, run_scheduler


def create_test_data(num_students: int, num_courses: int,
                     courses_per_student: int) -> Path:
    """Create test enrollment data."""
    import random

    random.seed(42)

    rows = []
    course_codes = [f"CS{100 + i}" for i in range(num_courses)]

    for i in range(num_students):
        student_id = f"21BCS{i:03d}"
        student_name = f"Student_{i}"

        # Each student enrolls in random courses
        enrolled = random.sample(course_codes,
                                 min(courses_per_student, num_courses))

        for course_code in enrolled:
            rows.append({
                "Program": "B.Tech CSE",
                "Register Number": student_id,
                "Student Name": student_name,
                "Course Code": course_code,
                "Course Title": f"Course {course_code}",
            })

    df = pd.DataFrame(rows)

    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as f:
        df.to_excel(f.name, index=False)
        return Path(f.name)


class TestSmallScaleScheduling:
    """Tests with small data to verify correctness."""

    def test_no_clash_possible(self) -> None:
        """Test with data where zero clashes should be achievable."""
        # 5 students, 5 courses, each student takes 1 course
        # Should be trivially schedulable with 0 clashes
        file_path = create_test_data(num_students=5,
                                     num_courses=5,
                                     courses_per_student=1)

        students, courses, rows, validation = load_and_validate(file_path)
        assert validation.is_valid

        course_sections = compute_section_splits(courses)
        course_sections = assign_students_to_sections(students,
                                                      course_sections, rows)
        conflict_graph = build_conflict_graph(students, course_sections)
        faculty_constraints = extract_faculty_constraints(course_sections)

        result = run_scheduler(
            course_sections,
            conflict_graph,
            faculty_constraints,
            time_limit_seconds=10,
        )

        assert result.feasible

        clash_report = compute_clash_report(students, course_sections, result)
        assert clash_report.students_with_clashes == 0

    def test_moderate_complexity(self) -> None:
        """Test with moderate complexity - 50 students, 10 courses."""
        file_path = create_test_data(num_students=50,
                                     num_courses=10,
                                     courses_per_student=3)

        students, courses, rows, validation = load_and_validate(file_path)
        assert validation.is_valid
        assert len(students) == 50

        course_sections = compute_section_splits(courses)
        course_sections = assign_students_to_sections(students,
                                                      course_sections, rows)
        conflict_graph = build_conflict_graph(students, course_sections)
        faculty_constraints = extract_faculty_constraints(course_sections)

        result = run_scheduler(
            course_sections,
            conflict_graph,
            faculty_constraints,
            time_limit_seconds=30,
        )

        assert result.feasible

        schedule = build_schedule(course_sections, result)
        clash_report = compute_clash_report(students, course_sections, result)

        # Schedule should have all courses
        assert schedule.total_sections >= 10

        # Should have low clash rate (ideally 0, but depends on data)
        assert clash_report.clash_percentage <= 50  # Reasonable bound

    def test_greedy_fallback(self) -> None:
        """Test that greedy solver works."""
        file_path = create_test_data(num_students=20,
                                     num_courses=8,
                                     courses_per_student=2)

        students, courses, rows, validation = load_and_validate(file_path)

        course_sections = compute_section_splits(courses)
        course_sections = assign_students_to_sections(students,
                                                      course_sections, rows)
        conflict_graph = build_conflict_graph(students, course_sections)
        faculty_constraints = extract_faculty_constraints(course_sections)

        result = run_scheduler(
            course_sections,
            conflict_graph,
            faculty_constraints,
            use_greedy_only=True,
        )

        assert result.feasible
        assert result.solver_used == "greedy"
        assert result.solver_time_seconds < 1.0  # Greedy should be fast


class TestEdgeCases:
    """Tests for edge cases."""

    def test_single_student_single_course(self) -> None:
        """Minimal case: 1 student, 1 course."""
        data = {
            "Program": ["B.Tech"],
            "Register Number": ["001"],
            "Student Name": ["Alice"],
            "Course Code": ["CS101"],
            "Course Title": ["Intro CS"],
        }
        df = pd.DataFrame(data)

        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as f:
            df.to_excel(f.name, index=False)
            file_path = Path(f.name)

        students, courses, rows, validation = load_and_validate(file_path)
        assert validation.is_valid
        assert len(students) == 1
        assert len(courses) == 1

        course_sections = compute_section_splits(courses)
        course_sections = assign_students_to_sections(students,
                                                      course_sections, rows)
        conflict_graph = build_conflict_graph(students, course_sections)

        result = run_scheduler(course_sections,
                               conflict_graph, {},
                               time_limit_seconds=5)

        assert result.feasible
        clash_report = compute_clash_report(students, course_sections, result)
        assert clash_report.students_with_clashes == 0

    def test_course_requiring_split(self) -> None:
        """Test course with enrollment > 65 requiring split."""
        rows = []
        for i in range(80):
            rows.append({
                "Program": "B.Tech",
                "Register Number": f"S{i:03d}",
                "Student Name": f"Student_{i}",
                "Course Code": "CS101",
                "Course Title": "Popular Course",
            })

        df = pd.DataFrame(rows)

        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as f:
            df.to_excel(f.name, index=False)
            file_path = Path(f.name)

        students, courses, _, validation = load_and_validate(file_path)

        assert courses["CS101"].enrollment_count == 80

        course_sections = compute_section_splits(courses, max_capacity=65)

        assert len(course_sections["CS101"]) == 2  # Should be split
        assert course_sections["CS101"][0].section_id == "CS101_S1"
        assert course_sections["CS101"][1].section_id == "CS101_S2"
