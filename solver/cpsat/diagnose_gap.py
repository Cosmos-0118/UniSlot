#!/usr/bin/env python3
"""Build a hard synthetic clash instance and diagnose prove-gap behavior.

Creates a dense weighted conflict graph (Max-6-Cut dual: minimize monochrome
edge weight), runs clash-only CP-SAT with --gap-trace, and prints the analysis.

Usage:
  solver/cpsat/.venv/bin/python solver/cpsat/diagnose_gap.py
  solver/cpsat/.venv/bin/python solver/cpsat/diagnose_gap.py --courses 90 --time-limit 45
"""

from __future__ import annotations

import argparse
import json
import os
import random
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def build_synthetic_instance(
    *,
    n_courses: int,
    edge_prob: float,
    seed: int,
    lb_clash: int = 0,
) -> dict:
    rng = random.Random(seed)
    courses = []
    for i in range(n_courses):
        code = f"C{i:03d}"
        courses.append(
            {
                "code": code,
                "section_ids": [f"{code}-1"],
                "section_count": 1,
                "is_math": i % 17 == 0,  # a few Saturday-eligible
            }
        )

    edges = []
    # Dense random weighted edges — clique LB often weak vs true optimum.
    for i in range(n_courses):
        for j in range(i + 1, n_courses):
            if rng.random() > edge_prob:
                continue
            w = 1 + rng.randrange(1, 12)
            edges.append(
                {
                    "course_a": f"C{i:03d}",
                    "course_b": f"C{j:03d}",
                    "weight": w,
                }
            )

    # Faculty groups: force some pairwise day exclusions (hard).
    faculty_groups = []
    for g in range(max(1, n_courses // 25)):
        members = [f"C{(g * 7 + k) % n_courses:03d}" for k in range(3)]
        faculty_groups.append({"faculty": f"F{g}", "course_codes": members})

    return {
        "num_weekdays": 6,
        "saturday_index": 5,
        "preferred_parallel": 11,
        "courses": courses,
        "conflict_edges": edges,
        "students": [],
        "faculty_groups": faculty_groups,
        "min_clash_weight_lower_bound": lb_clash,
        "min_red_students_lower_bound": 0,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Diagnose CP-SAT clash prove gap")
    parser.add_argument("--courses", type=int, default=70)
    parser.add_argument("--edge-prob", type=float, default=0.35)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--time-limit", type=float, default=30.0)
    parser.add_argument("--workers", type=int, default=0)
    parser.add_argument(
        "--out-dir",
        default=None,
        help="Directory for instance/trace/solution (default: temp)",
    )
    args = parser.parse_args()

    out_dir = Path(args.out_dir) if args.out_dir else Path(tempfile.mkdtemp(prefix="unislot-gap-"))
    out_dir.mkdir(parents=True, exist_ok=True)
    instance_path = out_dir / "instance.json"
    output_path = out_dir / "solution.json"
    trace_path = out_dir / "gap-trace.ndjson"

    instance = build_synthetic_instance(
        n_courses=args.courses,
        edge_prob=args.edge_prob,
        seed=args.seed,
    )
    instance_path.write_text(json.dumps(instance, indent=2), encoding="utf-8")

    py = ROOT / ".venv" / "bin" / "python"
    if not py.exists():
        py = Path(sys.executable)

    workers = args.workers if args.workers > 0 else (os.cpu_count() or 1)
    cmd = [
        str(py),
        str(ROOT / "solve.py"),
        "--instance",
        str(instance_path),
        "--output",
        str(output_path),
        "--time-limit",
        str(args.time_limit),
        "--workers",
        str(workers),
        "--seed",
        str(args.seed),
        "--clash-only",
        "--gap-trace",
        str(trace_path),
    ]
    print(f"instance: {instance_path}", file=sys.stderr)
    print(f"courses={args.courses} edges={len(instance['conflict_edges'])}", file=sys.stderr)
    print(f"running: {' '.join(cmd)}", file=sys.stderr)
    proc = subprocess.run(cmd, cwd=str(ROOT), check=False)
    if not output_path.exists():
        print("solve failed — no solution file", file=sys.stderr)
        return proc.returncode or 1

    solution = json.loads(output_path.read_text(encoding="utf-8"))
    analysis = solution.get("gap_analysis") or {}
    print(json.dumps(
        {
            "out_dir": str(out_dir),
            "clash_weight": solution.get("clash_weight"),
            "status": solution.get("status"),
            "proven_optimal": solution.get("proven_optimal"),
            "solver_time_seconds": solution.get("solver_time_seconds"),
            "gap_analysis": analysis,
            "gap_trace": str(trace_path),
        },
        indent=2,
    ))
    return 0 if analysis else (proc.returncode or 1)


if __name__ == "__main__":
    raise SystemExit(main())
