# UniSlot - Course Scheduling System

Optimized evening course scheduling system that minimizes student timetable clashes.

## Features

- **Excel Input/Output**: Upload enrollment data, download schedule and clash reports
- **Intelligent Scheduling**: OR-Tools CP-SAT optimizer with greedy fallback
- **Section Splitting**: Automatically splits large courses into balanced sections
- **Clash Detection**: Identifies and reports students with schedule conflicts
- **Flexible Constraints**: Configurable parallel course cap, solver timeout

## Quick Start

### Installation

```bash
# Make install script executable and run
chmod +x install.sh
./install.sh

# Activate virtual environment
source .venv/bin/activate
```

Windows (PowerShell):

```powershell
.\install.ps1
```

### Run the Streamlit UI

```bash
streamlit run unislot/ui.py
```

Or use the run script:

```bash
chmod +x run.sh
./run.sh
```

Windows (PowerShell):

```powershell
.\run.ps1
```

Open http://localhost:8501 in your browser.

### Deploy on Streamlit Community Cloud

- App entrypoint: `streamlit_app.py`
- Python version: 3.11+
- Requirements: `requirements.txt`

### Run the API

```bash
uvicorn unislot.api:app --reload
```

API available at http://localhost:8000. Docs at http://localhost:8000/docs.

## Input Format

Excel file (.xlsx) with columns:

| Column            | Required | Description                            |
| ----------------- | -------- | -------------------------------------- |
| Program           | Yes      | Student's program (e.g., "B.Tech CSE") |
| Register Number   | Yes      | Unique student ID                      |
| Student Name      | Yes      | Full name                              |
| Course Code       | Yes      | Unique course identifier               |
| Course Title      | Yes      | Course name                            |
| Mobile Number     | No       | Contact number                         |
| Email ID          | No       | Email address                          |
| Registration Type | No       | Online/Manual                          |
| Remarks           | No       | Additional notes                       |

Each row = one student enrolled in one course.

## Output

### Schedule (schedule.xlsx)

- Course Code, Title, Section, Day, Time, Enrollment

### Clash Report (clash_report.xlsx)

- Register Number, Name, Program, Status (🟢 Green/🔴 Red), Clashing Courses

## Algorithm

1. **Preprocessing**
   - Parse enrollments, validate data
   - Split courses with >65 students into sections
   - Assign students to sections (balanced, program-cohort aware)
   - Build conflict graph (edges = shared students)

2. **Scheduling (CP-SAT)**
   - Variables: day assignment per section (0-4 = Mon-Fri)
   - Hard constraints: faculty non-overlap, max 11 parallel courses
   - Soft constraints: minimize student clashes (weighted by affected students)
   - Objective: minimize total clash penalty

3. **Fallback (Greedy)**
   - Graph coloring heuristic (5 colors = 5 days)
   - Sorts sections by conflict degree, assigns greedily

## API Endpoints

| Method | Endpoint                        | Description                        |
| ------ | ------------------------------- | ---------------------------------- |
| POST   | /upload                         | Upload Excel, start scheduling job |
| GET    | /status/{job_id}                | Check job status                   |
| GET    | /schedule/{job_id}              | Get schedule JSON                  |
| GET    | /clash-report/{job_id}          | Get clash report JSON              |
| GET    | /download/{job_id}/schedule     | Download schedule Excel            |
| GET    | /download/{job_id}/clash_report | Download clash report Excel        |

## Development

```bash
# Run tests
pytest

# Lint
ruff check .

# Type check
mypy unislot
```

## Project Structure

```
unislot/
├── __init__.py
├── models.py       # Pydantic data models
├── parser.py       # Excel parsing and validation
├── preprocessing.py # Section splits, conflict graph
├── scheduler.py    # CP-SAT solver and greedy fallback
├── output.py       # Excel export
├── api.py          # FastAPI endpoints
└── ui.py           # Streamlit interface

tests/
├── test_parser.py
└── test_integration.py

docs/
└── excel_schema.md
```

## License

MIT
