# Bigraph Loom — AGENTS.md

## Quick start

```bash
cd frontend && npm install && npm run dev   # starts Vite on port 3000
npm run build                               # tsc -b && vite build → frontend/dist/
npm run preview                             # serve the built output
npm test                                    # vitest (38 tests, 3 files)
```

No backend needed — the frontend is a pure static SPA. State is managed in browser memory and persisted to `localStorage`.

## Development

**Frontend** — TypeScript / React 18 / React Flow / Vite. Source in `frontend/src/`.

**Note:** Theme CSS lives at `frontend/assets/opencode-matrix-theme.css`, imported in `frontend/src/main.tsx` via `../assets/opencode-matrix-theme.css`.

```bash
cd frontend && npm run dev   # port 3000
npm run build                # tsc -b && vite build, output to frontend/dist/
npm run preview              # serve the built output
```

**Tests** — vitest (no config file, uses defaults).

```bash
cd frontend && npm test                  # all tests (38)
npx vitest run src/__tests__/convert.test.ts  # single file
npx vitest run -t "bigraphToFlow"        # single test by name pattern
```

No linter, formatter, or typechecker config in this repo.

## Planner artifacts (never committed)

`CHANGES.md`, `commits.sh`, `SAVE_SLOT.md`, and `*_PLAN.md` files are planner
artifacts local to each session. They are `.gitignore`d and must NEVER be
committed. If one becomes tracked, run `git rm --cached <file>` to remove it
from the index.

## Suggesting commits                                                                          
                                                       
When you are about to suggest commits, do not run `git commit` yourself.                       
Instead, write a `./commits.sh` script for the user to run.
                                                                                                 
- Default: overwrite the script fresh each turn.                    
- Exception: when explicitly told to "append" the next step's commits                          
  (typical during multi-step plans), append to the existing script instead.                    
- Use plain `git commit -m ...` — never `-c commit.gpgsign=false`,                           
  `--no-gpg-sign`, or `--no-verify`. The user expects signed commits;                          
  the GPG password prompt at run-time is part of the verification.                             
- Heredoc gotcha: inside `git commit -m "$(cat <<'EOF' ... EOF)"` bodies,                      
  avoid unpaired single quotes (English contractions like `it's` /                             
  `ci.yml's`). Bash's lexer tracks quote state through the heredoc                             
  body when wrapped in `"$(...)"` and fails with "unexpected EOF                               
  while looking for matching '". Paired single quotes are fine.                                
- Run `bash -n commits.sh` before declaring it ready.                                          
- End the script with `git push origin <branch>`.   

This should occur anytime the user asks, "suggest commits", or something like that.

## Architecture (SMS-API client mode)

Bigraph Loom is a **backend-less SPA** that calls `sms-api` compose endpoints directly:

```
Frontend (React Flow SPA) ──HTTP──→ sms-api (/compose/v1/*) ──→ HPC cluster
```

- **PBG state** lives in browser memory (`useState` in `App.tsx`), persisted to `localStorage` under key `bgloom_current_state`.
- **Conversion**: `frontend/src/convert.ts` (`bigraphToFlow()`) walks the state dict → React Flow flat `{nodes, edges}`. Implicit stores auto-created for dangling wire targets.
- **Process detection**: dict with `_type ∈ {"process","edge","step","composite"}` OR dict with `"address"` + (`"inputs"` or `"outputs"`).
- **Wire paths**: relative lists with `".."` parent traversal, resolved via `resolveWire()`. E.g. `["..", "mass"]` points to sibling `mass`.
- **Layout**: dagre-based hierarchy layout in `layout.ts`. Compact and hierarchical modes.
- **State mutations** (add/delete/rewire/nest/edit) are local-only — no backend calls.
- **Panels**: Inspector, Library, Processes, Edit, JSON (CodeMirror), Simulation, Results.

### Legacy backend (Python/FastAPI)

The original backend at `bigraph_loom/` is still present but **no longer used** by the frontend. The frontend compiles to a pure static site. The Python package can still be used as a library via `bigraph_loom.jupyter.show()`.

## State model

- **Stores**: any non-process dict value or scalar. Dict stores are groups (nestable).
- **Processes**: dict with `_type`, `address`, `config`, `inputs`/`outputs` (maps port → wire path list).
- **Schema**: optional (`schema` key in `.pbg` files, mirrors `process-bigraph` type system).

## File map (frontend)

| File | Purpose |
|---|---|
| `frontend/src/App.tsx` | Main app component: local state, React Flow canvas, all mutation handlers |
| `frontend/src/api.ts` | State helpers (`getInState`/`setInState`/`deleteInState`), Library (localStorage), Import/Export |
| `frontend/src/convert.ts` | `bigraphToFlow()` — PBG state dict → React Flow nodes/edges |
| `frontend/src/smsApi.ts` | `SmsApiComposeClient` — HTTP client for sms-api compose endpoints |
| `frontend/src/config.ts` | Default/base URL config (`VITE_SMS_API_BASE_URL` env var + runtime override) |
| `frontend/src/types.ts` | Shared TypeScript types (NodeData, EdgeData, sms-api types) |
| `frontend/src/layout.ts` | `applyLayout()` / `applyCompactLayout()` — dagre-based positioning |
| `frontend/src/panels/InspectorPanel.tsx` | Node/property inspector sidebar |
| `frontend/src/panels/LibraryPanel.tsx` | Load/save graphs from localStorage library |
| `frontend/src/panels/ProcessListPanel.tsx` | Toggle process visibility |
| `frontend/src/panels/EditPanel.tsx` | Add stores, registry processes, or custom processes |
| `frontend/src/panels/JsonPanel.tsx` | CodeMirror JSON editor for raw state |
| `frontend/src/panels/SimulationPanel.tsx` | Submit & monitor simulations via sms-api |
| `frontend/src/panels/ResultsViewer.tsx` | Tabbed results viewer (JSON/Data/Plots/Files from zip) |
| `frontend/src/nodes/StoreNode.tsx` | React Flow custom node: store display |
| `frontend/src/nodes/ProcessNode.tsx` | React Flow custom node: process display |

## SMS-API integration (completed)

All 7 work packages from `SMS_API_INTEGRATION_PLAN.md` are implemented:

| WP | File(s) | Status |
|---|---|---|
| **WP0** | `frontend/src/convert.ts` (441 LOC) — PBG→ReactFlow port | ✅ |
| **WP1** | `App.tsx` + `api.ts` — local state, no backend calls | ✅ |
| **WP2** | `frontend/src/smsApi.ts` (123 LOC) — compose HTTP client | ✅ |
| **WP3** | `frontend/src/panels/SimulationPanel.tsx` — submission + polling + history | ✅ |
| **WP4** | `frontend/src/panels/EditPanel.tsx` — Registry tab with search | ✅ |
| **WP5** | `frontend/src/panels/ResultsViewer.tsx` — tabbed results viewer | ✅ |
| **WP6** | `frontend/src/config.ts` — runtime-configurable base URL | ✅ |
| **WP7** | `frontend/src/__tests__/` — 38 vitest tests across 3 files | ✅ |

Tests pass and TypeScript compiles cleanly.

### Key references

- sms-api compose routes: `POST /compose/v1/simulation/run`, `GET /compose/v1/simulation/{id}/status`, `GET /compose/v1/simulation/{id}/results`, `GET /compose/v1/processes`
- sms-api base URL (default): `https://sms.cam.uchc.edu`, overridable at runtime in Simulation panel
- sms-api OpenAPI spec: `https://sms.cam.uchc.edu/openapi.json`

### Build & deploy

**Development**: `VITE_SMS_API_BASE_URL="https://sms.cam.uchc.edu" npm run dev`

**Production build**:
```bash
cd frontend && VITE_SMS_API_BASE_URL="https://sms.cam.uchc.edu" npm run build
# → frontend/dist/ (pure static files, deployable anywhere)
```

**Deploy targets**:
1. **GitHub Pages** — push `frontend/dist/` to `gh-pages` branch
2. **S3 + CloudFront** — `aws s3 sync frontend/dist/ s3://<bucket>/ --delete` plus CloudFront invalidation

