# UniSlot CP-SAT solver (Google OR-Tools)

Python package invoked by the Node CLI / `cpsatBridge.ts`.

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

Progress events are NDJSON on stderr. Solution JSON includes `proven_optimal` when clash weight is proven minimal (integer `incumbent − bound < 1`). Do not treat gap-limited CP-SAT `OPTIMAL` as a certificate.

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

Clash phase defaults to `--prove-strategy core` (`optimize_with_core` only). OR-Tools 9.15 already defaults probing/symmetry/find_multiple_cores; those are not re-broadcast. Compare:

```bash
--prove-strategy stock        # default CP-SAT portfolio
--prove-strategy core         # default UniSlot prove
--prove-strategy core_linear  # core + linearization_level=2
```

Operational escapes (prove pass only; portfolio race ignores them):

```bash
# Ship when gap ≤ 5, or when incumbent+bound flat for 90s
--absolute-gap 5 --prove-plateau 90

# Overnight certificate chase (disables escapes)
--prove
```
