# Course Scheduling Problem Statement

## 1. Objective

The objective is to design an optimized evening course scheduling system such that:

- No student has overlapping classes, wherever possible.
- If a clash is unavoidable, the affected student is flagged as **Red**.
- All scheduling constraints related to time, faculty, student enrollment, and class capacity are satisfied.

The primary goal is to **minimize the number of students with timetable clashes**, ideally reaching zero.

---

## 2. Scale of the System

| Entity                                | Approximate Count |
|------                                 |------------------|
| Total Students                        | ~2,600 |
| Total Courses                         | 106+ |
| Maximum Courses per Student           | 5 |
| Days Available                        | Monday to Friday |
| Time Window                           | 5:00 PM – 7:00 PM |
| Parallel Courses per Slot             | confortable is 11 can be more too|
| Total Weekly Slots                    | 55 (5 days × 11 slots) |

---

## 3. Time Constraints

- All courses must be scheduled **only between 5:00 PM and 7:00 PM**.
- Courses can be conducted **only from Monday to Friday**.
- At any given time slot:
  - A maximum of **11 courses** can run in parallel (this number is flexible, but 11 is the preferred optimal value).

---

## 4. Course and Faculty Constraints

- Each course is taught by **exactly one faculty member**.
- One course can happen only **once per week**.
- A faculty member **cannot teach more than one course at the same time**.
- Each course (or course section) must be scheduled in **one time slot**.

---

## 5. Student Enrollment Constraints

- Each student may enroll in **a maximum of 5 courses**.
- A student **cannot attend more than one course at the same time**.
- If two or more enrolled courses of a student are scheduled in the same slot:
  - That student is marked as **Red (Clash Detected)**.

---

## 6. Class Capacity Constraints

- Maximum class size: **60 to 65 students**

If the enrollment for a course exceeds the maximum capacity:

- The course must be **split into multiple sections**.
- Example:
  - 80 students → 2 sections of 40 students each.
- Each section:
  - Same **time slot**
  - Is taught by the **Different faculty**
  - Cannot overlap with another section of the same course

---

## 7. Dataset Description (Input)

Each row in the dataset represents **one student registered for one course**.

### 7.1 Student Information
- Program
- Register Number
- Student Name
- Mobile Number
- Email ID

### 7.2 Course Information
- Course Code
- Course Title

### 7.3 Registration Metadata
- Registration Type (Online / Manual)
- Remarks

### 7.4 Important Observations
- A student may appear in **multiple rows** (one per registered course).
- Each student can have **1 to 5 course entries**.
- Some courses may have high enrollment and require splitting.

---

## 8. Key Scheduling Challenges

### 8.1 Student Conflict Density
- Many students share common foundational or popular courses.
- Poor slot assignment can lead to a large number of clashes.

### 8.2 Course Splitting Complexity
- Splitting a course increases the total number of scheduling entities.
- Each split section behaves like an independent course with constraints.

### 8.3 Limited Time Slots
- Only **55 total slots** are available for scheduling over the week.
- Scheduling 106+ courses within this window is a non-trivial optimization problem.

---

## 9. Expected Output

### 9.1 Course Schedule
For each course or course section:
- Assigned Day
- Assigned Time Slot
- Assigned Faculty
- Assigned Student Group / Section

### 9.2 Student Clash Report
For each student:
- List of registered courses
- Clash status:
  - 🟢 Green – No clashes
  - 🔴 Red – One or more overlapping courses

---

## 10. Optimization Goal

**Primary Goal:**
- Minimize the number of students marked as **Red**.

**Secondary Goals:**
- Balance course distribution across weekdays.
- Reduce the number of split sections.
- Maintain an even load of parallel courses per day.

---

## 11. Problem Classification

This problem can be modeled as a **constraint satisfaction and optimization problem**, closely related to:

- Timetabling problems
- Graph coloring
- Integer Linear Programming (ILP)

It is computationally complex due to the high number of constraints and overlapping requirements.