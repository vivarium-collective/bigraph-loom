# Bigraph Loom

Interactive visual editor for [process-bigraphs](https://github.com/vivarium-collective/process-bigraph). Explore, edit, and compose bigraph models in a web interface with full integration into the process-bigraph type system.

![Bigraph Loom — hierarchy view of a cell model with process inspector](docs/screenshot_inspector.png)

## Features

- **Visualize** process-bigraphs with stores (circles), processes (rectangles), place edges (hierarchy), and wire edges (port connections)
- **Inspect** nodes — click to see types, values, port types, config, update function source code
- **Edit wiring** — type new wire paths in the inspector or drag between port handles and store nodes
- **Edit hierarchy** — drag store-to-store to nest nodes, or use the "Move Into" dropdown
- **Create** stores, processes from the Core registry, or custom processes via the Edit panel
- **JSON editor** — view and edit the raw bigraph with syntax highlighting and schema validation
- **Library** — switch between example `.pbg` files, save/load your own with preserved view state (positions, collapsed groups, zoom)
- **Process list** — toggle process visibility with checkboxes
- **View controls** — Compact (tight grid), Hierarchy (outers above inners), Expand (show all), Collapse (collapse all groups)
- **Import/export** `.pbg` files
- **Multi-user sessions** — each browser gets isolated state when deployed as a service
- **Jupyter integration** — embed in notebooks via IFrame
- **Graceful handling** of unregistered processes — imported bigraphs display even if processes aren't in the current Core

## Installation

### Local development

```bash
pip install -e .
cd frontend && npm install && npm run build
```

### Docker

```bash
docker build -t bigraph-loom .
docker run -p 8891:8891 bigraph-loom
```

## Quick Start

```python
from bigraph_loom import run_server

# Start with the bundled ecoli model
run_server()

# Or with your own state
run_server(state=my_state, schema=my_schema, core=my_core)
```

### In Jupyter

```python
from bigraph_loom.jupyter import show
show(state=my_state, core=my_core, height=700)
```

## Deploying as a Public Service

### Render (recommended)

1. Connect the [vivarium-collective/bigraph-loom](https://github.com/vivarium-collective/bigraph-loom) repo
2. Render auto-detects the Dockerfile — set port to `8891`
3. Deploy

### Fly.io

```bash
fly launch && fly deploy
```

### Docker on any server

```bash
docker build -t bigraph-loom .
docker run -d -p 8891:8891 --restart unless-stopped bigraph-loom
```

## UI Overview

### Header controls

```
[Compact | Hierarchy | Expand | Collapse]  [New] [Import] [Export]  [Library | Processes | Edit | JSON]
```

- **Compact** — gather all visible nodes into a tight grid
- **Hierarchy** — dagre tree layout with outers above inners, processes to the side
- **Expand** — show all hidden/collapsed nodes and re-layout
- **Collapse** — collapse all group stores
- **New** — start with a blank bigraph
- **Import / Export** — load and save `.pbg` files

### Side panels

- **Inspector** (click any node) — path, type info, editable port wires, config, process source, "Move Into" for nesting, hide/delete
- **Library** — bundled examples + saved bigraphs with view state
- **Processes** — checklist to toggle process visibility
- **Edit** — add stores, registry processes, or custom processes
- **JSON** — full editor with syntax highlighting, validate (schema check), and apply

### Interactions

- **Click** a node to inspect it
- **Double-click** a group store to collapse/expand, or any other node to hide it
- **Drag** a node to reposition it
- **Drag** from a process port handle to a store to wire them
- **Drag** from a store to another store to nest (source becomes parent)

## Architecture

- **Backend**: Python / FastAPI
  - `bigraph_loom/api.py` — REST endpoints with session-scoped state
  - `bigraph_loom/convert.py` — bigraph state → React Flow nodes and edges
  - `bigraph_loom/session.py` — multi-user session management
  - `bigraph_loom/server.py` — server runner, loads bundled examples
  - `bigraph_loom/jupyter.py` — Jupyter notebook integration
- **Frontend**: TypeScript / React / [React Flow](https://reactflow.dev/)
  - Custom store and process node components with port handles
  - Inspector, Library, Process List, Edit, and JSON panels
  - Dagre-based hierarchical layout
  - Lazy-loaded CodeMirror for JSON editing

## API Endpoints

All session-scoped endpoints use a `bgloom_sid` cookie.

| Endpoint | Method | Description |
|---|---|---|
| `/api/graph` | GET | React Flow nodes and edges |
| `/api/state` | GET/PUT | Raw bigraph state (PUT validates optionally) |
| `/api/export` | GET | Download `.pbg` file |
| `/api/import` | POST | Upload `.pbg` file |
| `/api/load` | POST | Load state from JSON body |
| `/api/node/{path}` | GET/DELETE | Get or delete a node |
| `/api/node/{path}/value` | PUT | Update store value |
| `/api/node/{path}/config` | PUT | Update process config |
| `/api/process` | POST | Add a process |
| `/api/store` | POST | Add a store |
| `/api/nest` | POST | Move a node under a new parent |
| `/api/rewire` | POST | Change a port's wire target |
| `/api/check` | POST | Run `core.check()` |
| `/api/library` | GET | List examples + saved bigraphs |
| `/api/library/load/{name}` | POST | Load from library |
| `/api/library/save` | POST | Save current state + view |
| `/api/registry` | GET | List registered processes |
| `/api/process-source/{addr}` | GET | Process source, ports, config schema |
| `/api/core-info` | GET | Core class, type/process counts |
