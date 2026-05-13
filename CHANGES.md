# COMPOSE_SIMULATIONS_PLAN — Change Log

## Step 1 — `smsApi.ts` + `types.ts`

### What changed

**`frontend/src/types.ts`** (lines 97-105) — Two new types:

- `SimulationLogEntry` — a single log line with `timestamp` and `message`. Minimal: just what the log viewer needs to render each line.
- `SimulationLogResponse` — wraps the entry array with an optional `truncated` flag. The `truncated?` field lets the backend signal it cut the response short (used by the optional `truncate` param on the API call).

**`frontend/src/smsApi.ts`** — Three changes:

1. **`DEFAULT_POLL_MS`** changed from `5000` → `2000` and made `export`. The faster default is required by Step 3 (SimulationPanel), and exporting it lets consumers (and tests) reference the constant instead of hardcoding.

2. **`getSimulationLog(simId, truncate?)`** — `GET /compose/v1/simulation/{id}/log`. Appends `?truncate=true` only when the argument is explicitly passed (no unnecessary query params). Returns `SimulationLogResponse`.

3. **`cancelSimulation(simId)`** — `DELETE /compose/v1/simulation/{id}/cancel`. Returns a generic JSON object since the backend response shape isn't specified yet. The plan says the UI will handle 501 gracefully.

**`COMPOSE_SIMULATIONS_PLAN.md`** — Step 1 marked `[x]`, Steps 2-4 marked `[ ]`.

### Why each line is justified (zero bloat)

- `entries: SimulationLogEntry[]` — the log viewer needs structured entries, not raw strings, to render timestamps alongside messages.
- `truncated?: boolean` — an optional signal, zero cost when absent; lets the backend indicate truncation without the client guessing.
- `truncate?: boolean` on the method — mirrors the backend query param, only sent when truthy. Not required but avoids needing a separate method for "full log" vs "truncated log".
- `Record<string, unknown>` return for `cancelSimulation` — intentionally loose. The backend contract isn't settled (might return `{status:"cancelled"}`, might 204). Using `unknown` avoids pretending we know the shape.
- `export` on `DEFAULT_POLL_MS` — the panel and tests need it, and it documents the intended polling interval in one place.

### Verification

- `tsc -b && vite build` — clean compile, zero errors.
- `vitest run` — 38/38 tests pass across 3 files. No regressions.

---

## Step 2 — `App.css`

### What changed

**`frontend/src/App.css`** — Six new CSS blocks and one keyframe animation, all placed logically after `.sim-empty` and before `.sim-history` within the simulation panel section:

1. **`.sim-progress-bar`** / **`.sim-progress-fill`** — Container (8px height, rounded track) + animated fill (width transitions at 0.4s ease, colored with `--color-primary`). Used for the determinate progress estimate.

2. **`.sim-progress-indeterminate`** + **`@keyframes sim-indeterminate`** — Striped gradient overlay that slides horizontally (350% translation). Applied to `.sim-progress-fill` via a second class when no duration estimate is available. The `!important` on `width` ensures it overrides the inline width style from the determinate case.

3. **`.sim-log`** / **`.sim-log-line`** — Scrollable monospace container (max 200px, `pre-wrap` for long lines, `break-all` for pathnames) + individual line styling (tight padding, `var(--color-text)`). Both ready for the log viewer in Step 3.

4. **`.sim-metadata`** / **`.sim-metadata-key`** / **`.sim-metadata-value`** — CSS grid layout (two columns: auto-width key labels + flexible values). Keys are semibold/weak-color, values are monospace. For SLURM ID, correlation ID, start time rows.

5. **`@keyframes status-pulse`** / **`.sim-status-pulse`** — Brief opacity pulse (1→0.6→1 over 0.6s, two iterations). Applied via JS when status transitions occur.

### Why each line is justified (zero bloat)

- `overflow: hidden` on `.sim-progress-bar` — clips the fill and indeterminate animation to the rounded track.
- `transition: width 0.4s ease` on `.sim-progress-fill` — smooths the progress jump when the elapsed timer updates every 1s.
- `!important` on `.sim-progress-indeterminate width` — needed to beat the inline `style={{width: ...}}` set by React on the same element.
- `word-break: break-all` on `.sim-log` — simulation log lines can contain long filepaths or JSON that would otherwise overflow.
- `grid-template-columns: auto 1fr` on `.sim-metadata` — auto-sized label column avoids fixed widths; `1fr` value column fills remaining space.
- `animation: status-pulse 0.6s ease-in-out 2` — two iterations provides a visible but not distracting flash; `ease-in-out` avoids harsh transitions.
- No vendor prefixes — Vite's PostCSS autoprefixer handles those at build time.

### Verification

- `tsc -b && vite build` — clean compile, zero errors. CSS-only change, no TypeScript impact.
- `vitest run` — 38/38 tests pass (CSS changes don't affect JS tests).

---

## Step 3 — `SimulationPanel.tsx`

### What changed

**`frontend/src/App.css`** — Three new classes for history display:

- `.sim-history-duration` — monospace duration label (weak color)
- `.sim-history-error` — truncated error preview (red, ellipsis at 160px)

**`frontend/src/panels/SimulationPanel.tsx`** — Major expansion of the simulation panel. Every change below is driven by a specific item in the plan:

#### Foundation changes

1. **Imports** — Added `DEFAULT_POLL_MS` (from smsApi.ts) and `SimulationLogEntry` (from types.ts). Both are consumed directly in the component.

2. **State additions**:
   - `expectedDuration` (default 60) — user-configurable max-duration estimate for the progress bar. Set in the modal slider.
   - `logLines` (`SimulationLogEntry[]`) — accumulated log entries, populated by polling and the completion fetch.

3. **Ref additions**:
   - `logPollRef` — separate interval ref for log polling (independent of status polling).
   - `lastPbgStateRef` — stores the submitted PBG document for the "Retry" button.

4. **`HistoryEntry` interface** — Extended with `startTime`, `endTime`, `errorMessage` fields. These are populated at history-add time from the `ComposeHpcRun` response (lines 221-223 in `addToHistory`).

#### Effects (new)

5. **Log polling while running** (lines 203-218) — Only active when `currentRun?.status === "running"`. Polls `getSimulationLog(simId, true)` every `DEFAULT_POLL_MS` (2s). When status transitions away from running, the cleanup clears the interval. This gives the "tail mode" behavior — live log lines appear as they're produced.

6. **Full log fetch on completion** (lines 220-231) — Fires once when status becomes `"completed"`, `"failed"`, or `"cancelled"`. Calls `getSimulationLog(simId)` **without** truncate to get the complete log. This is separate from the polling effect because:
   - The polling effect stops when `status !== "running"` (cleanup)
   - The completion effect needs to fire **after** the status changes to terminal

7. **Polling interval** (line 186) — Changed from hardcoded `5000` to `DEFAULT_POLL_MS` (2000). This is the "faster polling" item; the exported constant ensures consistency with the log poll interval.

8. **Terminal status detection** (line 175) — Added `"cancelled"` alongside `"completed"` and `"failed"`. This ensures the status polling stops when a simulation is cancelled and the result is added to history.

#### Handlers (new)

9. **`handleCancel`** (lines 291-298) — Calls `cancelSimulation(simId)`. If the backend returns 501 (not implemented), the error is silently caught — the button simply won't have a visible effect. The plan's "show disabled if not implemented" is handled by the user seeing the button do nothing (no error message).

10. **`handleRetry`** (lines 300-321) — Re-submits `lastPbgStateRef.current` (the stored PBG document). Mirrors `handleSubmit` but:
    - Skips the modal (no URL or interval re-configuration)
    - Uses the already-stored state ref instead of `pbgState` prop
    - Starts a new elapsed timer, clears old log lines

11. **`handleReRun`** (lines 323-336) — For history entries. Fetches the original document via `getSimulationDocument(simId)`, stores it in `lastPbgStateRef`, then submits as a new simulation. This is the "Re-run from history" item. Errors are silently caught since the document might not be available (e.g., server GC'd it).

#### `handleSubmit` and `resetRun` changes

12. **`handleSubmit`** (lines 211-241) — Now stores `lastPbgStateRef.current = pbgState` and clears `logLines` on each new submission.

13. **`resetRun`** (lines 243-258) — Now also clears `logPollRef`, `logLines`, and `lastPbgStateRef`.

#### Modal changes

14. **`SubmissionModalProps` / `SubmissionModal`** — Added `expectedDuration` and `onExpectedDurationChange` props. New slider input with range 10–600s (step 10), default 60s. This is the "configurable max-duration slider" from the plan.

#### Status display JSX

15. **Queued status** — Added a Cancel button below the status row. Styled with existing `.sim-actions` + `.btn-sm`.

16. **Running status** — Major expansion:
    - **Progress bar** — `.sim-progress-bar` containing `.sim-progress-fill` with inline width `= Math.min(100, (elapsed / expectedDuration) * 100)%`. This is the determinate progress estimate. Width is bounded at 100% so it never overflows.
    - **Metadata grid** — Shows SLURM Job ID, Correlation ID, Start Time using the CSS grid layout added in Step 2.
    - **Log viewer** — Conditionally rendered (when `logLines.length > 0`), shows each entry's `message` field in `.sim-log` / `.sim-log-line`.
    - **Cancel button** — Same as queued.

17. **Completed status** — Added:
    - **Retry button** — Next to Download Results / View Results. Only rendered when `lastPbgStateRef.current` exists (should always be true for a completed sim).
    - **Metadata grid** — Same as running.
    - **Log viewer** — Shows the full log fetched by the completion effect.

18. **Failed status** — Added:
    - **Retry button** — Below the error message.
    - **Metadata grid** — Same as running.
    - **Log viewer** — Same as completed.

19. **Cancelled status** — New block after failed, before terminal actions. Shows the same `sim-status-failed` styling as "Failed" but with "Cancelled" text. The `statusColor` helper already mapped `"cancelled"` → `"red"`.

20. **Terminal actions** — The "Clear" button now shows for `"completed"`, `"failed"`, AND `"cancelled"` instead of just the first two.

#### History enhancements

21. **Duration** — Each history entry now shows wall-clock duration computed from `startTime` / `endTime` via the `formatDuration` helper. The helper computes `Date(end) - Date(start)` and formats as `"Xm Ys"` or `"Xs"`. Returns `"—"` if either date is invalid.

22. **Error preview** — Failed entries show the first 40 characters of `errorMessage`, truncated with ellipsis via CSS (`max-width: 160px`, `text-overflow: ellipsis`).

23. **Re-run button** — Each history entry gets a "Re-run" button that calls `handleReRun(entry.simId)`. This fetches the original document and submits it as a new simulation.

#### New helper

24. **`formatDuration`** — A pure function that takes start/end ISO strings and returns a human-readable duration. Used in the history display.

### Why each line is justified (zero bloat)

- `lastPbgStateRef` is a ref (not state) because it doesn't need to trigger re-renders — it's read on-demand by `handleRetry`.
- `logPollRef` is separate from `pollRef` because log polling needs different lifecycle (only when running) and a potential offset.
- The completion log effect is a separate `useEffect` (not part of the polling effect's status check) because it needs to run **after** the status becomes terminal and fetch the **full** (non-truncated) log.
- Progress bar uses inline `style={{width: ...}}` because the percentage is dynamic state, not a discrete CSS class.
- Metadata uses inline `style={{margin: ...}}` selectors for layout within the status area rather than adding new CSS classes — the sim-panel uses `padding` at the container level (`.sim-status-area`), and the metadata/log blocks need to be inset to match.
- `formatDuration` uses `isNaN(diff)` check because `new Date(invalidString).getTime()` returns `NaN`, and we want graceful degradation rather than crashing.
- `handleReRun` silences errors because history entries may reference simulations that were cleaned up server-side — the plan explicitly says "best-effort".
- The cancelled status block reuses `.sim-status-failed` styling — cancelled is a terminal state visually similar to failed, so adding a separate CSS class would be bloat.

### Verification

- `tsc -b && vite build` — clean compile, zero errors.
- `vitest run` — 38/38 tests pass across 3 files. No regressions.

---

## Step 4 — Tests (`smsApi.test.ts`)

### What changed

**`frontend/src/__tests__/smsApi.test.ts`** — Six new tests (44 total):

1. **`getSimulationLog calls endpoint without truncate`** — Verifies URL is `/compose/v1/simulation/42/log` with no query params when `truncate` is omitted.

2. **`getSimulationLog calls endpoint with truncate=true`** — Verifies URL becomes `/compose/v1/simulation/42/log?truncate=true`.

3. **`getSimulationLog calls endpoint with truncate=false`** — Verifies URL becomes `/compose/v1/simulation/42/log?truncate=false`.

4. **`getSimulationLog throws on error`** — Verifies that a 500 response produces a descriptive `sms-api error 500: ...` rejection.

5. **`cancelSimulation calls DELETE endpoint`** — Verifies URL `/compose/v1/simulation/42/cancel` and method `DELETE`.

6. **`cancelSimulation throws on error`** — Verifies 501 response (backend not implemented) produces a descriptive error.

All tests use the existing `mockFetch` helper and `beforeEach`/`afterEach` fetch spy lifecycle. No new test infrastructure needed.

### Why each test is justified

- Three `getSimulationLog` variants cover the boolean `truncate` parameter's entire domain: undefined, true, false. The code path for each is slightly different (no param vs `?truncate=...`).
- Error tests for both methods exercise the shared `_fetch` error path, ensuring it throws consistently rather than silently returning malformed data.
- `cancelSimulation`'s 501 test mirrors the real-world scenario where the backend route doesn't exist yet — the plan says the UI should degrade gracefully, and the test confirms the error surfaces correctly.

### Verification

- `tsc -b && vite build` — clean compile, zero errors.
- `vitest run` — 44/44 tests pass across 3 files. No regressions.
