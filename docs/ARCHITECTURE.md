# Architecture

## Layers

| Project | Responsibility | Depends on |
|---|---|---|
| `UniSlot.Solver` | The integer problem model, scoring, deterministic math, the annealing engine, lower bounds, the prover contract. No allocations in hot loops. | nothing |
| `UniSlot.Domain` | Pure rules: schedule policy, roster, sections, timetable, hard-rule audit, clash analysis, metrics. | nothing |
| `UniSlot.Application` | Use cases: parse the workbook grid, build the roster, plan sections, build the solver problem, orchestrate a solve. | Domain, Solver |
| `UniSlot.Infrastructure` | Excel reading and writing (ClosedXML), `snapshot.json` / `summary.json`. | Application |
| `UniSlot.Proof` | Optional exact stage on OR-Tools CP-SAT. | Solver |
| `UniSlot.Cli`, `UniSlot.Desktop` | Front ends. | everything above |

`Solver` and `Domain` never reference each other. The solver sees integers only; the domain sees names only; `Application` translates between them (`ProblemBuilder`).

## The search

Course → weekday colouring. Each chain runs three stages over one budget:

1. **Stage A: RED.** Anneals the number of affected students. A move that worsens RED is accepted only through the RED temperature; the clash change is never consulted. Clash is used only to break ties when RED is unchanged.
2. **Stage B: clash.** Restarts from the best state with RED frozen: a RED-worsening move is rejected unconditionally.
3. **Stage C: balance, then parallel excess.** RED and clash frozen.

Chains are independent and seeded from `(master seed, chain index)`. The merge picks the lexicographic best, ties to the lowest index. The result therefore depends on `(seed, chains, moves per chain)` and on nothing else: not thread count, not machine speed.

### Determinism

- All randomness is xoshiro256** seeded through SplitMix64.
- `exp` and `ln` are implemented with IEEE-754 basic operations only (`DeterministicMath`), never libm, so Windows, macOS and Linux agree bit for bit.
- Course indices come from an ordinal sort, so they never depend on locale.
- Wall-clock pacing (`--time`) is available but is explicitly not reproducible.

### Incremental scoring

Moving a course changes at most its neighbours' clash terms and its students' per-weekday counters. Each student keeps `multi[s]`, the number of weekdays on which they have two or more courses, so the RED delta of a move is O(1) per affected student. Tests recompute everything from scratch at intervals and require agreement.

## Why the audit is separate

`ScheduleAuditor` re-derives every hard rule from the finished timetable and shares no code with the solver. `SolveWorkflow` also requires the solver's RED count to equal the audit's RED count and throws `ConsistencyException` otherwise, so a solver defect cannot ship a wrong timetable.

## Hybrid optimality

The annealer finds the incumbent. If requested, `CpSatProver` receives it as a hint and as a RED upper bound and runs phase 1 (RED) then phase 2 (clash with RED held). A level is called proven only when CP-SAT reports OPTIMAL for it.

## Extending

- A different search engine (for example a native Rust one) implements `ISearchEngine`; nothing else changes.
- A different exact method implements `IOptimalityProver`.
- New output formats are written against `SolveOutcome` in `Infrastructure`.
