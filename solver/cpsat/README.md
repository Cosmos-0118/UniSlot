# UniSlot CP-SAT solver (Google OR-Tools)

Python package invoked by the Node CLI / `cpsatBridge.ts`.

**Required objective (confirmed 5 October 2026):** minimize unique RED students
first, then clash weight, then weekday balance and parallel excess. A student
is RED if any two enrolled courses share a weekday; count that student once
regardless of the number of overlaps. Optimize lower-priority goals only among
timetables tied on higher-priority goals, while respecting all hard constraints.

**Implementation:** `solve.py` minimizes RED students first, then weighted
clash pairs, then weekday balance and parallel excess. The warm-start and
portfolio ranking follow RED before pair cost. `proven_optimal` certifies the
minimum RED count; `proven_levels` lists `red_students`, `clash_weight`, and
`balance_and_parallel` in priority order. `red_bound` / `red_gap` describe the
primary proof. `clash_bound` / `clash_gap` describe pair-cost proof conditional
on fixing the chosen RED count. See
[Constraints §2](../../docs/Constraints.md#2-core-objectives).

New run snapshots and summaries carry `objective_policy: "red-first-v1"`;
legacy folders without the field retain their historical objective and
certificate meanings. `--clash-only` is a diagnostic that optimizes pair cost
and leaves `proven_optimal` false. `--primary-only` selects the RED-first
portfolio run. `--absolute-gap` and `--prove-plateau` apply to the active
primary RED proof; CP-SAT `OPTIMAL` by itself does not certify a level if its
integer incumbent-bound gap remains nonzero.

Before model construction, the Python validator checks course, conflict-edge,
student, faculty, fixed-day, and clique references for internal consistency.
The TypeScript bridge validates that each canonical enrollment appears in one
section and derives course-pair weights from the canonical student roster.
The Gershgorin bound was removed; retained weighted clique and component
bounds are searched with a bounded clique routine that returns a valid clique
even when its node budget expires. Metrics require a complete assignment.
Bounded runs share a monotonic deadline across input/model setup and solve
phases, and atomically checkpoint complete incumbents for recovery.

```bash
# from repo root
npm run setup:cpsat
# or (Unix):
python3 -m venv solver/cpsat/.venv
solver/cpsat/.venv/bin/pip install -r solver/cpsat/requirements.txt
# or (Windows):
python -m venv solver/cpsat/.venv
solver\cpsat\.venv\Scripts\pip install -r solver/cpsat/requirements.txt
```

Run directly:

```bash
solver/cpsat/.venv/bin/python solver/cpsat/solve.py \
  --instance /path/to/instance.json \
  --output /path/to/solution.json
```

Progress events are NDJSON on stderr. Solution JSON includes `proven_optimal` when the primary RED count is proven minimal (integer `red_incumbent − red_bound < 1`). `proven_levels` records the lexicographic levels proven. A gap-limited CP-SAT `OPTIMAL` is not by itself a certificate.

### Prove-gap diagnosis

Heartbeats now refresh `bound` / `gap` / `incumbent` while proving (not only on new solutions). To capture a time series:

```bash
solver/cpsat/.venv/bin/python solver/cpsat/diagnose_gap.py \
  --courses 70 --time-limit 35 --out-dir tmp/gap-diagnose
```

Or on a real instance:

```bash
solver/cpsat/.venv/bin/python solver/cpsat/solve.py \
  --instance instance.json --output solution.json \
  --clash-only --time-limit 60 --gap-trace gap-trace.ndjson
```

`gap_analysis.diagnosis` is typically `bound_stuck` when the incumbent is flat but the dual bound stays far below it.

### Prove acceleration (research roadmap)

Primary RED proof (or clash-only diagnostics) defaults to `--prove-strategy core` (`optimize_with_core` only). OR-Tools 9.15 already defaults probing/symmetry/find_multiple_cores; those are not re-broadcast. Compare:

```bash
--prove-strategy stock        # default CP-SAT portfolio
--prove-strategy core         # default UniSlot prove
--prove-strategy core_linear  # core + linearization_level=2
```

Operational escapes apply to the active primary RED proof (the pair-cost
diagnostic has its own pair-cost target):

```bash
# Ship when gap ≤ 5, or when incumbent+bound flat for 90s
--absolute-gap 5 --prove-plateau 90

# Overnight certificate chase (disables escapes)
--prove
```
