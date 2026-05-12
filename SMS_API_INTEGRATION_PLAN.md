# SMS-API Integration Plan — Bigraph Loom as Visual Client of Compose

## Objective

Make Bigraph Loom a client of the sms-api compose system. Users visually build process-bigraph documents in the React Flow editor, submit them as simulations to the HPC (sms-api-rke via compose endpoints), monitor job progress, and inspect results — all from a single, independently hosted SPA with no backend.

---

## Architecture

```
┌───────────────────────────────────────────────────────┐
│  Bigraph Loom (independently hosted, no backend)      │
│                                                       │
│  ┌───────────────────────────────────────────────────┐│
│  │  Frontend (React Flow SPA)                        ││
│  │                                                   ││
│  │  PBG State (in-memory)                            ││
│  │    │                                               ││
│  │    ├── convert.ts                                  ││
│  │    │   state dict ──→ React Flow {nodes, edges}    ││
│  │    │                                               ││
│  │    └── Local mutations                             ││
│  │        add/delete/wire/nest/edit                   ││
│  │        (no backend calls for editing)              ││
│  │                                                   ││
│  │  Panels:                                           ││
│  │    Inspector | Library | Processes | Edit | JSON   ││
│  │    Simulation | Results          ← NEW             ││
│  └──────────┬────────────────────────────────────────┘│
│             │ HTTP (fetch)                             │
└─────────────┼─────────────────────────────────────────┘
              │
              ▼ sms-api base URL (configurable at runtime)
    ┌────────────────────────────────────┐
    │  sms-api compose  /compose/v1/*    │
    │                                    │
    │  GET /processes                    │
    │  GET /types                        │
    │  POST /simulation/run              │
    │  GET /simulation/{id}/status       │
    │  GET /simulation/{id}/results      │
    │  GET /simulation/{id}/document     │
    └────────────────────────────────────┘
```

---

## Work Packages

### WP0 — Port `convert.py` to TypeScript ✅

**Goal**: Eliminate the bigraph-loom FastAPI backend by porting the PBG→ReactFlow conversion to run in-browser.

**File**: `frontend/src/convert.ts` (~250 LOC)

| Python (`convert.py`) | TypeScript | Purpose |
|---|---|---|
| `is_process()` | `isProcess()` | Detect process nodes in state dict |
| `bigraph_to_flow()` | `bigraphToFlow()` | Walk state dict → `{nodes, edges}` |
| `resolve_wire()` | `resolveWire()` | Resolve `["..", "mass"]` paths |
| `_add_process_node()` | `addProcessNode()` | Build process node + wire edges |
| `_add_store_node()` | `addStoreNode()` | Build store node (group or leaf) |
| `_add_implicit_stores()` | `addImplicitStores()` | Auto-create stores for dangling wires |
| `normalize_address()` | `normalizeAddress()` | Dict address → `"local:Name"` |
| `path_to_id()` | `pathToId()` | Path tuple → slash-separated ID |
| `_serialize_value()` | `serializeValue()` | Value display formatting |
| `_parse_port_schema()` | `parsePortSchema()` | Port schema string → dict |

--- 

### WP1 — Standalone Editor Mode ✅

**Goal**: The frontend manages PBG state in browser memory. No calls to `bigraph_loom/api.py`.

**Changes to `App.tsx`**:

| Current (backend-dependent) | New (local state) |
|---|---|
| `fetchGraph()` → `GET /api/graph` | `bigraphToFlow(state)` → `setNodes(setEdges(...))` |
| `POST /api/store` | `setState(prev => deepCopy + add key)` |
| `POST /api/process` | `setState(prev => deepCopy + add process dict)` |
| `DELETE /api/node/{path}` | `setState(prev => deepCopy + delete path)` |
| `POST /api/rewire` | `setState(prev => deepCopy + update port wire)` |
| `POST /api/nest` | `setState(prev => deepCopy + move subtree)` |
| `PUT /api/node/{path}/value` | `setState(prev => deepCopy + set value)` |
| `PUT /api/node/{path}/config` | `setState(prev => deepCopy + set config)` |

**Utility functions** (ported from api.py helpers):
- `getInState(state, path)` — traverse into dict by path array
- `setInState(state, path, value)` — immutable set at path
- `deleteInState(state, path)` — immutable delete at path

**Import/Export**:
- `Import`: file reader → JSON parse → `setState()`
- `Export`: serialize state → download JSON blob
- **Library**: save/load from `localStorage` (replaces server-side session library)

**Removed from `package.json`**: no server dependencies. The frontend becomes a pure static app.

--- 

### WP2 — Sms-api Compose Client ✅

**File**: `frontend/src/smsApi.ts` (~150 LOC)

```typescript
class SmsApiComposeClient {
  constructor(baseUrl: string);

  // Compute registry — for the process palette
  async listProcesses(): Promise<BiGraphProcess[]>;
  async listTypes(): Promise<string[]>;

  // Simulation lifecycle
  async submitSimulation(pbgBlob: Blob, intervalTime?: number): Promise<ComposeSimulationExperiment>;
  async getSimulationStatus(simId: number): Promise<ComposeHpcRun>;
  async getSimulationResults(simId: number): Promise<Blob>;
  async getSimulationDocument(simId: number): Promise<object>;

  // Convenience
  async waitForCompletion(simId: number, pollMs?: number, timeoutMs?: number): Promise<ComposeHpcRun>;
}
```

**`submitSimulation` flow**:
1. Serialize current PBG state → `Blob` (application/json, `document.pbg`)
2. Build `FormData` with the blob as `uploaded_file`
3. POST multipart to `${baseUrl}/compose/v1/simulation/run?interval_time=${interval}`
4. Parse response → return `ComposeSimulationExperiment`

--- 

### WP3 — Simulation Submission Panel ✅

**New UI components**:

**Toolbar button**: `[Run]` alongside existing `[Compact] [Hierarchy] [Expand] [Collapse]`.

**Submission modal** (on "Run" click):
- sms-api Base URL text field (persisted to `localStorage`, default from `VITE_SMS_API_BASE_URL`)
- Interval time slider (0.1–100s, default 1.0)
- PBG summary preview (process count, store count, wire count)
- "Submit" button

**`SimulationPanel.tsx`** — new side panel:

| State | Display |
|---|---|
| Submitting | Spinner + "Submitting simulation..." |
| Queued | Yellow badge + simulation ID |
| Running | Blue pulsing badge + elapsed time |
| Completed | Green badge + "Download Results" / "View Results" |
| Failed | Red badge + error message |

**Polling**: `setInterval` at 5s calling `getSimulationStatus()`. Stops on Completed or Failed.

**History**: Array of `{simId, status, experimentId, timestamp}` persisted in `localStorage`. Shown as a list at the bottom of SimulationPanel. Clicking a past entry re-opens its results.

--- 

### WP4 — Process Registry Palette ✅

**Edit panel modification**: Add a "Registry" tab to `EditPanel.tsx`.

- Calls `smsApi.listProcesses()` on mount (caches result for the session)
- Renders a searchable/filterable list:

  ```
  ┌─ Search: [______________________] ─┐
  │   v2ecoli.composite.make_composite │
  │   ├─ inputs:  ()                   │
  │   ├─ outputs: mass, volume         │
  │   └─ [Add to Graph]                │
  │                                     │
  │   CopasiUTCStep                     │
  │   ├─ inputs:  ()                   │
  │   ├─ outputs: ()                   │
  │   └─ [Add to Graph]                │
  └─────────────────────────────────────┘
  ```

- "Add to Graph" auto-fills the Add Process form with the registry process's address, inputs, and outputs
- If the process has a config schema (via `GET /process/{name}/config-schema`), shows fields for those too

--- 

### WP5 — Results Viewer (Full) ✅

**File**: `frontend/src/panels/ResultsViewer.tsx` (~300 LOC)

Opens when a simulation completes and the user clicks "View Results". Downloads and parses the results zip client-side.

**Dependency**: `jszip` (added to `package.json`)

**Tabbed layout**:

| Tab | Content |
|---|---|
| **Summary** | Experiment ID, simulation ID, duration, final PBG state overview (process names + status, store keys + values) |
| **JSON** | CodeMirror editor with syntax highlighting showing `final_state.json` (or the first JSON file found in the zip) |
| **Data** | Sortable HTML tables from TSV/CSV output files. Pagination for rows > 1000. Column sorting by click. |
| **Plots** | Gallery layout: HTML analysis plots embedded in `<iframe sandbox="allow-scripts">`, PNG/SVG as `<img>` |
| **Files** | Full file listing from the zip with individual download links |

**Implementation**:
```typescript
async function loadResults(simId: number): Promise<ResultsData> {
  const blob = await smsApi.getSimulationResults(simId);
  const zip = await JSZip.loadAsync(blob);
  const files: Record<string, string | Blob> = {};
  for (const [name, entry] of Object.entries(zip.files)) {
    if (!entry.dir) {
      files[name] = name.endsWith(".json") || name.endsWith(".tsv") || name.endsWith(".csv")
        ? await entry.async("string")
        : await entry.async("blob");
    }
  }
  return classifyFiles(files);
}
```

`classifyFiles()` separates files by extension → renders each tab's content.

--- 

### WP6 — Hosting ✅

**Config mechanism** (`frontend/src/config.ts`):
```typescript
export const DEFAULT_SMS_API_BASE_URL = import.meta.env.VITE_SMS_API_BASE_URL ?? "https://sms.cam.uchc.edu";
```
Runtime override in the UI → persisted to `localStorage` key `smsApiBaseUrl`.

**Build**:
```bash
cd frontend && VITE_SMS_API_BASE_URL="https://sms.cam.uchc.edu" npm run build
# → frontend/dist/  (pure static files)
```

**Deploy pipeline**:
1. **Development**: GitHub Pages — push `frontend/dist/` to `gh-pages` branch
2. **Production**: S3 bucket + CloudFront distribution in the sms-api AWS account
   - `aws s3 sync frontend/dist/ s3://<bucket>/ --delete`
   - CloudFront invalidation: `aws cloudfront create-invalidation --distribution-id <id> --paths "/*"`

No Dockerfile needed — the app is pure static HTML/JS/CSS.

--- 

### WP7 — Testing ✅

| Scope | Method |
|---|---|
| `convert.ts` unit tests | Vitest: known PBG inputs → assert nodes/edges count, types, IDs, wire resolution |
| Editor mutations | Vitest: apply add/delete/rewire → assert state dict shape |
| SmsApi client | Mock fetch → assert correct URL, method, body format for each endpoint |
| Manual E2E | Compose graph → submit to sms-api-rke → poll → view results |
| Cross-browser | Chrome + Firefox: full E2E |

---

## Files Changed / Created

| File | Action | WP |
|---|---|---|
| `frontend/src/convert.ts` | Create | WP0 |
| `frontend/src/config.ts` | Create | WP6 |
| `frontend/src/smsApi.ts` | Create | WP2 |
| `frontend/src/App.tsx` | Modify | WP1 |
| `frontend/src/api.ts` | Modify | WP1 |
| `frontend/src/panels/SimulationPanel.tsx` | Create | WP3 |
| `frontend/src/panels/ResultsViewer.tsx` | Create | WP5 |
| `frontend/src/panels/EditPanel.tsx` | Modify | WP4 |
| `frontend/src/types.ts` | Modify | WP2, WP5 |
| `frontend/package.json` | Modify | WP5 (add `jszip`) |
| `frontend/index.html` | Possibly modify | WP6 (meta tags) |
| `AGENTS.md` | Modify | Post-implementation |

---

## Effort Estimate

| WP | Description | Sessions |
|---|---|---|
| WP0 | Port `convert.py` → `convert.ts` | 1 |
| WP1 | Standalone editor, local state mutations | 1 |
| WP2 | sms-api compose client | 0.5 |
| WP3 | SimulationPanel + submission modal + polling | 1 |
| WP4 | Registry palette in EditPanel | 0.5 |
| WP5 | Full results viewer (CodeMirror + tables + plots) | 1.5 |
| WP6 | GitHub Pages + S3/CloudFront config | 0.5 |
| WP7 | Tests + E2E verification | 1 |

**Total: ~7 sessions**

---

### Future: SSE for Live Progress

The plan uses polling (`setInterval` at 5s) for simulation status. The **eventual goal** is to replace polling with Server-Sent Events (SSE) for live simulation progress feedback — streaming status updates, elapsed time, and partial results as the HPC job runs. This is noted for future implementation; the current plan sticks with polling. See WP3 / `SimulationPanel.tsx` for where the SSE subscription point would integrate.
