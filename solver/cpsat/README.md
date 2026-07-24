# UniSlot CP-SAT solver (Google OR-Tools)

Python package invoked by the Node CLI / `cpsatBridge.ts`.

```bash
# from repo root
npm run setup:cpsat
# or:
python3 -m venv solver/cpsat/.venv
solver/cpsat/.venv/bin/pip install -r solver/cpsat/requirements.txt
```

Run directly:

```bash
solver/cpsat/.venv/bin/python solver/cpsat/solve.py \
  --instance /path/to/instance.json \
  --output /path/to/solution.json
```

Progress events are NDJSON on stderr. Solution JSON includes `proven_optimal` when clash weight is proven minimal.
