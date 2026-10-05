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

The main objective is to give as many students as possible a completely
clash-free timetable.

---

# 2. Core Objectives

## Primary Objective

Maximize the number of students with no timetable conflicts. For a fixed
enrollment dataset, this is equivalent to minimizing the number of **RED
students**: unique students with at least one same-day course overlap.

Count each affected student **once**, regardless of how many of their courses
overlap or how many weekdays contain a clash. For example, one student with
three simultaneous courses counts as one RED student, although those courses
create three conflicting pairs.

A timetable conflict occurs when:

- A student is enrolled in multiple courses
- Those courses are scheduled in the same time slot

Ideal outcome:

```text
0 RED students — every student has a clash-free timetable
```

Zero is not always attainable (conflict cliques larger than the number of
weekdays, Saturday-domain pigeonhole). Residual clashes are minimized, not
treated as infeasibility. Among structurally feasible timetables, protecting
more students takes precedence over reducing the total number of conflicting
course pairs.

---

## Secondary Objectives

Use this lexicographic order: a lower-priority improvement must never worsen
a higher-priority objective.

1. **Minimize RED students** (primary): maximize clash-free students.
2. **Minimize clash weight**: among timetables with the same minimum RED count,
   minimize conflicting course pairs, weighted by shared students.
3. **Balance weekday section loads**: among timetables tied on RED and clash
   weight, spread simultaneous sections across the available weekdays.
4. **Reduce parallel excess**: among remaining ties, prefer fewer sections above
   the comfort target of 11 per weekday.

Faculty, capacity, split-section synchronization, and permitted weekdays remain
hard constraints. They cannot be traded for a better objective score. Avoid
unnecessary section splitting while meeting the capacity rules.

### Implementation status and optimality

This RED-first policy was confirmed on 5 October 2026 and is implemented by the
current solver: **RED students → clash weight → balance → parallel excess**.
New snapshots and summaries carry `objective_policy: "red-first-v1"`. Older
folders without that field retain their historical objective and certificate
meanings. Frozen edits with no new course placement preserve the prior marker,
including its absence.

`proven_optimal: true` certifies that no structurally feasible timetable has
fewer RED students. `proven_levels` lists completed proofs in priority order:
`red_students`, `clash_weight`, `balance_and_parallel`. A full lexicographic
claim requires all three levels. In a bounded run, tie-breakers operate at the
best RED count found; their conditional proofs do not prove that RED count
is globally minimal. `red_bound` and `red_gap` describe the primary
proof; `clash_bound` and `clash_gap` describe the pair-cost proof conditional on
fixing the chosen RED count. Bounded runs may return an audited feasible timetable
without claiming those proofs. The `--clash-only` diagnostic optimizes pair cost
without proving RED and therefore keeps `proven_optimal` false; `--primary-only`
selects RED-first ranking for portfolio runs. Gap limits apply to the active
primary RED phase.

### Roster, faculty, and metric integrity

Student course enrollments define the solver's canonical conflict graph. The
bridge checks that every modeled enrollment appears in exactly one section and
that section-derived course edges match the canonical roster; malformed
memberships and unknown solver references are rejected. Section allocation
balances capacity loads and uses program cohesion only to break equal-load
ties, so changing membership cannot change the course-level conflict objective.

Known instructors remain the same resource across split sections and courses.
Unassigned extra sections use unique `Planning:<section id>` placeholders;
these indicate staffing requirements but do not establish real staff
availability. Weekday balance uses the active five- or six-day calendar, and
metrics reject missing or invalid section assignments.

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
- Saturday (Maths courses when enabled, or explicitly allowlisted course codes)

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

### Rule 5 — One Course Per Student Per Weekday (primary objective)

A student should attend at most one enrolled course on any weekday.

Every course on a weekday shares the same 5–7 PM session, so two enrolled courses
on the same weekday are a timetable clash. **Minimizing the number of students
with any such clash is the highest-priority optimization target**, not a hard
forbid: some enrollments are structurally
unable to reach zero clashes (conflict cliques larger than the number of
weekdays, Saturday-domain pigeonhole). The engine must **minimize RED students**,
never reject a structurally feasible timetable because a clash remains.

### Example (clash to minimize)

```text
Student:
  MA101 -> Monday, band 2
  CS205 -> Monday, band 8

Result:
  RED — two courses on Monday (same 5–7 PM session)
```

---

### Rule 6 — Student Collision Constraint

A student cannot attend multiple courses at the same time. On this time model
that is the same event as Rule 5 (one evening session per weekday).

If a student's enrolled courses share a weekday:

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

Ideal outcome is 0 RED students. When that is mathematically impossible, the
solver behavior is to minimize RED count first, then clash weight among
timetables tied on that count, as described in §2.

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
Minimize unique students with at least one clash
Equivalently: maximize students with a completely clash-free timetable
```

---

## Priority 2 — Minimize Clash Weight

Among timetables tied on the minimum RED count, minimize the number of
conflicting course pairs, weighted by their shared students. Never affect an
additional student merely to reduce this pair count.

---

## Priority 3 — Balance Weekday Distribution

Among timetables tied on RED count and clash weight, balance section loads over
the available weekdays.

---

## Priority 4 — Reduce Parallel Excess

Among timetables also tied on weekday balance, minimize sections above the
comfort target of 11 simultaneous sections per weekday. This is a preference,
not a hard capacity limit.

Faculty overlap and section-capacity violations are forbidden hard constraints
at every optimization level (see §13).

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
Saturday reserved for Maths courses (when enabled) or explicitly allowlisted course codes
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
All split sections of a course share one weekday
```

---

# 14. Soft Constraints

Soft constraints are optimization targets.

---

## Soft Constraint List

- **Priority 1 — Minimize unique RED students** (Rules 5–6). Zero is ideal but
  not always attainable; never treat residual clashes as infeasibility.
- **Priority 2 — Minimize clash weight** without increasing RED count.
- **Priority 3 — Balance weekday section loads** without increasing RED count
  or clash weight.
- **Priority 4 — Reduce parallel excess** without worsening the earlier goals.

These priorities are lexicographic, rather than interchangeable weighted
penalties. Fewer affected students must win even when that timetable has more
conflicting course pairs.

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
