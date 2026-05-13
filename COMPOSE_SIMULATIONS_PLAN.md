# Compose Simulations — Live Progress Plan

## Current state

`SimulationPanel.tsx` polls `GET /compose/v1/simulation/{id}/status` every 5s.
`ComposeHpcRun` schema has no progress/percentage field — only `status`, `start_time`, `end_time`, `slurmjobid`, `error_message`.

Display shows: badge (Queued/Running/Completed/Failed) + simulation ID + elapsed timer.
No progress bar, no log streaming, no cancel, no metadata beyond ID.

---

## Plan

### 1. Richer status display with live indicators

| Change | Detail |
|---|---|
| Animated indeterminate progress bar | While `status === "running"`, show a CSS striped progress bar with animation |
| Determinate progress estimate | Use elapsed time ÷ heuristic max-duration slider (default 60s, configurable in the Run modal) to show an estimated % |
| Metadata display | Show SLURM job ID, correlation ID, start_time, wall clock as structured rows |
| Faster polling | Reduce interval from 5s → 2s |
| Status transition animation | CSS pulse/flash keyframe on status change |

### 2. Live log streaming

| Change | Detail |
|---|---|
| `getSimulationLog()` in `SmsApiComposeClient` | Add method hitting `GET /compose/v1/simulation/{id}/log` (backend needs to add this route) |
| Log viewer component | Inline scrollable log area in the running status section, auto-scroll to bottom |
| Tail mode | Poll logs on a separate timer (2s offset from status poll) and append new lines |
| Full log on completion | When `status === "completed"`, show the complete log (non-truncated) in a collapsible section |

### 3. Simulation control

| Change | Detail |
|---|---|
| Cancel button | Add `cancelSimulation(simId)` to `SmsApiComposeClient` hitting `DELETE /compose/v1/simulation/{id}/cancel` (backend needs to add) |
| Retry button | One-click re-submit of the same PBG document — store the last submitted blob in a ref |
| Step-through log viewer | On completed/failed, show full log with ability to scroll and copy |

### 4. History enhancements

| Change | Detail |
|---|---|
| Re-run from history | Each history entry gets a "Re-run" button that pre-fills the modal and submits |
| Duration in history | Compute wall-clock duration from start_time / end_time, display alongside timestamp |
| Error preview | Truncated error_message displayed inline in history rows |

---

## Files to change

| File | Changes |
|---|---|
| `frontend/src/smsApi.ts` | Add `getSimulationLog()`, `cancelSimulation()`, faster default poll, retry helper |
| `frontend/src/types.ts` | Add `ComposeHpcRunExtended` if progress field added; add `SimulationLogResponse` type |
| `frontend/src/panels/SimulationPanel.tsx` | Progress bar, metadata rows, log viewer, cancel/retry buttons, faster polling, re-run from history |
| `frontend/src/App.css` | Progress bar styles (`.sim-progress-bar`, `.sim-progress-fill`, `.sim-progress-indeterminate`), log viewer styles (`.sim-log`, `.sim-log-line`), transition animations |
| `frontend/src/__tests__/smsApi.test.ts` | Tests for `getSimulationLog()`, `cancelSimulation()` |

---

## Implementation order

### [x] Step 1 — `smsApi.ts` + `types.ts`
- Add `getSimulationLog(simId, truncate?)` method
- Add `cancelSimulation(simId)` method
- Add types `SimulationLogEntry` and `SimulationLogResponse`
- Export a faster `DEFAULT_POLL_MS = 2000`

### [x] Step 2 — `App.css`
- `.sim-progress-bar` — container with rounded track
- `.sim-progress-fill` — animated fill width + determinate transition
- `.sim-progress-indeterminate` — striped infinite animation fallback
- `.sim-log` — scrollable monospace container
- `.sim-log-line` — single log line
- `.sim-metadata` — key/value grid for SLURM ID etc.
- `@keyframes status-pulse` — pulse on status change

### [x] Step 3 — `SimulationPanel.tsx`
- Track `expectedDuration` in state (default 60, set from modal slider)
- While `status === "running"`: render `<div className="sim-progress-bar"><div className="sim-progress-fill" style={{width: <pct>%}} /></div>`
- Compute `pct = Math.min(100, (elapsed / expectedDuration) * 100)`
- Render metadata rows: SLURM Job ID, Correlation ID, Start Time
- Render `<div className="sim-log">{logLines.map(...)}</div>`
- Faster polling: `setInterval(poll, 2000)`
- Cancel button calls `clientRef.current.cancelSimulation(simId)` — show disabled if not implemented (backend 501)
- Retry button: store submitted `pbgState` in ref, re-submit on click
- History: add `onReRun` handler per entry, show duration with `start_time / end_time` diff

### [x] Step 4 — Tests
- `smsApi.test.ts`: mock fetch for `getSimulationLog` and `cancelSimulation`
- Verify URL construction, error handling

---

## Backend requirements (sms-api)

These routes don't exist yet on the compose API and would need to be added to sms-api before the frontend can use them:

- `GET /compose/v1/simulation/{id}/log` – returns list of log lines
- `DELETE /compose/v1/simulation/{id}/cancel` – cancels a running Slurm job

Until then, the frontend should degrade gracefully:
- Log viewer shows "(logs not available)" with a link to the HPC cluster
- Cancel button shows "(not available)" or is disabled with a tooltip
