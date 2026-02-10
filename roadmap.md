# Roadmap

## Problem Understanding (Clarified)

**Time model**: 5 slots (Mon–Fri, each day 5–7 PM is ONE slot). Up to 11 courses can run in parallel per slot → 55 course-slot capacity per week.

**Key insight**: With 106+ courses and only 55 course-slots, courses MUST share slots. The challenge is assigning courses to slots such that students enrolled in multiple courses don't have clashes.

**Section splitting**: When enrollment > 65, split into sections. Sections of the same course CAN share a time slot (different faculty/room), but each student is assigned to exactly one section.

---

## Algorithm Design

### Phase A: Preprocessing

1. Parse enrollments → build `student_courses: Dict[student_id, Set[course_id]]`
2. Compute course demand → determine splits: `ceil(enrollment / 65)` sections per course
3. **Student-section assignment** (if split): partition students into sections (balanced, preserving program cohorts if possible)
4. Build **conflict graph**: nodes = sections, edge between two sections if any student is enrolled in both. Edge weight = number of shared students.

### Phase B: Scheduling (OR-Tools CP-SAT)

**Decision variables**:

- `slot[s]` ∈ {0..4} for each section s (which day)

**Hard constraints**:

- Faculty: if faculty f teaches sections {s1, s2, ...}, all must have different slots
- Parallel cap: for each slot d, at most 11 sections assigned to d

**Soft constraints (minimize violations)**:

- Student clashes: for each student, if two enrolled sections share the same slot → penalty
- Load balance: penalize deviation from 11 sections/day

**Objective**: minimize total clash penalty (weighted sum of students affected)

### Phase C: Fallback Heuristic (if CP-SAT times out)

- Graph-coloring on conflict graph (sections as nodes, 5 colors = days)
- Greedy: sort sections by conflict degree desc, assign to slot with fewest conflicts
- Fast (<1s) but may have more clashes than optimal

---

## Recommended Stack

- **Language**: Python 3.11+
- **Optimization**: OR-Tools CP-SAT (free, excellent for this scale)
- **Data I/O**: pandas + openpyxl for Excel; pydantic for validation
- **API**: FastAPI + Uvicorn
- **UI**: minimal HTML/JS or Streamlit (defer React until beautification phase)
- **Tooling**: uv or Poetry; Ruff; mypy

---

## Delivery Steps

### Phase 1: Project Setup

- [x] Step-1: Initialize Python project (pyproject.toml, uv/Poetry, .gitignore, ruff.toml, py.typed)
- [x] Step-2: Define pydantic models: `Student`, `Course`, `Section`, `EnrollmentRow`, `Slot`, `ScheduleEntry`, `ClashReport`
- [x] Step-3: Document expected input Excel schema (columns, types, examples)

### Phase 2: Data Ingestion & Validation

- [x] Step-4: Implement Excel parser (pandas): read rows, validate columns, handle encoding
- [x] Step-5: Validate business rules: max 5 courses/student, no duplicate registrations, required fields present
- [x] Step-6: Build canonical data structures: aggregate to `course_enrollments`, compute demand per course

### Phase 3: Preprocessing

- [x] Step-7: Compute section splits: for each course, if demand > 65 → create N sections, assign capacity
- [x] Step-8: Assign students to sections (balanced partitioning; keep program cohorts together if feasible)
- [x] Step-9: Build conflict graph: edge(s1, s2) if shared_students(s1, s2) > 0; store edge weights
- [x] Step-10: Extract faculty constraints: map faculty → list of sections they teach

### Phase 4: Scheduler (Core Algorithm)

- [x] Step-11: Implement CP-SAT model: slot variables, faculty constraints, parallel cap constraints
- [x] Step-12: Add soft clash constraints: for each student's section pairs, penalize same-slot assignment
- [x] Step-13: Add load-balance objective: minimize max deviation from 11 sections/day
- [x] Step-14: Configure solver: time limit (60–120s), search strategy (automatic or activity-based)
- [x] Step-15: Implement greedy fallback: graph-coloring heuristic using conflict graph, runs if CP-SAT times out

### Phase 5: Output Generation

- [x] Step-16: Post-process solution: map slot index → day name, attach faculty/room info
- [x] Step-17: Generate course schedule XLSX: columns = Course, Section, Day, Time, Faculty, Enrollment
- [x] Step-18: Compute student clash report: for each student, list courses, detect clashes, flag Red/Green
- [x] Step-19: Generate clash report XLSX: columns = Student, Program, Courses, Clash Status, Conflicting Courses

### Phase 6: API & UI

- [x] Step-20: FastAPI app: POST /upload (Excel), GET /schedule, GET /clash-report, GET /download/{type}
- [x] Step-21: Add background task for solver (long-running); return job ID, poll for status
- [x] Step-22: Basic UI: file upload form, progress indicator, result tables, download buttons (Streamlit or plain HTML)

### Phase 7: Testing & Hardening

- [x] Step-23: Unit tests: Excel parsing, validation, section splitting, conflict graph construction
- [x] Step-24: Integration test: small fixture (20 students, 10 courses) → verify zero clashes possible
- [ ] Step-25: Stress test: synthetic data at full scale (2600 students, 106 courses) → measure solver time, clash count
- [ ] Step-26: Golden output tests: known input → expected XLSX output byte-comparison or structural match

### Phase 8: Deployment

- [ ] Step-27: Dockerfile (multi-stage: build + runtime), docker-compose for API
- [x] Step-28: README with local run instructions, sample input file, expected outputs
- [ ] Step-29: Ops playbook: how to re-run with new data, interpret Red flags, manual overrides

---

## Notes

- **Excel fidelity**: preserve register numbers as strings (avoid int coercion dropping leading zeros)
- **Solver timeout**: surface clearly when fallback heuristic is used; report clash count either way
- **UI**: keep minimal for now; defer styling to later phase
- **Logging**: structured logs with metrics (solver time, clash count, sections created)
- **Extensibility**: design for future constraints (room capacity, faculty preferences, multi-hour courses)
