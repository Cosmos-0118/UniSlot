"""Tests for parser and preprocessing modules."""

import tempfile
from pathlib import Path

import pandas as pd
import pytest

from unislot.models import EnrollmentRow
from unislot.parser import (
    build_canonical_data,
    normalize_column_name,
    parse_excel,
    validate_business_rules,
)
from unislot.preprocessing import (
    assign_students_to_sections,
    build_conflict_graph,
    compute_section_splits,
)


class TestColumnNormalization:
    """Tests for column name normalization."""

    def test_standard_names(self) -> None:
        assert normalize_column_name("Program") == "program"
        assert normalize_column_name("Course Code") == "course_code"
        assert normalize_column_name("Student Name") == "student_name"

    def test_alternate_names(self) -> None:
        assert normalize_column_name("Reg No") == "register_number"
        assert normalize_column_name("Reg. No.") == "register_number"
        assert normalize_column_name("Email") == "email_id"
        assert normalize_column_name("Name") == "student_name"


class TestParseExcel:
    """Tests for Excel parsing."""

    @pytest.fixture
    def sample_excel(self) -> Path:
        """Create a sample Excel file for testing."""
        data = {
            "Program": ["B.Tech CSE", "B.Tech CSE", "B.Tech ECE"],
            "Register Number": ["21BCS001", "21BCS001", "21BEC001"],
            "Student Name": ["Alice", "Alice", "Bob"],
            "Course Code": ["CS501", "CS502", "EC301"],
            "Course Title": ["ML", "Data Mining", "VLSI"],
        }
        df = pd.DataFrame(data)

        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as f:
            df.to_excel(f.name, index=False)
            return Path(f.name)

    def test_parse_valid_excel(self, sample_excel: Path) -> None:
        rows, result = parse_excel(sample_excel)

        assert result.is_valid
        assert len(rows) == 3
        assert rows[0].register_number == "21BCS001"
        assert rows[0].course_code == "CS501"

    def test_missing_required_column(self) -> None:
        data = {"Program": ["B.Tech"], "Student Name": ["Alice"]}
        df = pd.DataFrame(data)

        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as f:
            df.to_excel(f.name, index=False)
            rows, result = parse_excel(f.name)

        assert not result.is_valid
        assert any("Missing required columns" in e.message
                   for e in result.errors)


class TestBusinessRules:
    """Tests for business rule validation."""

    def test_duplicate_detection(self) -> None:
        rows = [
            EnrollmentRow(
                program="B.Tech",
                register_number="001",
                student_name="Alice",
                course_code="CS501",
                course_title="ML",
            ),
            EnrollmentRow(
                program="B.Tech",
                register_number="001",
                student_name="Alice",
                course_code="CS501",  # Duplicate
                course_title="ML",
            ),
        ]

        valid_rows, result = validate_business_rules(rows)

        assert len(valid_rows) == 1
        assert len(result.warnings) == 1
        assert "Duplicate" in result.warnings[0].message

    def test_max_courses_warning(self) -> None:
        rows = [
            EnrollmentRow(
                program="B.Tech",
                register_number="001",
                student_name="Alice",
                course_code=f"CS{i}",
                course_title=f"Course {i}",
            ) for i in range(6)  # 6 courses > max 5
        ]

        valid_rows, result = validate_business_rules(rows)

        assert len(valid_rows) == 6
        assert any("enrolled in 6 courses" in w.message
                   for w in result.warnings)


class TestPreprocessing:
    """Tests for preprocessing functions."""

    def test_section_splitting(self) -> None:
        from unislot.models import Course

        courses = {
            "CS501": Course(code="CS501", title="ML", enrollment_count=130),
            "CS502": Course(code="CS502", title="DM", enrollment_count=50),
        }

        sections = compute_section_splits(courses, max_capacity=65)

        assert len(sections["CS501"]) == 2  # 130 students -> 2 sections
        assert len(sections["CS502"]) == 1  # 50 students -> 1 section

        assert sections["CS501"][0].section_id == "CS501_S1"
        assert sections["CS501"][1].section_id == "CS501_S2"
        assert sections["CS502"][0].section_id == "CS502"  # No split, no suffix

    def test_conflict_graph_construction(self) -> None:
        from unislot.models import Section, Student

        students = {
            "001":
            Student(register_number="001",
                    name="Alice",
                    program="B.Tech",
                    enrolled_courses=["CS501", "CS502"]),
            "002":
            Student(register_number="002",
                    name="Bob",
                    program="B.Tech",
                    enrolled_courses=["CS501"]),
        }

        course_sections = {
            "CS501": [
                Section(section_id="CS501",
                        course_code="CS501",
                        course_title="ML",
                        enrolled_students=["001", "002"])
            ],
            "CS502": [
                Section(section_id="CS502",
                        course_code="CS502",
                        course_title="DM",
                        enrolled_students=["001"])
            ],
        }

        graph = build_conflict_graph(students, course_sections)

        assert len(graph.sections) == 2
        assert len(graph.edges) == 1  # Only Alice is in both -> 1 edge
        assert graph.edges[0].weight == 1
        assert "001" in graph.edges[0].shared_students
