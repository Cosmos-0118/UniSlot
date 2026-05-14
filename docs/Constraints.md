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
| Working Days | Monday–Friday |
| Time Window | 5:00 PM – 7:00 PM |
| Preferred Parallel Courses per Slot | 11 |
| Total Weekly Slots | 55 |

---

# 4. Time Model

## Available Days

- Monday
- Tuesday
- Wednesday
- Thursday
- Friday

---

## Time Window

Courses can only occur during:

```text
5:00 PM – 7:00 PM
```

---

## Slot Structure

The week contains:

```text
55 total scheduling slots
```

Approximate representation:

```text
Monday:
  S1, S2, S3 ... S11

Tuesday:
  S12 ... S22

Wednesday:
  S23 ... S33

Thursday:
  S34 ... S44

Friday:
  S45 ... S55
```

---

# 5. Core Scheduling Constraints

## 5.1 Course Constraints

### Rule 1 — One Course Occurrence Per Week

Each course can occur only once per week.

### Valid

```text
CS101 -> Slot 12
```

### Invalid

```text
CS101 -> Slot 12
CS101 -> Slot 30
```

---

### Rule 2 — One Slot Per Course Section

Each course section must occupy exactly one slot.

---

## 5.2 Faculty Constraints

### Rule 3 — Faculty Collision Constraint

A faculty member cannot teach multiple classes simultaneously.

### Invalid Example

```text
Faculty A:
  CS101 -> Slot 15
  CS205 -> Slot 15
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

### Rule 5 — Student Collision Constraint

A student cannot attend multiple courses at the same time.

If unavoidable:

```text
Student Status = RED
```

### Example

```text
Student:
  MA101 -> Slot 20
  CS205 -> Slot 20

Result:
  RED (Clash Detected)
```

---

## 5.4 Parallel Course Constraint

At any slot:

```text
Preferred maximum parallel courses = 11
```

This limit may exceed if necessary, but should remain near 11 whenever possible.

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
- Each student may have 1–5 course registrations
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

## 10.3 Limited Slot Availability

Only:

```text
55 slots
```

must accommodate:

```text
306+ courses
```

This creates a dense optimization problem.

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

## Priority 4 — Balance Slot Distribution

Maintain balanced:

- Day usage
- Slot usage
- Parallel course count

---

# 13. Hard Constraints

Hard constraints must NEVER be violated.

---

## Hard Constraint List

### Faculty overlap forbidden

```text
Same faculty cannot teach multiple courses simultaneously
```

---

### Course scheduled once

```text
One course -> one weekly occurrence
```

---

### Valid scheduling window only

```text
Only Monday–Friday
Only 5 PM – 7 PM
```

---

### Capacity constraints enforced

```text
Sections must respect maximum size
```

---

### Split section rules enforced

```text
Different faculty required
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