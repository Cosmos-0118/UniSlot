"""Pydantic models for UniSlot scheduling system."""

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class Day(str, Enum):
    """Days of the week for scheduling."""
    MONDAY = "Monday"
    TUESDAY = "Tuesday"
    WEDNESDAY = "Wednesday"
    THURSDAY = "Thursday"
    FRIDAY = "Friday"
    SATURDAY = "Saturday"


DAY_INDEX = {
    Day.MONDAY: 0,
    Day.TUESDAY: 1,
    Day.WEDNESDAY: 2,
    Day.THURSDAY: 3,
    Day.FRIDAY: 4,
    Day.SATURDAY: 5,
}

INDEX_TO_DAY = {v: k for k, v in DAY_INDEX.items()}


class ClashStatus(str, Enum):
    """Student clash status."""
    GREEN = "Green"  # No clashes
    RED = "Red"  # Has clashes


class RegistrationType(str, Enum):
    """Registration type from input."""
    ONLINE = "Online"
    MANUAL = "Manual"


# ============== Input Models ==============


class EnrollmentRow(BaseModel):
    """Raw enrollment row from Excel input.
    
    Each row represents one student registered for one course.
    """
    # Student info
    program: str = Field(...,
                         description="Student's program (e.g., B.Tech CSE)")
    register_number: str = Field(
        ..., description="Unique student ID (keep as string)")
    student_name: str = Field(..., description="Full name of student")
    mobile_number: Optional[str] = Field(None, description="Contact number")
    email_id: Optional[str] = Field(None, description="Student email")

    # Course info
    course_code: str = Field(..., description="Unique course identifier")
    course_title: str = Field(..., description="Course name")

    # Metadata
    registration_type: Optional[str] = Field(None, description="Online/Manual")
    remarks: Optional[str] = Field(None, description="Additional notes")


# ============== Canonical Models ==============


class Student(BaseModel):
    """Canonical student representation."""
    register_number: str = Field(..., description="Unique student ID")
    name: str
    program: str
    email: Optional[str] = None
    mobile: Optional[str] = None
    enrolled_courses: list[str] = Field(default_factory=list,
                                        description="List of course codes")


class Course(BaseModel):
    """Canonical course representation."""
    code: str = Field(..., description="Unique course code")
    title: str
    enrollment_count: int = Field(0, ge=0)
    faculty: Optional[str] = Field(None,
                                   description="Faculty teaching this course")
    section_count: int = Field(
        1, ge=1, description="Number of sections (1 if not split)")


class Section(BaseModel):
    """A section of a course (course may have multiple sections if split)."""
    section_id: str = Field(
        ..., description="Unique section ID: {course_code}_S{n}")
    course_code: str
    course_title: str
    section_number: int = Field(1, ge=1)
    faculty: Optional[str] = None
    capacity: int = Field(65, ge=1)
    enrolled_students: list[str] = Field(default_factory=list,
                                         description="Register numbers")
    programs: list[str] = Field(
        default_factory=list,
        description="Programs/branches of enrolled students")

    @property
    def enrollment_count(self) -> int:
        return len(self.enrolled_students)


# ============== Scheduling Models ==============


class Slot(BaseModel):
    """A time slot (one per day, 5-7 PM)."""
    day: Day
    slot_index: int = Field(...,
                            ge=0,
                            le=5,
                            description="0=Monday, 5=Saturday")
    time: str = Field(default="5:00 PM - 7:00 PM")


class ScheduleEntry(BaseModel):
    """A scheduled section in the timetable."""
    section_id: str
    course_code: str
    course_title: str
    section_number: int
    day: Day
    time: str = Field(default="5:00 PM - 7:00 PM")
    faculty: Optional[str] = None
    enrollment_count: int = Field(0, ge=0)
    programs: str = Field(default="",
                          description="Comma-separated programs/branches")


class Schedule(BaseModel):
    """Complete schedule output."""
    entries: list[ScheduleEntry] = Field(default_factory=list)
    total_sections: int = 0
    solver_used: str = Field("cp-sat", description="'cp-sat' or 'greedy'")
    solver_time_seconds: float = 0.0
    total_clashes: int = 0


# ============== Clash Report Models ==============


class StudentClashReport(BaseModel):
    """Clash report for a single student."""
    register_number: str
    student_name: str
    program: str
    enrolled_courses: list[str] = Field(default_factory=list,
                                        description="Course codes")
    status: ClashStatus = ClashStatus.GREEN
    clashing_courses: list[tuple[str, str]] = Field(
        default_factory=list, description="Pairs of course codes that clash")
    clashing_day: Optional[Day] = None


class ClashReport(BaseModel):
    """Full clash report for all students."""
    total_students: int = 0
    students_with_clashes: int = 0
    clash_free_students: int = 0
    clash_percentage: float = 0.0
    reports: list[StudentClashReport] = Field(default_factory=list)


# ============== Conflict Graph Models ==============


class ConflictEdge(BaseModel):
    """Edge in conflict graph between two sections."""
    section_a: str
    section_b: str
    weight: int = Field(..., ge=1, description="Number of shared students")
    shared_students: list[str] = Field(default_factory=list,
                                       description="Register numbers")


class ConflictGraph(BaseModel):
    """Conflict graph for scheduling optimization."""
    sections: list[str] = Field(default_factory=list,
                                description="All section IDs (nodes)")
    edges: list[ConflictEdge] = Field(default_factory=list)

    def get_neighbors(self, section_id: str) -> dict[str, int]:
        """Get neighbors of a section with edge weights."""
        neighbors: dict[str, int] = {}
        for edge in self.edges:
            if edge.section_a == section_id:
                neighbors[edge.section_b] = edge.weight
            elif edge.section_b == section_id:
                neighbors[edge.section_a] = edge.weight
        return neighbors


# ============== Validation Models ==============


class ValidationError(BaseModel):
    """A validation error found in input data."""
    row_number: Optional[int] = None
    field: str
    message: str
    value: Optional[str] = None


class ValidationResult(BaseModel):
    """Result of validating input data."""
    is_valid: bool = True
    errors: list[ValidationError] = Field(default_factory=list)
    warnings: list[ValidationError] = Field(default_factory=list)
    total_rows: int = 0
    valid_rows: int = 0
