# Bigraph Loom

Interactive visual editor for [process-bigraphs](https://github.com/vivarium-collective/process-bigraph). Provides a web-based interface for exploring, editing, and composing bigraph models — with full integration into the process-bigraph type system.

![Bigraph Loom — hierarchy view of a cell model with process inspector](docs/screenshot_inspector.png)

## Features

- **Visualize** process-bigraphs with stores (circles), processes (rectangles), and wires (edges)
- **Two view modes**: nested (stores inside stores) and hierarchical (place graph with processes to the side)
- **Inspect** nodes — see types, values, process ports with type annotations, config schemas, update function source code
- **Edit** values, configs, and rewire process ports to different stores
- **JSON editor** — view and edit the raw bigraph JSON with syntax highlighting and validation
- **Add/remove** stores and processes from a side panel, with access to the full Core registry
- **Import/export** `.pbg` files (JSON format)
- **Collapse/expand** groups by double-clicking
- **Schema validation** via `core.check()`
- **Custom Core support** — pass a Core with your own registered processes and types
- **Multi-user sessions** — each browser gets isolated state when deployed as a service
- **Jupyter integration** — embed in notebooks via IFrame
- **Graceful handling** of unregistered processes — imported bigraphs display even if the processes aren't in the current Core

## Installation

### Local development

```bash
pip install -e .
```

Build the frontend (requires Node.js):

```bash
cd frontend
npm install
npm run build
```

### Docker

```bash
docker build -t bigraph-loom .
docker run -p 8891:8891 bigraph-loom
```

## Quick Start

### As a web app

```python
from bigraph_loom import run_server

run_server()  # opens http://127.0.0.1:8891 with an example bigraph
```

### With your own state

```python
from bigraph_loom import run_server

state = {
    'A': 1.0,
    'B': 0.0,
    'reaction': {
        '_type': 'process',
        'address': 'local:Reaction',
        'config': {'rate': 0.1},
        'inputs': {'substrate': ['A']},
        'outputs': {'product': ['B']},
    },
}

run_server(state=state)
```

### With a custom Core

```python
from process_bigraph import allocate_core
from bigraph_loom import run_server

core = allocate_core()
# Register your processes and types on core...

run_server(state=my_state, schema=my_schema, core=core)
```

### In Jupyter

```python
from bigraph_loom.jupyter import show

show(state=my_state, core=my_core, height=700)
```

### Import a .pbg file

Use the **Import .pbg** button in the header to load any `.pbg` or `.json` file. The bigraph will display even if some processes are not registered in the current Core — unregistered processes show a warning badge.

## Deploying as a Public Service

Bigraph Loom includes session support — each visitor gets their own isolated bigraph state. To deploy publicly:

### Render (recommended — free tier)

1. Push to GitHub (already done: [vivarium-collective/bigraph-loom](https://github.com/vivarium-collective/bigraph-loom))
2. Go to [render.com](https://render.com) and create a new **Web Service**
3. Connect the `vivarium-collective/bigraph-loom` repository
4. Render auto-detects the Dockerfile. Configure:
   - **Environment**: Docker
   - **Instance type**: Free (or Starter for better performance)
   - **Port**: 8891
5. Click **Deploy**

Your app will be live at `https://bigraph-loom.onrender.com` (or similar).

### Fly.io

```bash
# Install flyctl: https://fly.io/docs/flyctl/install/
fly launch          # auto-detects Dockerfile, creates app
fly deploy          # builds and deploys
```

### Railway

1. Go to [railway.app](https://railway.app)
2. New Project → Deploy from GitHub repo
3. It detects the Dockerfile and deploys automatically

### Any VPS (DigitalOcean, AWS, etc.)

```bash
# On the server
git clone https://github.com/vivarium-collective/bigraph-loom.git
cd bigraph-loom
docker build -t bigraph-loom .
docker run -d -p 8891:8891 --restart unless-stopped bigraph-loom
```

Then point a domain at the server and put it behind a reverse proxy (nginx/caddy) with HTTPS.

### Session behavior

- Each browser gets its own session via a cookie (`bgloom_sid`)
- Sessions are isolated — one user's edits don't affect others
- Sessions expire after 1 hour of inactivity
- The default bigraph (set via `load_bigraph()` or the example) is what new sessions start with
- The Core (registered types and processes) is shared across all sessions

## Architecture

- **Backend**: Python / FastAPI — serves the API and built frontend
  - `bigraph_loom/api.py` — REST endpoints for graph data, editing, import/export, Core integration
  - `bigraph_loom/convert.py` — converts bigraph state dicts to React Flow nodes and edges
  - `bigraph_loom/session.py` — session management for multi-user isolation
  - `bigraph_loom/server.py` — server runner with browser auto-open
  - `bigraph_loom/jupyter.py` — Jupyter notebook integration
- **Frontend**: TypeScript / React / [React Flow](https://reactflow.dev/)
  - Custom node types for stores, processes, and groups
  - Inspector panel with editing, rewiring, and process source display
  - JSON editor panel with CodeMirror
  - Add panel for creating new processes and stores
  - Dagre-based automatic layout

## API Endpoints

All session-scoped endpoints use a `bgloom_sid` cookie for state isolation.

| Endpoint | Method | Description |
|---|---|---|
| `/api/graph` | GET | React Flow nodes and edges (`?view=nested\|hierarchical`) |
| `/api/state` | GET | Raw bigraph state and schema |
| `/api/state` | PUT | Replace full state (with optional validation) |
| `/api/export` | GET | Download `.pbg` file |
| `/api/import` | POST | Upload and load a `.pbg` file |
| `/api/load` | POST | Load state via JSON body |
| `/api/node/{path}` | GET | Node details |
| `/api/node/{path}/value` | PUT | Update a store value |
| `/api/node/{path}/config` | PUT | Update process config |
| `/api/process` | POST | Add a new process |
| `/api/store` | POST | Add a new store |
| `/api/nest` | POST | Move a node under a new parent |
| `/api/rewire` | POST | Rewire a process port |
| `/api/node/{path}` | DELETE | Remove a node |
| `/api/check` | POST | Run `core.check()` on state |
| `/api/fill` | POST | Fill state with schema defaults |
| `/api/infer` | POST | Infer schema from state |
| `/api/registry` | GET | List registered processes (shared) |
| `/api/types` | GET | List registered types (shared) |
| `/api/core-info` | GET | Core class, source file, counts (shared) |
| `/api/process-source/{addr}` | GET | Process source, ports, config schema (shared) |
