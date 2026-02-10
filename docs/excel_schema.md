# Input Excel Schema

## Overview

The input file must be an Excel file (.xlsx) with enrollment data. Each row represents **one student registered for one course**.

A student enrolled in 3 courses will have 3 rows in the file.

---

## Required Columns

| Column Name       | Type   | Required | Description                                                                        |
| ----------------- | ------ | -------- | ---------------------------------------------------------------------------------- |
| Program           | String | ✅ Yes   | Student's academic program (e.g., "B.Tech CSE", "M.Tech AI")                       |
| Register Number   | String | ✅ Yes   | Unique student identifier. **Must be treated as string** to preserve leading zeros |
| Student Name      | String | ✅ Yes   | Full name of the student                                                           |
| Mobile Number     | String | ❌ No    | Contact phone number                                                               |
| Email ID          | String | ❌ No    | Student email address                                                              |
| Course Code       | String | ✅ Yes   | Unique course identifier (e.g., "CS501", "EC302")                                  |
| Course Title      | String | ✅ Yes   | Full course name                                                                   |
| Registration Type | String | ❌ No    | "Online" or "Manual"                                                               |
| Remarks           | String | ❌ No    | Additional notes                                                                   |

---

## Column Name Variations

The parser accepts these alternate column names:

| Standard Name   | Also Accepts                                      |
| --------------- | ------------------------------------------------- |
| Register Number | Reg No, Reg. No., Registration Number, Student ID |
| Student Name    | Name, Full Name                                   |
| Mobile Number   | Mobile, Phone, Contact                            |
| Email ID        | Email, Email Address                              |
| Course Code     | Code, Course ID                                   |
| Course Title    | Title, Course Name                                |

---

## Business Rules Validated

1. **Max 5 courses per student**: If a student has more than 5 course registrations, a warning is raised
2. **No duplicate registrations**: Same student + same course should not appear twice
3. **Required fields**: Program, Register Number, Student Name, Course Code, Course Title must be non-empty
4. **Course capacity**: Courses with >65 students will be automatically split into sections

---

## Example Data

| Program    | Register Number | Student Name | Course Code | Course Title     |
| ---------- | --------------- | ------------ | ----------- | ---------------- |
| B.Tech CSE | 21BCS001        | Alice Kumar  | CS501       | Machine Learning |
| B.Tech CSE | 21BCS001        | Alice Kumar  | CS502       | Data Mining      |
| B.Tech CSE | 21BCS002        | Bob Singh    | CS501       | Machine Learning |
| B.Tech ECE | 21BEC001        | Carol Rao    | EC301       | VLSI Design      |

In this example:

- Alice is enrolled in 2 courses (CS501, CS502)
- Bob is enrolled in 1 course (CS501)
- CS501 has 2 students enrolled

---

## Output Files

### 1. Course Schedule (schedule.xlsx)

| Column       | Description                     |
| ------------ | ------------------------------- |
| Course Code  | Course identifier                |
| Course Title | Course name                     |
| Section      | Section number (1 if not split) |
| Day          | Monday-Friday                   |
| Time         | "5:00 PM - 7:00 PM"             |
| Faculty      | Assigned faculty (if provided)  |
| Enrollment   | Number of students in section   |

### 2. Clash Report (clash_report.xlsx)

| Column           | Description                                   |
| ---------------- | --------------------------------------------- |
| Register Number  | Student ID                                    |
| Student Name     | Full name                                     |
| Program          | Academic program                              |
| Courses          | Comma-separated list of enrolled courses      |
| Status           | 🟢 Green (no clashes) or 🔴 Red (has clashes)  |
| Clashing Courses | Courses scheduled at same time (if any)       |
| Clash Day        | Day when clash occurs (if any)                |
