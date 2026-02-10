"""FastAPI application for UniSlot scheduling service."""

import shutil
import tempfile
import uuid
from pathlib import Path
from typing import Optional

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from unislot.models import ClashReport, Schedule, ValidationResult
from unislot.output import export_all
from unislot.parser import load_and_validate
from unislot.preprocessing import (
    assign_students_to_sections,
    build_conflict_graph,
    compute_section_splits,
    extract_faculty_constraints,
)
from unislot.scheduler import build_schedule, compute_clash_report, run_scheduler

app = FastAPI(
    title="UniSlot",
    description="Optimized Evening Course Scheduling System",
    version="0.1.0",
)

# In-memory job storage (use Redis/DB in production)
jobs: dict[str, dict] = {}

# Temp directory for uploads and outputs
UPLOAD_DIR = Path(tempfile.gettempdir()) / "unislot" / "uploads"
OUTPUT_DIR = Path(tempfile.gettempdir()) / "unislot" / "outputs"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


class JobStatus(BaseModel):
    """Status of a scheduling job."""
    job_id: str
    status: str  # pending, running, completed, failed
    message: Optional[str] = None
    schedule_ready: bool = False
    clash_report_ready: bool = False
    validation_result: Optional[ValidationResult] = None


class ScheduleResponse(BaseModel):
    """Response containing schedule data."""
    schedule: Schedule
    clash_report: ClashReport


def process_schedule(job_id: str, file_path: Path) -> None:
    """Background task to process scheduling."""
    try:
        jobs[job_id]["status"] = "running"
        jobs[job_id]["message"] = "Loading and validating data..."

        # Load and validate
        students, courses, rows, validation = load_and_validate(file_path)
        jobs[job_id]["validation_result"] = validation.model_dump()

        if not validation.is_valid:
            jobs[job_id]["status"] = "failed"
            jobs[job_id][
                "message"] = f"Validation failed: {len(validation.errors)} errors"
            return

        jobs[job_id][
            "message"] = f"Loaded {len(students)} students, {len(courses)} courses"

        # Preprocessing
        jobs[job_id]["message"] = "Computing sections and conflicts..."
        course_sections = compute_section_splits(courses)
        course_sections = assign_students_to_sections(students,
                                                      course_sections, rows)
        conflict_graph = build_conflict_graph(students, course_sections)
        faculty_constraints = extract_faculty_constraints(course_sections)

        # Scheduling
        jobs[job_id]["message"] = "Running optimizer..."
        result = run_scheduler(
            course_sections,
            conflict_graph,
            faculty_constraints,
            time_limit_seconds=120,
        )

        # Build outputs
        jobs[job_id]["message"] = "Generating reports..."
        schedule = build_schedule(course_sections, result)
        clash_report = compute_clash_report(students, course_sections, result)
        schedule.total_clashes = clash_report.students_with_clashes

        # Export to files
        job_output_dir = OUTPUT_DIR / job_id
        export_all(schedule, clash_report, job_output_dir)

        # Store results
        jobs[job_id]["schedule"] = schedule.model_dump()
        jobs[job_id]["clash_report"] = clash_report.model_dump()
        jobs[job_id]["status"] = "completed"
        jobs[job_id]["schedule_ready"] = True
        jobs[job_id]["clash_report_ready"] = True
        jobs[job_id][
            "message"] = f"Completed! {clash_report.students_with_clashes} students with clashes ({clash_report.clash_percentage}%)"

    except Exception as e:
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["message"] = str(e)


@app.get("/")
async def root() -> dict:
    """Health check endpoint."""
    return {"status": "ok", "service": "UniSlot", "version": "0.1.0"}


@app.post("/upload", response_model=JobStatus)
async def upload_file(
        background_tasks: BackgroundTasks,
        file: UploadFile = File(...),
) -> JobStatus:
    """
    Upload enrollment Excel file and start scheduling job.
    
    Returns a job ID for tracking progress.
    """
    if not file.filename or not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400,
                            detail="File must be an Excel file (.xlsx)")

    # Generate job ID
    job_id = str(uuid.uuid4())[:8]

    # Save uploaded file
    file_path = UPLOAD_DIR / f"{job_id}_{file.filename}"
    with open(file_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    # Initialize job
    jobs[job_id] = {
        "status": "pending",
        "message": "Job queued",
        "schedule_ready": False,
        "clash_report_ready": False,
        "file_path": str(file_path),
    }

    # Start background processing
    background_tasks.add_task(process_schedule, job_id, file_path)

    return JobStatus(job_id=job_id, status="pending", message="Job queued")


@app.get("/status/{job_id}", response_model=JobStatus)
async def get_status(job_id: str) -> JobStatus:
    """Get status of a scheduling job."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    job = jobs[job_id]
    return JobStatus(
        job_id=job_id,
        status=job["status"],
        message=job.get("message"),
        schedule_ready=job.get("schedule_ready", False),
        clash_report_ready=job.get("clash_report_ready", False),
        validation_result=ValidationResult(**job["validation_result"])
        if job.get("validation_result") else None,
    )


@app.get("/schedule/{job_id}")
async def get_schedule(job_id: str) -> JSONResponse:
    """Get schedule data for a completed job."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    job = jobs[job_id]
    if not job.get("schedule_ready"):
        raise HTTPException(status_code=400, detail="Schedule not ready")

    return JSONResponse(content=job["schedule"])


@app.get("/clash-report/{job_id}")
async def get_clash_report(job_id: str) -> JSONResponse:
    """Get clash report data for a completed job."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    job = jobs[job_id]
    if not job.get("clash_report_ready"):
        raise HTTPException(status_code=400, detail="Clash report not ready")

    return JSONResponse(content=job["clash_report"])


@app.get("/download/{job_id}/{file_type}")
async def download_file(job_id: str, file_type: str) -> FileResponse:
    """
    Download output Excel file.
    
    file_type: 'schedule' or 'clash_report'
    """
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    if file_type == "schedule":
        file_path = OUTPUT_DIR / job_id / "schedule.xlsx"
        filename = "schedule.xlsx"
    elif file_type == "clash_report":
        file_path = OUTPUT_DIR / job_id / "clash_report.xlsx"
        filename = "clash_report.xlsx"
    else:
        raise HTTPException(
            status_code=400,
            detail="file_type must be 'schedule' or 'clash_report'")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        path=file_path,
        filename=filename,
        media_type=
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@app.delete("/job/{job_id}")
async def delete_job(job_id: str) -> dict:
    """Delete a job and its files."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    # Clean up files
    job = jobs[job_id]
    if "file_path" in job:
        Path(job["file_path"]).unlink(missing_ok=True)

    output_dir = OUTPUT_DIR / job_id
    if output_dir.exists():
        shutil.rmtree(output_dir)

    del jobs[job_id]

    return {"status": "deleted", "job_id": job_id}
