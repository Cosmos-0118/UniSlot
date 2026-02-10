"""Excel parser and validator for enrollment data with bulletproof data cleaning."""

import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import pandas as pd

from unislot.models import (
    Course,
    EnrollmentRow,
    Student,
    ValidationError,
    ValidationResult,
)

# Column name mappings (lowercase -> standard name)
# Comprehensive mappings to handle various messy formats
COLUMN_MAPPINGS: dict[str, str] = {
    # Program - multiple variations
    "program": "program",
    "programme": "program",
    "branch": "program",
    "dept": "program",
    "department": "program",
    "course": "program",  # Sometimes "course" means program
    "degree": "program",
    "stream": "program",
    # Register Number - various formats found in real data
    "register number": "register_number",
    "register no": "register_number",
    "reg no": "register_number",
    "reg. no.": "register_number",
    "reg.no": "register_number",
    "reg.no.": "register_number",
    "registration number": "register_number",
    "registration no": "register_number",
    "student id": "register_number",
    "regis. no.": "register_number",
    "regno": "register_number",
    "roll no": "register_number",
    "roll number": "register_number",
    "rollno": "register_number",
    "id": "register_number",
    "student no": "register_number",
    "admission no": "register_number",
    "enrol no": "register_number",
    "enrollment no": "register_number",
    # Student Name - various formats
    "student name": "student_name",
    "name": "student_name",
    "full name": "student_name",
    "student": "student_name",
    "name of student": "student_name",
    "candidate name": "student_name",
    # Mobile - various formats
    "mobile number": "mobile_number",
    "mobile no": "mobile_number",
    "mobile": "mobile_number",
    "phone": "mobile_number",
    "phone no": "mobile_number",
    "phone number": "mobile_number",
    "contact": "mobile_number",
    "contact no": "mobile_number",
    "cell": "mobile_number",
    "mob": "mobile_number",
    # Email
    "email id": "email_id",
    "email": "email_id",
    "email address": "email_id",
    "e-mail": "email_id",
    "mail": "email_id",
    "mail id": "email_id",
    # Course Code
    "course code": "course_code",
    "code": "course_code",
    "course id": "course_code",
    "subject code": "course_code",
    "sub code": "course_code",
    "coursecode": "course_code",
    # Course Title
    "course title": "course_title",
    "title": "course_title",
    "course name": "course_title",
    "subject": "course_title",
    "subject name": "course_title",
    "subject title": "course_title",
    "coursename": "course_title",
    # Faculty
    "faculty": "faculty",
    "faculty name": "faculty",
    "instructor": "faculty",
    "teacher": "faculty",
    "professor": "faculty",
    "staff": "faculty",
    # Day (for pre-sorted schedules)
    "day": "day",
    "scheduled day": "day",
    "class day": "day",
    # Time
    "time": "time",
    "timing": "time",
    "slot": "time",
    "time slot": "time",
    # Metadata
    "registration type": "registration_type",
    "reg type": "registration_type",
    "type": "registration_type",
    "remarks": "remarks",
    "comment": "remarks",
    "comments": "remarks",
    "notes": "remarks",
    # Serial number (ignore)
    "sno.": "sno",
    "sno": "sno",
    "s.no": "sno",
    "s.no.": "sno",
    "sl.no": "sno",
    "sl no": "sno",
    "serial": "sno",
    "#": "sno",
}

REQUIRED_FIELDS = [
    "program", "register_number", "student_name", "course_code", "course_title"
]
MAX_COURSES_PER_STUDENT = 10  # Increased for flexibility


def normalize_column_name(col: str) -> str:
    """Normalize column name to standard field name with aggressive cleaning."""
    # Remove special characters, extra spaces, normalize
    cleaned = re.sub(r'[^\w\s]', '', str(col)).strip().lower()
    cleaned = re.sub(r'\s+', ' ', cleaned)  # Multiple spaces to single

    # Direct lookup
    if cleaned in COLUMN_MAPPINGS:
        return COLUMN_MAPPINGS[cleaned]

    # Try with dots/special chars removed from mapping keys
    for key, value in COLUMN_MAPPINGS.items():
        key_clean = re.sub(r'[^\w\s]', '', key).strip()
        if cleaned == key_clean:
            return value

    # Fuzzy match - check if column contains key terms
    for key, value in COLUMN_MAPPINGS.items():
        key_words = set(key.split())
        col_words = set(cleaned.split())
        if key_words and key_words.issubset(col_words):
            return value

    return cleaned.replace(" ", "_")


def clean_string(value: Any) -> str:
    """Clean a string value - handle NaN, trim, normalize whitespace."""
    if pd.isna(value):
        return ""
    s = str(value).strip()
    # Remove multiple spaces
    s = re.sub(r'\s+', ' ', s)
    # Remove weird unicode characters
    s = s.encode('ascii', 'ignore').decode('ascii')
    return s


def clean_register_number(value: Any) -> str:
    """Clean and normalize register number - handle various formats."""
    s = clean_string(value)
    if not s:
        return ""

    # Remove common prefixes/suffixes
    s = re.sub(r'^(RA|SRM|REG|ID|NO|#|:|\s)+', '', s, flags=re.IGNORECASE)

    # Remove spaces and special characters but keep alphanumeric
    s = re.sub(r'[^A-Za-z0-9]', '', s)

    # Convert to uppercase
    return s.upper()


def clean_course_code(value: Any) -> str:
    """Clean and normalize course code."""
    s = clean_string(value)
    if not s:
        return ""

    # Remove spaces within code
    s = re.sub(r'\s+', '', s)

    # Uppercase
    return s.upper()


def clean_name(value: Any) -> str:
    """Clean student/faculty name - proper case, remove extra info."""
    s = clean_string(value)
    if not s:
        return ""

    # Remove register numbers that might be in name field
    s = re.sub(r'\b[A-Z]{2}\d+[A-Z]*\d*\b', '', s, flags=re.IGNORECASE)

    # Remove email if embedded
    s = re.sub(r'\S+@\S+\.\S+', '', s)

    # Remove phone numbers
    s = re.sub(r'\b\d{10,}\b', '', s)

    # Clean up extra spaces
    s = re.sub(r'\s+', ' ', s).strip()

    # Title case
    return s.title()


def clean_program(value: Any) -> str:
    """Clean and normalize program/branch name."""
    s = clean_string(value)
    if not s:
        return ""

    # Normalize common variations
    replacements = [
        (r'b\.?\s*tech\.?', 'B.Tech'),
        (r'm\.?\s*tech\.?', 'M.Tech'),
        (r'b\.?\s*e\.?', 'B.E'),
        (r'm\.?\s*e\.?', 'M.E'),
        (r'b\.?\s*sc\.?', 'B.Sc'),
        (r'm\.?\s*sc\.?', 'M.Sc'),
        (r'b\.?\s*c\.?\s*a\.?', 'BCA'),
        (r'm\.?\s*c\.?\s*a\.?', 'MCA'),
        (r'cse', 'CSE'),
        (r'ece', 'ECE'),
        (r'eee', 'EEE'),
        (r'it\b', 'IT'),
        (r'aiml', 'AIML'),
        (r'ai\s*&?\s*ml', 'AIML'),
        (r'artificial\s+intelligence', 'AI'),
        (r'machine\s+learning', 'ML'),
        (r'data\s+science', 'DS'),
        (r'computer\s+science', 'CS'),
    ]

    result = s
    for pattern, replacement in replacements:
        result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)

    return result.strip()


def clean_mobile(value: Any) -> Optional[str]:
    """Clean and validate mobile number."""
    s = clean_string(value)
    if not s:
        return None

    # Extract digits only
    digits = re.sub(r'\D', '', s)

    # Indian mobile: 10 digits, optionally starting with 91
    if len(digits) == 12 and digits.startswith('91'):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith('0'):
        digits = digits[1:]

    if len(digits) == 10:
        return digits

    return None


def clean_email(value: Any) -> Optional[str]:
    """Clean and validate email."""
    s = clean_string(value).lower()
    if not s:
        return None

    # Basic email pattern
    match = re.search(r'[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}', s)
    if match:
        return match.group(0)

    return None


def detect_header_row(df: pd.DataFrame) -> int:
    """Detect which row contains the actual header in messy data."""
    # Check first 10 rows for header patterns
    for idx in range(min(10, len(df))):
        row = df.iloc[idx]
        row_str = ' '.join([str(v).lower() for v in row.values if pd.notna(v)])

        # Count how many required field keywords are present
        keywords = [
            'register', 'name', 'course', 'code', 'program', 'student',
            'branch'
        ]
        matches = sum(1 for kw in keywords if kw in row_str)

        if matches >= 3:
            return idx

    return 0  # Default to first row


def parse_excel(
        file_path: Path | str) -> tuple[list[EnrollmentRow], ValidationResult]:
    """
    Parse Excel file with bulletproof data cleaning.
    
    Handles:
    - Messy column names with various formats
    - Header rows not in first row
    - Mixed data types
    - Embedded special characters
    - Duplicate/missing data
    
    Args:
        file_path: Path to the Excel file
        
    Returns:
        Tuple of (list of enrollment rows, validation result)
    """
    file_path = Path(file_path)
    result = ValidationResult()
    rows: list[EnrollmentRow] = []

    # Read Excel file
    try:
        # Try reading with default settings first
        df = pd.read_excel(file_path, dtype=str, header=None)

        # Detect actual header row
        header_row = detect_header_row(df)

        if header_row > 0:
            # Re-read with correct header
            df = pd.read_excel(file_path, dtype=str, header=header_row)
        else:
            # Set first row as header
            df.columns = df.iloc[0]
            df = df[1:].reset_index(drop=True)

    except Exception as e:
        # Try alternative reading methods
        try:
            df = pd.read_excel(file_path, dtype=str, engine='openpyxl')
        except Exception:
            try:
                df = pd.read_csv(file_path, dtype=str)  # Maybe it's CSV
            except Exception:
                result.is_valid = False
                result.errors.append(
                    ValidationError(field="file",
                                    message=f"Failed to read file: {e}"))
                return rows, result

    # Remove completely empty rows
    df = df.dropna(how='all')

    # Remove completely empty columns
    df = df.dropna(axis=1, how='all')

    # Normalize column names
    df.columns = [normalize_column_name(str(col)) for col in df.columns]

    # Check for required columns with fuzzy matching
    available_cols = set(df.columns)
    missing_cols = []

    for required in REQUIRED_FIELDS:
        if required not in available_cols:
            # Try to find a similar column
            found = False
            for col in available_cols:
                if required in col or col in required:
                    # Rename to standard
                    df = df.rename(columns={col: required})
                    found = True
                    break
            if not found:
                missing_cols.append(required)

    if missing_cols:
        result.is_valid = False
        result.errors.append(
            ValidationError(
                field="columns",
                message=
                f"Missing required columns: {', '.join(missing_cols)}. Found: {', '.join(available_cols)}"
            ))
        return rows, result

    result.total_rows = len(df)

    # Parse each row with comprehensive cleaning
    for idx, row in df.iterrows():
        row_num = int(idx) + 2 if isinstance(
            idx, (int, float)) else 2  # Excel row number

        # Clean all values
        program = clean_program(row.get("program"))
        register_number = clean_register_number(row.get("register_number"))
        student_name = clean_name(row.get("student_name"))
        course_code = clean_course_code(row.get("course_code"))
        course_title = clean_string(row.get("course_title"))

        # Check required fields
        has_error = False

        if not program:
            result.errors.append(
                ValidationError(row_number=row_num,
                                field="program",
                                message="Program is empty"))
            has_error = True

        if not register_number:
            result.errors.append(
                ValidationError(row_number=row_num,
                                field="register_number",
                                message="Register number is empty"))
            has_error = True

        if not student_name:
            result.errors.append(
                ValidationError(row_number=row_num,
                                field="student_name",
                                message="Student name is empty"))
            has_error = True

        if not course_code:
            result.errors.append(
                ValidationError(row_number=row_num,
                                field="course_code",
                                message="Course code is empty"))
            has_error = True

        if not course_title:
            result.errors.append(
                ValidationError(row_number=row_num,
                                field="course_title",
                                message="Course title is empty"))
            has_error = True

        if has_error:
            continue

        # Create enrollment row with cleaned data
        try:
            enrollment = EnrollmentRow(
                program=program,
                register_number=register_number,
                student_name=student_name,
                mobile_number=clean_mobile(row.get("mobile_number")),
                email_id=clean_email(row.get("email_id")),
                course_code=course_code,
                course_title=course_title.title(),
                registration_type=clean_string(row.get("registration_type"))
                or None,
                remarks=clean_string(row.get("remarks")) or None,
            )
            rows.append(enrollment)
            result.valid_rows += 1
        except Exception as e:
            result.errors.append(
                ValidationError(row_number=row_num,
                                field="row",
                                message=f"Failed to parse row: {e}"))

    # Allow some errors but still be valid if we have good data
    error_rate = len(
        result.errors) / result.total_rows if result.total_rows > 0 else 1
    result.is_valid = error_rate < 0.2 and result.valid_rows > 0  # <20% error rate

    return rows, result


def validate_business_rules(
    rows: list[EnrollmentRow],
) -> tuple[list[EnrollmentRow], ValidationResult]:
    """
    Validate business rules on enrollment data.
    
    Rules:
    - Max courses per student (flexible limit)
    - No duplicate student+course combinations
    
    Returns:
        Tuple of (deduplicated rows, validation result)
    """
    result = ValidationResult(total_rows=len(rows))

    # Track courses per student and duplicates
    student_courses: dict[str, set[str]] = defaultdict(set)
    seen: set[tuple[str, str]] = set()
    valid_rows: list[EnrollmentRow] = []

    for row in rows:
        key = (row.register_number, row.course_code)

        # Check for duplicates
        if key in seen:
            result.warnings.append(
                ValidationError(
                    field="duplicate",
                    message=
                    f"Duplicate registration: {row.register_number} in {row.course_code}",
                    value=f"{row.register_number}:{row.course_code}"))
            continue

        seen.add(key)
        student_courses[row.register_number].add(row.course_code)
        valid_rows.append(row)

    # Check max courses per student
    for student_id, courses in student_courses.items():
        if len(courses) > MAX_COURSES_PER_STUDENT:
            result.warnings.append(
                ValidationError(
                    field="max_courses",
                    message=
                    f"Student {student_id} enrolled in {len(courses)} courses (max {MAX_COURSES_PER_STUDENT})",
                    value=student_id))

    result.valid_rows = len(valid_rows)
    result.is_valid = len(result.errors) == 0

    return valid_rows, result


def build_canonical_data(
    rows: list[EnrollmentRow],
) -> tuple[dict[str, Student], dict[str, Course]]:
    """
    Build canonical student and course mappings from enrollment rows.
    
    Returns:
        Tuple of (students dict by register_number, courses dict by code)
    """
    students: dict[str, Student] = {}
    courses: dict[str, Course] = {}
    course_enrollments: dict[str, list[str]] = defaultdict(list)

    for row in rows:
        # Update or create student
        if row.register_number not in students:
            students[row.register_number] = Student(
                register_number=row.register_number,
                name=row.student_name,
                program=row.program,
                email=row.email_id,
                mobile=row.mobile_number,
                enrolled_courses=[],
            )
        students[row.register_number].enrolled_courses.append(row.course_code)

        # Update or create course
        if row.course_code not in courses:
            courses[row.course_code] = Course(
                code=row.course_code,
                title=row.course_title,
                enrollment_count=0,
                faculty=None,
                section_count=1,
            )

        # Track enrollment
        course_enrollments[row.course_code].append(row.register_number)

    # Update course enrollment counts
    for code, student_ids in course_enrollments.items():
        courses[code].enrollment_count = len(student_ids)

    return students, courses


def load_and_validate(
    file_path: Path | str,
) -> tuple[dict[str, Student], dict[str, Course], list[EnrollmentRow],
           ValidationResult]:
    """
    Complete pipeline: load Excel, validate, and build canonical data.
    
    Returns:
        Tuple of (students, courses, enrollment_rows, validation_result)
    """
    # Parse Excel
    rows, parse_result = parse_excel(file_path)
    if not parse_result.is_valid:
        return {}, {}, rows, parse_result

    # Validate business rules
    valid_rows, biz_result = validate_business_rules(rows)

    # Merge validation results
    combined_result = ValidationResult(
        is_valid=parse_result.is_valid and biz_result.is_valid,
        errors=parse_result.errors + biz_result.errors,
        warnings=parse_result.warnings + biz_result.warnings,
        total_rows=parse_result.total_rows,
        valid_rows=biz_result.valid_rows,
    )

    # Build canonical data
    students, courses = build_canonical_data(valid_rows)

    return students, courses, valid_rows, combined_result


# ============================================================================
# FACULTY PRE-SORTED SCHEDULE PARSER
# ============================================================================

# Column mappings for pre-sorted schedule files
PRESORTED_COLUMN_MAPPINGS: dict[str, list[str]] = {
    "course_code": [
        "course code",
        "coursecode",
        "course_code",
        "code",
        "course",
        "subject code",
        "subjectcode",
        "subject_code",
        "course id",
    ],
    "course_title": [
        "course title",
        "coursetitle",
        "course_title",
        "title",
        "name",
        "course name",
        "coursename",
        "subject",
        "subject name",
    ],
    "day": [
        "day",
        "scheduled day",
        "exam day",
        "slot day",
        "assigned day",
        "date",
        "weekday",
    ],
    "slot": [
        "slot",
        "time slot",
        "timeslot",
        "period",
        "session",
        "exam slot",
        "time",
        "slot number",
        "slot_number",
    ],
    "section": [
        "section",
        "section id",
        "sec",
        "batch",
        "group",
    ],
}


@dataclass
class PresortedEntry:
    """Represents a single entry in a pre-sorted schedule."""
    course_code: str
    course_title: str
    day: str
    slot: int
    section: str | None = None


@dataclass
class PresortedStudent:
    """Student data extracted from presorted schedule."""
    register_number: str
    name: str
    program: str
    enrolled_courses: list[str]  # List of course codes


@dataclass
class PresortedSchedule:
    """Complete pre-sorted schedule from faculty upload."""
    entries: list[PresortedEntry]
    day_slot_map: dict[str, dict[int, list[str]]]  # day -> slot -> [courses]
    course_day_map: dict[str, str]  # course -> day
    course_slot_map: dict[str, int]  # course -> slot
    students: dict[str, PresortedStudent] | None = None  # reg_no -> student


# Day normalization map
DAY_NORMALIZE: dict[str, str] = {
    "MON": "Monday",
    "MONDAY": "Monday",
    "TUE": "Tuesday",
    "TUESDAY": "Tuesday",
    "WED": "Wednesday",
    "WEDNESDAY": "Wednesday",
    "THU": "Thursday",
    "THURSDAY": "Thursday",
    "FRI": "Friday",
    "FRIDAY": "Friday",
    "SAT": "Saturday",
    "SATURDAY": "Saturday",
    "SUN": "Sunday",
    "SUNDAY": "Sunday",
}


def normalize_day(day_str: str) -> list[str]:
    """
    Normalize day string to standard format.
    Handles comma-separated days like "MONDAY, WEDNESDAY".
    Returns list of normalized days.
    """
    if not day_str or pd.isna(day_str):
        return []

    day_str = str(day_str).strip().upper()

    # Split on comma or space+comma
    parts = re.split(r'[,\s]+', day_str)

    days = []
    for part in parts:
        part = part.strip()
        if part in DAY_NORMALIZE:
            days.append(DAY_NORMALIZE[part])

    return days


def parse_presorted_schedule(
    file_path: Path | str,
) -> tuple[PresortedSchedule | None, ValidationResult]:
    """
    Parse a pre-sorted schedule Excel file (from faculty).
    
    Handles the format where each row is a student with multiple course-day pairs:
    - Course Code, Course Title, Remarks, DAY (first course)
    - COURSE CODE, DAY.1 (second course)
    - COURSE CODE.1, DAY.2 (third course)
    - etc.
    
    Returns:
        Tuple of (PresortedSchedule or None, ValidationResult)
    """
    file_path = Path(file_path)
    warnings: list[ValidationError] = []

    try:
        # Read Excel file
        df = None
        for engine in ["openpyxl", "xlrd", None]:
            try:
                if engine:
                    df = pd.read_excel(file_path, engine=engine)
                else:
                    df = pd.read_excel(file_path)
                break
            except Exception:
                continue

        if df is None or df.empty:
            return None, ValidationResult(
                is_valid=False,
                errors=[
                    ValidationError(row_number=0,
                                    field="file",
                                    message="Could not read schedule file")
                ],
                warnings=[],
                total_rows=0,
                valid_rows=0,
            )

        # Normalize column names
        df.columns = [str(c).strip() for c in df.columns]
        col_names = [c.lower() for c in df.columns]

        # Find course code and day column pairs
        # Format: "Course Code" -> "DAY", "COURSE CODE" -> "DAY.1", etc.
        course_day_pairs: list[tuple[str, str]] = []

        for i, col in enumerate(df.columns):
            col_lower = col.lower()
            if 'course code' in col_lower and 'title' not in col_lower:
                # Look for corresponding DAY column
                # First course: "Course Code" -> "DAY"
                # Others: "COURSE CODE" -> "DAY.1", "COURSE CODE.1" -> "DAY.2", etc.

                # Search for matching day column
                # Extract the suffix if any (e.g., ".1", ".2")
                suffix_match = re.search(r'(\.\d+)$', col)
                suffix = suffix_match.group(1) if suffix_match else ""

                # Find corresponding day column
                day_col = None
                for j, other_col in enumerate(df.columns):
                    other_lower = other_col.lower()
                    if 'day' in other_lower:
                        # Check if suffixes match
                        other_suffix_match = re.search(r'(\.\d+)$', other_col)
                        other_suffix = other_suffix_match.group(
                            1) if other_suffix_match else ""

                        # Match: no suffix -> no suffix, .1 -> .1, etc.
                        if suffix == "" and other_suffix == "" and j > i:
                            day_col = other_col
                            break
                        elif suffix and other_suffix:
                            # .1 matches with .1, .2 with .2
                            suffix_num = int(suffix.replace('.', ''))
                            other_num = int(other_suffix.replace('.', ''))
                            if suffix_num == other_num - 1:  # COURSE CODE.1 -> DAY.2
                                day_col = other_col
                                break

                # Also check for DAY column right after or with matching suffix
                if day_col is None:
                    # Try the next few columns
                    for offset in range(1, 5):
                        if i + offset < len(df.columns):
                            next_col = df.columns[i + offset]
                            if 'day' in next_col.lower():
                                day_col = next_col
                                break

                if day_col:
                    course_day_pairs.append((col, day_col))

        if not course_day_pairs:
            # Fallback: First "Course Code" with first "DAY"
            course_col = None
            day_col = None
            for col in df.columns:
                if 'course code' in col.lower() and 'title' not in col.lower(
                ) and not course_col:
                    course_col = col
                if col.lower() == 'day' and not day_col:
                    day_col = col
                if course_col and day_col:
                    course_day_pairs.append((course_col, day_col))
                    break

        if not course_day_pairs:
            return None, ValidationResult(
                is_valid=False,
                errors=[
                    ValidationError(
                        row_number=0,
                        field="columns",
                        message="Could not find Course Code and Day columns")
                ],
                warnings=[],
                total_rows=len(df),
                valid_rows=0,
            )

        # Find student info columns
        reg_col = None
        name_col = None
        program_col = None

        for col in df.columns:
            col_lower = col.lower()
            if 'register' in col_lower or col_lower == 'reg no':
                reg_col = col
            elif col_lower in ['student name', 'name', 'student']:
                name_col = col
            elif 'program' in col_lower:
                program_col = col

        # Parse all course-day mappings AND student enrollments
        entries: list[PresortedEntry] = []
        course_day_map: dict[str, set[str]] = {}  # course -> set of days
        day_slot_map: dict[str, dict[int, list[str]]] = {}
        course_slot_map: dict[str, int] = {}
        students: dict[str, PresortedStudent] = {}  # reg_no -> student

        valid_entries = 0

        for idx, row in df.iterrows():
            row_num = int(idx) + 2 if isinstance(idx, (int, float)) else 2

            # Extract student info
            reg_no = ""
            if reg_col:
                reg_no = clean_register_number(str(row.get(reg_col, "")))

            student_name = ""
            if name_col:
                student_name = clean_name(str(row.get(name_col, "")))

            program = ""
            if program_col:
                program = clean_program(str(row.get(program_col, "")))

            # Track courses for this student
            student_courses: list[str] = []

            for course_col, day_col in course_day_pairs:
                try:
                    course_code = clean_course_code(
                        str(row.get(course_col, "")))
                    if not course_code:
                        continue

                    day_raw = str(row.get(day_col, ""))
                    days = normalize_day(day_raw)

                    if not days:
                        continue

                    # Track course -> days mapping
                    if course_code not in course_day_map:
                        course_day_map[course_code] = set()
                    course_day_map[course_code].update(days)

                    # Track course for student enrollment
                    if course_code not in student_courses:
                        student_courses.append(course_code)

                    # Create entry for each day
                    for day in days:
                        entry = PresortedEntry(
                            course_code=course_code,
                            course_title="",
                            day=day,
                            slot=1,  # Default slot
                            section=None,
                        )
                        entries.append(entry)
                        valid_entries += 1

                        # Build day_slot_map
                        if day not in day_slot_map:
                            day_slot_map[day] = {}
                        if 1 not in day_slot_map[day]:
                            day_slot_map[day][1] = []
                        if course_code not in day_slot_map[day][1]:
                            day_slot_map[day][1].append(course_code)

                        course_slot_map[course_code] = 1

                except Exception as e:
                    warnings.append(
                        ValidationError(row_number=row_num,
                                        field="parse",
                                        message=f"Error: {str(e)}"))

            # Create/update student record after processing all their courses
            if reg_no and student_courses:
                if reg_no in students:
                    # Merge course lists
                    existing = students[reg_no]
                    for c in student_courses:
                        if c not in existing.enrolled_courses:
                            existing.enrolled_courses.append(c)
                else:
                    students[reg_no] = PresortedStudent(
                        register_number=reg_no,
                        name=student_name,
                        program=program,
                        enrolled_courses=student_courses,
                    )

        if not entries:
            return None, ValidationResult(
                is_valid=False,
                errors=[
                    ValidationError(row_number=0,
                                    field="entries",
                                    message="No valid schedule entries found")
                ],
                warnings=warnings,
                total_rows=len(df),
                valid_rows=0,
            )

        # Convert course_day_map to use first day for each course
        final_course_day_map = {
            code: sorted(list(days))[0] if days else "Monday"
            for code, days in course_day_map.items()
        }

        # Deduplicate entries
        seen = set()
        unique_entries = []
        for entry in entries:
            key = (entry.course_code, entry.day)
            if key not in seen:
                seen.add(key)
                unique_entries.append(entry)

        schedule = PresortedSchedule(
            entries=unique_entries,
            day_slot_map=day_slot_map,
            course_day_map=final_course_day_map,
            course_slot_map=course_slot_map,
            students=students if students else None,
        )

        return schedule, ValidationResult(
            is_valid=True,
            errors=[],
            warnings=warnings,
            total_rows=len(df),
            valid_rows=len(unique_entries),
        )

    except Exception as e:
        return None, ValidationResult(
            is_valid=False,
            errors=[
                ValidationError(
                    row_number=0,
                    field="file",
                    message=f"Failed to parse schedule file: {str(e)}")
            ],
            warnings=[],
            total_rows=0,
            valid_rows=0,
        )
