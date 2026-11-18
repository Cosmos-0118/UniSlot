# Validation and performance

How the solver design was chosen and checked. All numbers are from one real enrollment workbook (1,164 students, 391 courses, 396 sections, 1,032 conflict pairs, Monday–Friday), Ryzen 5 9600X (6 cores / 12 threads), Windows 11.

## Why a custom search instead of CP-SAT alone

The previous tool ran Google OR-Tools CP-SAT on all cores. On this workbook:

| CP-SAT, time limit | Result (RED / clash) | Proven? |
|---|---|---|
| 1 s | crashed (no solution produced) | – |
| 5 s – 30 s | 41–44 / 75–85 | no |
| 120 s | 38 / 99–125 | no (bound 32–33) |
| 600 s | 38 / 99 | no (bound 33, gap 5) |

Most of the CPU time goes to trying to *prove* the result, which GPUs cannot accelerate (GPU SAT work covers only pre- and in-processing, not clause-learning search). The search for a good timetable is a small colouring problem, where a purpose-built annealer wins.

## Annealer vs CP-SAT at equal budgets (12 workers)

| Budget | CP-SAT | Annealer |
|---|---|---|
| 1 s | failed | RED 38 in 18 of 20 runs |
| 5 s / 10 s / 30 s | 41–44 | RED 38 in every run |
| 120 s | 38 / 99–125 | RED 38 / clash 50 in every run |

CP-SAT is slow mainly because its time goes into the RED proof and it never reaches its clash phase; with a gap limit it does, but still ends at clash 103–104 for RED 38. The annealer also reaches better weekday balance (1.6 versus 97 L1).

## Stability

- 30 independent runs (12 workers, 10 s): RED 38 in 30 / 30, clash 50–51.
- No run reached RED below 38 in more than 150 multi-chain runs. The proven lower bound is 32–33, so 38 is not proven optimal.

## Parallel scaling (C# engine, 12 chains × 30 M moves)

| Threads | Time | Speed-up |
|---|---|---|
| 1 | 20.7 s | 1.0× |
| 2 | 9.2 s | 2.3× |
| 4 | 5.0 s | 4.1× |
| 6 | 3.4 s | 6.1× |
| 12 | 2.2 s | 9.3× |

Throughput scales to the six physical cores; hyper-threading adds the rest. Quality barely depends on thread count: even a single chain reaches RED 38 about half the time.

## Why no GPU

A move touches roughly 5 neighbours and 5 students, so a chain is memory-light and serial; a GPU can only help by running many chains. One CPU thread already reaches RED 38 in about two seconds, and 12 threads in half a second, so there is nothing for a GPU to win at this scale. The engine sits behind `ISearchEngine` should instances grow by orders of magnitude.

## Hybrid proof

With the annealer's schedule as hint and RED upper bound, CP-SAT proves a RED lower bound of **32 in 30 s**, against 31–33 after 120 s without the hint and no better after 600 s.

## Cross-validation against the original code

The new app's output was loaded by the original tool's own code, which acted as an independent oracle:

- the original hard-constraint audit accepted the new schedule (RED 38, clash 50, balance 1.6, zero violations);
- the original snapshot loader accepted `snapshot.json` (391 courses, 1,164 students, 2,088 enrollment rows);
- the original `drop-course` workflow ran to completion with the new output folder as input.

One known incompatibility: the original reader (ExcelJS) cannot parse the prefixed XML namespace written by ClosedXML, so the original tool cannot re-read the new `schedule.xlsx`. Excel, LibreOffice, openpyxl and Google Sheets read it normally.

## Test safety nets

78 automated tests, including: incremental scores equal a from-scratch recomputation; results are identical for 1 and 4 threads; RED is never worsened once frozen; every language has identical keys and placeholders. Deliberately breaking the frozen-RED rule, or the incremental RED delta, makes tests fail.
