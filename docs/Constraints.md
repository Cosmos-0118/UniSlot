# Evening Course Scheduling Optimization Problem

---

# 1. Problem Overview

Design an optimized university evening course scheduling system.

The scheduler must assign all courses (or course sections) into valid weekly time slots while satisfying constraints related to:

- Students
- Faculty
- Course capacity
- Time availability
- Parallel course limits

The main objective is to minimize timetable clashes for students.

---

# 2. Core Objectives

## Primary Objective

Minimize the number of students having timetable conflicts.

A timetable conflict occurs when:

- A student is enrolled in multiple courses
- Those courses are scheduled in the same time slot

Ideal outcome:

```text
0 student clashes
```

---

## Secondary Objectives

1. Balance course distribution across weekdays
2. Reduce unnecessary course splitting
3. Maintain stable parallel course counts
4. Avoid faculty overlaps
5. Use slots efficiently

---

# 3. System Scale

| Entity | Approximate Count |
|---|---|
| Total Students | ~2600 |
| Total Courses | 306+ |
| Max Courses per Student | 5 |
| Working Days | Monday–Saturday |
| Time Window | 5:00 PM – 7:00 PM |
| Preferred Parallel Courses per Weekday | 11 |
| Total Weekly Sessions | 6 |

---

# 4. Time Model

## Available Days

- Monday
- Tuesday
- Wednesday
- Thursday
- Friday
- Saturday (Strictly Maths courses only)

---

## Time Window

Courses can only occur during:

```text
5:00 PM – 7:00 PM
```

---

## Slot Structure

The week contains six real scheduling choices:

```text
Monday · Tuesday · Wednesday · Thursday · Friday · Saturday
```

Each weekday has one simultaneous evening session from 5:00 PM – 7:00 PM.

Parallel lanes are display-only labels for courses running at the same time on that weekday.
They are not distinct times. The comfortable target is about 11 simultaneous courses per weekday;
the scheduler may exceed that when enrollment density requires it.

```text
Monday 5:00–7:00 PM:
  Parallel lane 1, Parallel lane 2, ...
```

---

# 5. Core Scheduling Constraints

## 5.1 Course Constraints

### Rule 1 — One Course Occurrence Per Week

Each course can occur only once per week.

### Valid

```text
CS101 -> Monday
```

### Invalid

```text
CS101 -> Monday
CS101 -> Wednesday
```

---

### Rule 2 — One Weekday Per Course Section

Each course section must occupy exactly one weekday.

---

## 5.2 Faculty Constraints

### Rule 3 — Faculty Collision Constraint

A faculty member cannot teach multiple classes on the same weekday.

### Invalid Example

```text
Faculty A:
  CS101 -> Monday
  CS205 -> Monday
```

---

## 5.3 Student Constraints

### Rule 4 — Student Enrollment Limit

Each student may enroll in:

```text
Minimum: 1 course
Maximum: 5 courses
```

---

### Rule 5 — One Course Per Student Per Weekday

A student can attend at most one enrolled course on any weekday.

This is a hard constraint: every course on a weekday shares the same 5–7 PM session,
so a student cannot attend more than one course that day.

### Invalid Example

```text
Student:
  MA101 -> Monday, band 2
  CS205 -> Monday, band 8

Result:
  Invalid — two courses on Monday
```

---

### Rule 6 — Student Collision Constraint

A student cannot attend multiple courses at the same time.

Same-time collisions are therefore also invalid. If an existing or provisional schedule contains
either type of student conflict:

```text
Student Status = RED
```

### Example

```text
Student:
  MA101 -> Tuesday
  CS205 -> Tuesday

Result:
  RED (Clash Detected)
```

---

## 5.4 Parallel Course Constraint

On any weekday evening session:

```text
Preferred maximum parallel courses = 11
```

This limit may exceed if necessary (dense enrollments often require ~70 simultaneous sections per weekday), but the solver prefers balancing load and staying near 11 when possible.

---

# 6. Course Capacity Constraints

## Maximum Class Size

Preferred section size:

```text
60–65 students
```

---

## Course Splitting Rule

If enrollment exceeds capacity:

- Split the course into multiple sections

### Example

```text
Enrollment = 80 students

Result:
  Section A -> 40 students
  Section B -> 40 students
```

---

# 7. Split Section Constraints

Each split section behaves as an independent schedulable entity.

---

## Rule 1 — Same Time Slot

All sections of the same course must occur simultaneously.

### Valid

```text
CS101-A -> Slot 10
CS101-B -> Slot 10
```

---

## Rule 2 — Different Faculty

Each section must have different faculty.

### Valid

```text
CS101-A -> Faculty A
CS101-B -> Faculty B
```

---

## Rule 3 — Student Exclusivity

A student may belong to only one section of the same course.

---

# 8. Dataset Description

Each dataset row represents:

```text
One student registered for one course
```

---

## 8.1 Student Fields

```text
Program
Register Number
Student Name
Mobile Number
Email ID
```

---

## 8.2 Course Fields

```text
Course Code
Course Title
```

---

## 8.3 Registration Metadata

```text
Registration Type
Remarks
```

---

# 9. Dataset Characteristics

- A student may appear in multiple rows
- One row = one course registration
- Each student may have one or more course registrations
- Some courses may require section splitting

---

# 10. Scheduling Challenges

## 10.1 Student Conflict Density

Many students share common or popular courses.

Poor scheduling may create large-scale clashes.

---

## 10.2 Course Splitting Complexity

Splitting increases:

- Number of scheduling entities
- Faculty requirements
- Constraint complexity

---

## 10.3 Limited Weekday Availability

Only:

```text
6 weekday evening sessions
```

must accommodate:

```text
306+ courses
```

with simultaneous parallel lanes on each weekday. This creates a dense optimization problem.

---

# 11. Conflict Graph Model

The problem can be modeled using a weighted conflict graph.

---

## Node

Each node represents:

```text
A course or course section
```

---

## Edge

An edge exists between two courses if:

```text
At least one student is enrolled in both courses
```

---

## Edge Weight

Weight = number of overlapping students.

### Example

```text
CS101 <-> MA201
Weight = 42
```

Meaning:

```text
42 students take both courses
```

Higher weight means:

```text
Scheduling together is highly risky
```

---

# 12. Optimization Goals

## Priority 1 — Minimize RED Students

Highest priority.

Goal:

```text
Minimize total timetable clashes
```

---

## Priority 2 — Satisfy Faculty Constraints

No faculty overlap allowed.

---

## Priority 3 — Satisfy Capacity Constraints

Avoid oversized sections.

---

## Priority 4 — Balance Weekday Distribution

Maintain balanced:

- Day usage
- Parallel course count per weekday (comfort target ≈ 11, may exceed when needed)

---

# 13. Hard Constraints

Hard constraints must NEVER be violated.

---

## Hard Constraint List

### Faculty overlap forbidden

```text
Same faculty cannot teach multiple courses on the same weekday
```

---

### Course scheduled once

```text
One course -> one weekly occurrence
```

---

### Valid scheduling window only

```text
Only Monday–Saturday
Only 5 PM – 7 PM
Saturday exclusively reserved for Maths courses
```

---

### Capacity constraints enforced

```text
Sections must respect maximum size
```

---

### Student daily attendance enforced

```text
Each student may attend at most one course per weekday
```

---

### Split section rules enforced

```text
Different faculty required
All split sections of a course share one weekday
```

---

# 14. Soft Constraints

Soft constraints are optimization targets.

---

## Soft Constraint List

- Minimize student clashes
- Reduce RED students
- Reduce unnecessary splitting
- Maintain balanced parallel load
- Spread courses evenly across the week

---

## 15.3 Scheduling Statistics

Example metrics:

```text
Total Students
Students Without Clash
Students With Clash
Total Clash Count
Total Split Sections
Average Parallel Courses Per Slot
Faculty Conflicts
Unused Slots
```

---

# 16. Problem Classification

This is a:

```text
Constraint Satisfaction + Optimization Problem
```

Closely related to:

- University Timetabling
- Weighted Graph Coloring
- Constraint Programming
- Integer Linear Programming (ILP)

---

# 17. Complexity Characteristics

The problem is computationally difficult because of:

- Thousands of students
- Hundreds of courses
- Dense overlap relationships
- Multiple interacting constraints
- Limited scheduling slots

This problem belongs to the class of:

```text
NP-Hard Timetabling Optimization Problems
```