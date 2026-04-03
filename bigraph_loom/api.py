"""FastAPI routes for Bigraph Loom."""

from __future__ import annotations

import copy
import inspect
import json
import textwrap
from typing import Any, Literal

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from bigraph_loom.convert import bigraph_to_flow, ViewMode, normalize_address, is_process

app = FastAPI(title="Bigraph Loom", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── In-memory state ──────────────────────────────────────────────────────────

_state: dict[str, Any] = {}
_schema: dict[str, Any] | None = None
_core: Any = None  # bigraph_schema Core instance


def load_bigraph(
    state: dict,
    schema: dict | None = None,
    core: Any = None,
) -> None:
    """Load a bigraph state (and optional schema/core) into the server."""
    global _state, _schema, _core
    _state = copy.deepcopy(state)
    _schema = copy.deepcopy(schema) if schema else None
    if core is not None:
        _core = core


def set_core(core: Any) -> None:
    """Set the Core instance (with registered processes and types)."""
    global _core
    _core = core


def _get_core() -> Any:
    """Return the current Core, allocating a default one if needed."""
    global _core
    if _core is None:
        from process_bigraph import allocate_core
        _core = allocate_core()
    return _core


def _process_info(name: str, core: Any) -> dict[str, Any]:
    """Extract rich info about a registered process class."""
    info: dict[str, Any] = {
        "name": name,
        "address": f"local:{name}",
        "registered": False,
    }

    try:
        cls = core.link_registry[name]
    except (KeyError, TypeError):
        info["registered"] = False
        return info

    info["registered"] = True
    info["class"] = f"{cls.__module__}.{cls.__qualname__}"
    info["module"] = getattr(cls, "__module__", None)

    # Source location
    try:
        info["source_file"] = inspect.getfile(cls)
        info["source_line"] = inspect.getsourcelines(cls)[1]
    except (TypeError, OSError):
        info["source_file"] = None
        info["source_line"] = None

    # config_schema
    info["config_schema"] = _safe_serialize(getattr(cls, "config_schema", {}))

    # Interface (port types)
    try:
        instance = cls({}, core=core)
        info["inputs"] = _safe_serialize(instance.inputs())
        info["outputs"] = _safe_serialize(instance.outputs())
    except Exception:
        info["inputs"] = {}
        info["outputs"] = {}

    # Update function info
    try:
        update_method = cls.update
        info["update_signature"] = str(inspect.signature(update_method))
        try:
            source = inspect.getsource(update_method)
            info["update_source"] = textwrap.dedent(source)
            # Extract just the docstring if present
            doc = inspect.getdoc(update_method)
            if doc:
                info["update_docstring"] = doc
        except (TypeError, OSError):
            info["update_source"] = None
    except (AttributeError, TypeError):
        info["update_signature"] = None

    return info


def _safe_serialize(obj: Any) -> Any:
    """Convert an object to JSON-safe form."""
    if isinstance(obj, dict):
        return {str(k): _safe_serialize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_safe_serialize(v) for v in obj]
    if isinstance(obj, (str, int, float, bool)) or obj is None:
        return obj
    return str(obj)


# ── Request / response models ────────────────────────────────────────────────

class LoadRequest(BaseModel):
    model_config = {"populate_by_name": True}

    state: dict[str, Any]
    schema_: dict[str, Any] | None = None


class UpdateValueRequest(BaseModel):
    value: Any


class AddProcessRequest(BaseModel):
    path: list[str]
    process_type: str = "process"
    address: str = ""
    config: dict[str, Any] = {}
    inputs: dict[str, list[str]] = {}
    outputs: dict[str, list[str]] = {}


class AddStoreRequest(BaseModel):
    path: list[str]
    value: Any = {}
    store_type: str | None = None


class NestRequest(BaseModel):
    source_path: list[str]
    target_parent: list[str]


class CheckRequest(BaseModel):
    path: list[str] | None = None


class RewireRequest(BaseModel):
    process_path: list[str]
    port_name: str
    direction: Literal["inputs", "outputs"]
    new_target: list[str]


# ── Helpers ──────────────────────────────────────────────────────────────────

def _get_at_path(d: dict, path: list[str]) -> Any:
    current = d
    for key in path:
        if not isinstance(current, dict) or key not in current:
            raise HTTPException(404, f"Path not found: {path}")
        current = current[key]
    return current


def _set_at_path(d: dict, path: list[str], value: Any) -> None:
    current = d
    for key in path[:-1]:
        if not isinstance(current, dict) or key not in current:
            raise HTTPException(404, f"Path not found: {path}")
        current = current[key]
    if not isinstance(current, dict):
        raise HTTPException(400, f"Cannot set value at {path}")
    current[path[-1]] = value


def _delete_at_path(d: dict, path: list[str]) -> None:
    current = d
    for key in path[:-1]:
        if not isinstance(current, dict) or key not in current:
            raise HTTPException(404, f"Path not found: {path}")
        current = current[key]
    if not isinstance(current, dict) or path[-1] not in current:
        raise HTTPException(404, f"Path not found: {path}")
    del current[path[-1]]


# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/api/graph")
def get_graph(view: ViewMode = Query("nested")) -> dict:
    """Return the full bigraph as React Flow nodes and edges."""
    return bigraph_to_flow(_state, schema=_schema, view=view)


@app.get("/api/state")
def get_state() -> dict:
    """Return the raw bigraph state."""
    return {"state": _state, "schema": _schema}


@app.get("/api/export")
def export_pbg() -> Response:
    """Export the full bigraph as a downloadable .pbg JSON file."""
    payload: dict[str, Any] = {"state": _state}
    if _schema:
        payload["schema"] = _schema
    content = json.dumps(payload, indent=2, default=str)
    return Response(
        content=content,
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=bigraph.pbg"},
    )


@app.post("/api/import")
async def import_pbg(file: UploadFile = File(...)) -> dict:
    """Import a .pbg file and load it as the current bigraph."""
    try:
        content = await file.read()
        data = json.loads(content)
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise HTTPException(400, f"Invalid JSON file: {e}")

    state = data.get("state", data)  # Support both {state: ...} and raw state dicts
    schema = data.get("schema", None)

    # Check which processes in the state are registered in the Core
    warnings = _check_unregistered_processes(state)

    load_bigraph(state, schema)
    return {"ok": True, "warnings": warnings}


@app.post("/api/load")
def post_load(req: LoadRequest) -> dict:
    """Load a new bigraph state."""
    warnings = _check_unregistered_processes(req.state)
    load_bigraph(req.state, req.schema_)
    return {"ok": True, "warnings": warnings}


def _check_unregistered_processes(state: dict, path: tuple = ()) -> list[dict]:
    """Walk state and find processes whose address is not in the Core registry."""
    warnings: list[dict] = []
    if not isinstance(state, dict):
        return warnings

    core = _get_core()
    for key, value in state.items():
        if key.startswith("_"):
            continue
        node_path = path + (key,)
        if is_process(value):
            address_str = normalize_address(value.get("address", ""))
            name = address_str.split(":", 1)[-1] if ":" in address_str else address_str
            if name and name not in core.link_registry:
                warnings.append({
                    "path": list(node_path),
                    "address": address_str,
                    "message": f"Process '{name}' is not registered in the current Core",
                })
        elif isinstance(value, dict):
            warnings.extend(_check_unregistered_processes(value, node_path))

    return warnings


@app.get("/api/node/{path:path}")
def get_node(path: str) -> dict:
    """Get details for a specific node by slash-separated path."""
    parts = path.split("/") if path else []
    value = _get_at_path(_state, parts)
    return {"path": parts, "value": value}


@app.put("/api/node/{path:path}/value")
def put_node_value(path: str, req: UpdateValueRequest) -> dict:
    """Update a node's value."""
    parts = path.split("/")
    _set_at_path(_state, parts, req.value)
    return {"ok": True, "path": parts, "value": req.value}


@app.put("/api/node/{path:path}/config")
def put_node_config(path: str, req: UpdateValueRequest) -> dict:
    """Update a process node's config."""
    parts = path.split("/")
    node = _get_at_path(_state, parts)
    if not isinstance(node, dict) or "_type" not in node:
        raise HTTPException(400, "Not a process node")
    node["config"] = req.value
    return {"ok": True, "path": parts}


@app.post("/api/process")
def post_process(req: AddProcessRequest) -> dict:
    """Add a new process to the bigraph."""
    process_spec: dict[str, Any] = {
        "_type": req.process_type,
        "address": req.address,
        "config": req.config,
        "inputs": {k: v for k, v in req.inputs.items()},
        "outputs": {k: v for k, v in req.outputs.items()},
    }
    _set_at_path(_state, req.path, process_spec)
    return {"ok": True, "path": req.path}


@app.post("/api/store")
def post_store(req: AddStoreRequest) -> dict:
    """Add a new store node to the bigraph."""
    _set_at_path(_state, req.path, req.value)
    return {"ok": True, "path": req.path}


@app.post("/api/nest")
def post_nest(req: NestRequest) -> dict:
    """Move a node under a new parent (nesting)."""
    value = _get_at_path(_state, req.source_path)
    value = copy.deepcopy(value)
    node_name = req.source_path[-1]

    parent = _get_at_path(_state, req.target_parent)
    if not isinstance(parent, dict):
        raise HTTPException(400, "Target parent must be a group/dict node")

    target_str = "/".join(req.target_parent)
    source_str = "/".join(req.source_path)
    if target_str.startswith(source_str + "/") or target_str == source_str:
        raise HTTPException(400, "Cannot nest a node under itself or its descendants")

    new_path = req.target_parent + [node_name]
    _set_at_path(_state, new_path, value)
    _delete_at_path(_state, req.source_path)
    return {"ok": True, "from": req.source_path, "to": new_path}


@app.post("/api/rewire")
def post_rewire(req: RewireRequest) -> dict:
    """Rewire a process port to a new target store path."""
    node = _get_at_path(_state, req.process_path)
    if not isinstance(node, dict) or node.get("_type") not in ("process", "step", "edge"):
        raise HTTPException(400, "Not a process node")
    wires = node.get(req.direction, {})
    if req.port_name not in wires:
        raise HTTPException(404, f"Port '{req.port_name}' not found in {req.direction}")
    wires[req.port_name] = req.new_target
    return {"ok": True, "process": req.process_path, "port": req.port_name, "target": req.new_target}


@app.delete("/api/node/{path:path}")
def delete_node(path: str) -> dict:
    """Remove a node from the bigraph."""
    parts = path.split("/")
    _delete_at_path(_state, parts)
    return {"ok": True, "path": parts}


# ── Core-powered endpoints ───────────────────────────────────────────────────

@app.get("/api/registry")
def get_registry() -> dict:
    """List available process/step types from the Core's link registry."""
    try:
        core = _get_core()
        process_list = []
        for name in core.link_registry:
            info = _process_info(name, core)
            process_list.append(info)
        return {"processes": process_list}
    except Exception as e:
        return {"processes": [], "error": str(e)}


@app.get("/api/types")
def get_types() -> dict:
    """List available types from the Core's type registry."""
    try:
        core = _get_core()
        type_list = []
        for name in core.registry:
            try:
                rendered = core.render({name: name})
                type_list.append({"name": name, "rendered": rendered})
            except Exception:
                type_list.append({"name": name, "rendered": name})
        return {"types": type_list}
    except Exception as e:
        return {"types": [], "error": str(e)}


@app.post("/api/check")
def post_check(req: CheckRequest) -> dict:
    """Run bigraph-schema check on the current state (or a sub-path)."""
    core = _get_core()
    try:
        if req.path:
            schema_sub = _get_at_path(_schema, req.path) if _schema else {}
            state_sub = _get_at_path(_state, req.path)
        else:
            schema_sub = _schema or {}
            state_sub = _state

        valid = core.check(schema_sub, state_sub)
        return {"valid": valid, "path": req.path or []}
    except Exception as e:
        return {"valid": False, "error": str(e), "path": req.path or []}


@app.post("/api/fill")
def post_fill() -> dict:
    """Fill the current state with defaults from the schema."""
    global _state
    core = _get_core()
    try:
        schema = _schema or {}
        filled = core.fill(schema, _state)
        _state = filled
        return {"ok": True}
    except Exception as e:
        raise HTTPException(400, f"Fill failed: {e}")


@app.post("/api/infer")
def post_infer() -> dict:
    """Infer schema types from the current state."""
    core = _get_core()
    try:
        inferred = core.infer(_state)
        rendered = core.render(inferred)
        return {"schema": rendered}
    except Exception as e:
        return {"schema": None, "error": str(e)}


@app.get("/api/core-info")
def get_core_info() -> dict:
    """Return info about the loaded Core instance."""
    core = _get_core()
    core_class = type(core)
    info: dict[str, Any] = {
        "class": f"{core_class.__module__}.{core_class.__qualname__}",
        "module": core_class.__module__,
        "num_types": len(list(core.registry)),
        "num_processes": len(list(core.link_registry)),
    }
    try:
        info["source_file"] = inspect.getfile(core_class)
    except (TypeError, OSError):
        info["source_file"] = None
    return info


@app.get("/api/process-source/{address:path}")
def get_process_source(address: str) -> dict:
    """Return rich info about a process by its address (e.g. 'local:MyProcess')."""
    core = _get_core()
    name = address.split(":", 1)[-1] if ":" in address else address
    return _process_info(name, core)
