# Browser Worker Audit (2026-05-14)

## Executive Summary

This audit focuses only on browser worker architecture, runtime efficiency, and memory/transfer behavior.

Worker efficiency rating: 7.4 / 10

Current design is strong at isolating heavy compute from the UI thread, but there are still several avoidable costs that reduce browser efficiency on large datasets.

## What Is Working Well

- Heavy pipeline work is offloaded to a dedicated worker: [src/modules/scheduling/scheduling.worker.ts](src/modules/scheduling/scheduling.worker.ts#L35)
- Input file buffer is transferred (not copied) to worker: [src/hooks/useUnislotWorker.ts](src/hooks/useUnislotWorker.ts#L85)
- XLSX outputs are transferred back as Transferables: [src/modules/scheduling/scheduling.worker.ts](src/modules/scheduling/scheduling.worker.ts#L52)
- Progress streaming exists and keeps users informed: [src/modules/scheduling/scheduling.worker.ts](src/modules/scheduling/scheduling.worker.ts#L36)

## Findings (Ordered by Severity)

### 1) Unused export is always generated and transferred (High)

Evidence:

- Worker pipeline always builds all 3 workbooks in one call: [src/modules/scheduling/pipeline.ts](src/modules/scheduling/pipeline.ts#L123)
- Course email workbook is always generated: [src/modules/scheduling/pipeline.ts](src/modules/scheduling/pipeline.ts#L126)
- Course email workbook is always posted back from worker: [src/modules/scheduling/scheduling.worker.ts](src/modules/scheduling/scheduling.worker.ts#L47)
- It is also always transferred: [src/modules/scheduling/scheduling.worker.ts](src/modules/scheduling/scheduling.worker.ts#L54)
- Scheduler UI only exposes schedule and clash downloads: [src/features/Scheduler.tsx](src/features/Scheduler.tsx#L332), [src/features/Scheduler.tsx](src/features/Scheduler.tsx#L342)
- Emails view uses courseEmailsData, not courseEmailsXlsx: [src/features/EmailsView.tsx](src/features/EmailsView.tsx#L27)

Impact:

- Extra CPU, memory, and transfer cost on every run, even when users never download course email XLSX.

Recommendation:

- Make exports on-demand by request flags (for example generateCourseEmailsXlsx only when user clicks export).

### 2) No cancellation protocol for long-running worker jobs (High)

Evidence:

- Worker request type supports run only: [src/modules/scheduling/scheduling.worker.ts](src/modules/scheduling/scheduling.worker.ts#L5)
- Worker message handler only branches on run: [src/modules/scheduling/scheduling.worker.ts](src/modules/scheduling/scheduling.worker.ts#L30)
- Hook exposes run but no cancel API: [src/hooks/useUnislotWorker.ts](src/hooks/useUnislotWorker.ts#L42)
- Session reset clears UI state but does not stop worker work: [src/contexts/SchedulingSessionProvider.tsx](src/contexts/SchedulingSessionProvider.tsx#L31)

Impact:

- Users cannot stop expensive runs after submission, causing avoidable CPU burn and poor responsiveness on weak machines.

Recommendation:

- Add cancel request type and a cancellation token/checkpoint strategy in pipeline/solver loops.

### 3) Worker is instantiated eagerly for all app sub-routes (Medium)

Evidence:

- Session provider wraps entire /app area: [src/App.tsx](src/App.tsx#L17), [src/App.tsx](src/App.tsx#L19)
- Provider always initializes worker hook: [src/contexts/SchedulingSessionProvider.tsx](src/contexts/SchedulingSessionProvider.tsx#L16)
- Worker is created immediately on mount: [src/hooks/useUnislotWorker.ts](src/hooks/useUnislotWorker.ts#L32)

Impact:

- Thread and module initialization overhead exists even when user is browsing non-scheduler pages.

Recommendation:

- Lazy-create worker on first run call, or scope provider to scheduler route only.

### 4) Result payload is large and cloned into main-thread state (Medium)

Evidence:

- Worker result object includes validation, schedule, clash report, 3 XLSX buffers, email data, stats: [src/modules/scheduling/scheduling.worker.ts](src/modules/scheduling/scheduling.worker.ts#L10), [src/modules/scheduling/scheduling.worker.ts](src/modules/scheduling/scheduling.worker.ts#L49)
- Non-transferables in that payload are structured-cloned on postMessage: [src/modules/scheduling/scheduling.worker.ts](src/modules/scheduling/scheduling.worker.ts#L55)
- Hook stores full payload in resolved object: [src/hooks/useUnislotWorker.ts](src/hooks/useUnislotWorker.ts#L71)
- Session context keeps full result in React state: [src/contexts/SchedulingSessionProvider.tsx](src/contexts/SchedulingSessionProvider.tsx#L17)

Impact:

- Increased memory pressure and GC churn for large cohorts.

Recommendation:

- Send a slim summary first, then lazy-fetch detailed views (for example paged clash rows) only when needed.

### 5) Export stage uses Promise.all in one worker, increasing memory peak (Medium)

Evidence:

- All exports are built in one Promise.all: [src/modules/scheduling/pipeline.ts](src/modules/scheduling/pipeline.ts#L123)

Impact:

- CPU does not parallelize across cores in a single worker thread, but memory can spike because multiple workbooks/buffers can coexist.

Recommendation:

- Generate exports on-demand and/or sequentially with explicit release points.

### 6) Worker bundle is heavy for first-load startup (Medium)

Evidence:

- Worker entry statically imports pipeline: [src/modules/scheduling/scheduling.worker.ts](src/modules/scheduling/scheduling.worker.ts#L3)
- Pipeline statically imports Excel export modules: [src/modules/scheduling/pipeline.ts](src/modules/scheduling/pipeline.ts#L12), [src/modules/scheduling/pipeline.ts](src/modules/scheduling/pipeline.ts#L13), [src/modules/scheduling/pipeline.ts](src/modules/scheduling/pipeline.ts#L14)
- Measured build output: dist/assets/scheduling.worker-*.js = 980.36 kB

Impact:

- Higher first-run parse/compile/startup overhead.

Recommendation:

- Use dynamic imports for export modules so parse/schedule path can start faster.

### 7) No concurrency guard in run API (Low)

Evidence:

- Hook run path does not reject when running is already true: [src/hooks/useUnislotWorker.ts](src/hooks/useUnislotWorker.ts#L42)
- A new request is posted each call: [src/hooks/useUnislotWorker.ts](src/hooks/useUnislotWorker.ts#L85)

Impact:

- Multiple queued jobs can accumulate if run is called programmatically in quick succession.

Recommendation:

- Add admission control (single-flight guard) or explicit queue semantics.
