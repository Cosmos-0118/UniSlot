"""Preprocessing: section splitting, student assignment, and conflict graph."""

import math
from collections import defaultdict

from unislot.models import (
    ConflictEdge,
    ConflictGraph,
    Course,
    EnrollmentRow,
    Section,
    Student,
)

DEFAULT_MAX_CAPACITY = 65


def compute_section_splits(
    courses: dict[str, Course],
    max_capacity: int = DEFAULT_MAX_CAPACITY,
) -> dict[str, list[Section]]:
    """
    Compute section splits for courses exceeding capacity.
    
    Args:
        courses: Dict of course code -> Course
        max_capacity: Maximum students per section
        
    Returns:
        Dict of course code -> list of Section objects
    """
    course_sections: dict[str, list[Section]] = {}

    for code, course in courses.items():
        num_sections = math.ceil(
            course.enrollment_count /
            max_capacity) if course.enrollment_count > 0 else 1

        # Update course with section count
        course.section_count = num_sections

        # Create sections
        sections: list[Section] = []
        for i in range(num_sections):
            section_id = f"{code}_S{i + 1}" if num_sections > 1 else code
            section = Section(
                section_id=section_id,
                course_code=code,
                course_title=course.title,
                section_number=i + 1,
                faculty=course.faculty,
                capacity=max_capacity,
                enrolled_students=[],
            )
            sections.append(section)

        course_sections[code] = sections

    return course_sections


def assign_students_to_sections(
    students: dict[str, Student],
    course_sections: dict[str, list[Section]],
    enrollment_rows: list[EnrollmentRow],
) -> dict[str, list[Section]]:
    """
    Assign students to sections with balanced distribution.
    
    Strategy:
    - If course has 1 section: all students go there
    - If course has N sections: distribute students evenly, keeping program cohorts together
    
    Args:
        students: Dict of register_number -> Student
        course_sections: Dict of course_code -> list of Section
        enrollment_rows: Original enrollment rows
        
    Returns:
        Updated course_sections with enrolled_students and programs populated
    """
    # Group students by course and program for cohort-aware assignment
    course_program_students: dict[str, dict[str, list[str]]] = defaultdict(
        lambda: defaultdict(list))

    for row in enrollment_rows:
        course_program_students[row.course_code][row.program].append(
            row.register_number)

    for course_code, sections in course_sections.items():
        # Collect all programs for this course
        all_programs = list(course_program_students[course_code].keys())

        if len(sections) == 1:
            # Single section: assign all students and all programs
            for program, program_students in course_program_students[
                    course_code].items():
                sections[0].enrolled_students.extend(program_students)
                if program not in sections[0].programs:
                    sections[0].programs.append(program)
        else:
            # Multiple sections: distribute by program cohorts
            program_groups = list(course_program_students[course_code].items())

            # Sort programs by size (largest first) for better distribution
            program_groups.sort(key=lambda x: len(x[1]), reverse=True)

            # Track current section loads and programs per section
            section_loads = [0] * len(sections)

            for program, student_ids in program_groups:
                # Find section with minimum load
                min_idx = min(range(len(sections)),
                              key=lambda i: section_loads[i])

                # Check if we can fit the whole program cohort
                if section_loads[min_idx] + len(
                        student_ids) <= sections[min_idx].capacity:
                    sections[min_idx].enrolled_students.extend(student_ids)
                    section_loads[min_idx] += len(student_ids)
                    if program not in sections[min_idx].programs:
                        sections[min_idx].programs.append(program)
                else:
                    # Split the cohort across sections
                    remaining = student_ids.copy()
                    while remaining:
                        min_idx = min(range(len(sections)),
                                      key=lambda i: section_loads[i])
                        space = sections[min_idx].capacity - section_loads[
                            min_idx]

                        if space <= 0:
                            # All sections full, force assignment to least loaded
                            min_idx = min(range(len(sections)),
                                          key=lambda i: section_loads[i])
                            space = len(remaining)

                        to_assign = remaining[:space]
                        sections[min_idx].enrolled_students.extend(to_assign)
                        section_loads[min_idx] += len(to_assign)
                        if program not in sections[min_idx].programs:
                            sections[min_idx].programs.append(program)
                        remaining = remaining[space:]

    return course_sections


def build_conflict_graph(
    students: dict[str, Student],
    course_sections: dict[str, list[Section]],
) -> ConflictGraph:
    """
    Build conflict graph where nodes are sections and edges connect sections sharing students.
    
    Args:
        students: Dict of register_number -> Student
        course_sections: Dict of course_code -> list of Section
        
    Returns:
        ConflictGraph with sections as nodes and weighted edges
    """
    # Map student -> list of section_ids they're enrolled in
    student_sections: dict[str, list[str]] = defaultdict(list)

    # All sections (nodes)
    all_sections: list[str] = []

    for sections in course_sections.values():
        for section in sections:
            all_sections.append(section.section_id)
            for student_id in section.enrolled_students:
                student_sections[student_id].append(section.section_id)

    # Build edges: for each student, their sections conflict
    edge_weights: dict[tuple[str, str], list[str]] = defaultdict(list)

    for student_id, section_ids in student_sections.items():
        # Create edges between all pairs of sections this student is in
        for i in range(len(section_ids)):
            for j in range(i + 1, len(section_ids)):
                s1, s2 = sorted([section_ids[i], section_ids[j]])
                edge_weights[(s1, s2)].append(student_id)

    # Convert to ConflictEdge objects
    edges: list[ConflictEdge] = []
    for (s1, s2), shared in edge_weights.items():
        edges.append(
            ConflictEdge(
                section_a=s1,
                section_b=s2,
                weight=len(shared),
                shared_students=shared,
            ))

    return ConflictGraph(sections=all_sections, edges=edges)


def extract_faculty_constraints(
    course_sections: dict[str, list[Section]], ) -> dict[str, list[str]]:
    """
    Extract faculty -> sections mapping for constraint generation.
    
    Args:
        course_sections: Dict of course_code -> list of Section
        
    Returns:
        Dict of faculty_name -> list of section_ids they teach
    """
    faculty_sections: dict[str, list[str]] = defaultdict(list)

    for sections in course_sections.values():
        for section in sections:
            if section.faculty:
                faculty_sections[section.faculty].append(section.section_id)

    return dict(faculty_sections)


def get_all_sections(
        course_sections: dict[str, list[Section]]) -> list[Section]:
    """Flatten course_sections dict to list of all sections."""
    all_sections: list[Section] = []
    for sections in course_sections.values():
        all_sections.extend(sections)
    return all_sections


def get_section_by_id(course_sections: dict[str, list[Section]],
                      section_id: str) -> Section | None:
    """Look up a section by its ID."""
    for sections in course_sections.values():
        for section in sections:
            if section.section_id == section_id:
                return section
    return None
