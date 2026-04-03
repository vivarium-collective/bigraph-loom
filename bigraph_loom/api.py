"""FastAPI routes for Bigraph Loom."""

from __future__ import annotations

import copy
import inspect
import json
import textwrap
from typing import Any, Literal

from fastapi import Cookie, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from bigraph_loom.convert import bigraph_to_flow, normalize_address, is_process
from bigraph_loom.session import Session, sessions

app = FastAPI(title="Bigraph Loom", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SESSION_COOKIE = "bgloom_sid"

# ── Shared Core (read-only, all sessions share one) ─────────────────────────

_core: Any = None


def set_core(core: Any) -> None:
    """Set the shared Core instance (with registered processes and types)."""
    global _core
    _core = core


def _get_core() -> Any:
    """Return the shared Core, allocating a default one if needed."""
    global _core
    if _core is None:
        from process_bigraph import allocate_core
        _core = allocate_core()
    return _core


def load_bigraph(
    state: dict,
    schema: dict | None = None,
    core: Any = None,
) -> None:
    """Set the default bigraph state for new sessions, and optionally set Core."""
    if core is not None:
        set_core(core)
    sessions.set_defaults(state, schema)


# ── Session helpers ──────────────────────────────────────────────────────────

def _get_session(sid: str | None) -> tuple[Session, str]:
    """Get session by cookie value, or create a new one."""
    if sid:
        return sessions.get(sid), sid
    new_sid = sessions.create()
    return sessions.get(new_sid), new_sid


class _SafeEncoder(json.JSONEncoder):
    """JSON encoder that converts NaN/Infinity to null and non-serializable to str."""
    def default(self, o: Any) -> Any:
        return str(o)

    def encode(self, o: Any) -> str:
        return super().encode(self._clean(o))

    def _clean(self, obj: Any) -> Any:
        import math
        if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
            return None
        if isinstance(obj, dict):
            return {k: self._clean(v) for k, v in obj.items()}
        if isinstance(obj, (list, tuple)):
            return [self._clean(v) for v in obj]
        return obj


def _session_response(data: dict, sid: str) -> Response:
    """Return JSON with session cookie set. Handles NaN/Infinity floats."""
    content = _SafeEncoder().encode(data)
    resp = Response(content=content, media_type="application/json")
    resp.set_cookie(
        SESSION_COOKIE, sid,
        httponly=True, samesite="lax", max_age=3600,
    )
    return resp


# ── Periodic cleanup ─────────────────────────────────────────────────────────

@app.on_event("startup")
async def _startup():
    import asyncio
    import json as _json
    from pathlib import Path
    from fastapi.staticfiles import StaticFiles

    # Load bundled .pbg examples if not already loaded (e.g. Docker direct uvicorn)
    if not sessions.examples:
        docs_dir = Path(__file__).parent.parent / "docs"
        if docs_dir.is_dir():
            for pbg_file in sorted(docs_dir.glob("*.pbg")):
                try:
                    data = _json.loads(pbg_file.read_text())
                    state = data.get("state", data)
                    schema = data.get("schema", None)
                    view_state = data.get("view_state", None)
                    sessions.add_example(pbg_file.stem, state, schema, view_state)
                except Exception:
                    pass

    # If no default state set yet, use ecoli_state example
    if not sessions._default_state and "cell_environment" in sessions.examples:
        ex = sessions.examples["cell_environment"]
        sessions.set_defaults(ex.state, ex.schema)

    # Mount built frontend if it exists (for Docker / production)
    frontend_dir = Path(__file__).parent.parent / "frontend" / "dist"
    if frontend_dir.is_dir():
        app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")

    # Start session cleanup loop
    async def _cleanup_loop():
        while True:
            await asyncio.sleep(300)
            sessions.cleanup()

    asyncio.create_task(_cleanup_loop())


# ── Process info helper ──────────────────────────────────────────────────────

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
        return info

    info["registered"] = True
    info["class"] = f"{cls.__module__}.{cls.__qualname__}"
    info["module"] = getattr(cls, "__module__", None)

    try:
        info["source_file"] = inspect.getfile(cls)
        info["source_line"] = inspect.getsourcelines(cls)[1]
    except (TypeError, OSError):
        info["source_file"] = None
        info["source_line"] = None

    info["config_schema"] = _safe_serialize(getattr(cls, "config_schema", {}))

    try:
        instance = cls({}, core=core)
        info["inputs"] = _safe_serialize(instance.inputs())
        info["outputs"] = _safe_serialize(instance.outputs())
    except Exception:
        info["inputs"] = {}
        info["outputs"] = {}

    try:
        update_method = cls.update
        info["update_signature"] = str(inspect.signature(update_method))
        try:
            source = inspect.getsource(update_method)
            info["update_source"] = textwrap.dedent(source)
            doc = inspect.getdoc(update_method)
            if doc:
                info["update_docstring"] = doc
        except (TypeError, OSError):
            info["update_source"] = None
    except (AttributeError, TypeError):
        info["update_signature"] = None

    return info


def _safe_serialize(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {str(k): _safe_serialize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_safe_serialize(v) for v in obj]
    if isinstance(obj, (str, int, float, bool)) or obj is None:
        return obj
    return str(obj)


# ── Request models ───────────────────────────────────────────────────────────

class LoadRequest(BaseModel):
    model_config = {"populate_by_name": True}
    state: dict[str, Any]
    schema_: dict[str, Any] | None = None


class UpdateValueRequest(BaseModel):
    value: Any


class UpdateStateRequest(BaseModel):
    state: dict[str, Any]
    schema_: dict[str, Any] | None = None
    run_check: bool = True


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


# ── Path helpers ─────────────────────────────────────────────────────────────

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


def _check_unregistered_processes(state: dict, path: tuple = ()) -> list[dict]:
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


# ── Session-scoped routes ────────────────────────────────────────────────────

@app.get("/api/graph")
def get_graph(bgloom_sid: str | None = Cookie(None)):
    sess, sid = _get_session(bgloom_sid)
    data = bigraph_to_flow(sess.state, schema=sess.schema, core=_get_core())
    return _session_response(data, sid)


@app.get("/api/state")
def get_state(bgloom_sid: str | None = Cookie(None)):
    sess, sid = _get_session(bgloom_sid)
    return _session_response({"state": sess.state, "schema": sess.schema}, sid)


@app.put("/api/state")
def put_state(req: UpdateStateRequest, bgloom_sid: str | None = Cookie(None)):
    sess, sid = _get_session(bgloom_sid)

    errors: list[str] = []
    if req.run_check:
        try:
            core = _get_core()
            schema = req.schema_ or sess.schema or {}
            if schema:
                valid = core.check(schema, req.state)
                if not valid:
                    errors.append("State does not match schema")
        except Exception as e:
            errors.append(f"Validation error: {e}")

    if errors:
        return _session_response({"ok": False, "errors": errors}, sid)

    warnings = _check_unregistered_processes(req.state)
    sess.state = copy.deepcopy(req.state)
    if req.schema_ is not None:
        sess.schema = copy.deepcopy(req.schema_)
    return _session_response({"ok": True, "warnings": warnings, "errors": []}, sid)


@app.get("/api/export")
def export_pbg(bgloom_sid: str | None = Cookie(None)):
    sess, sid = _get_session(bgloom_sid)
    payload: dict[str, Any] = {"state": sess.state}
    if sess.schema:
        payload["schema"] = sess.schema
    content = json.dumps(payload, indent=2, default=str)
    resp = Response(
        content=content,
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=bigraph.pbg"},
    )
    resp.set_cookie(SESSION_COOKIE, sid, httponly=True, samesite="lax", max_age=3600)
    return resp


@app.post("/api/import")
async def import_pbg(
    file: UploadFile = File(...),
    bgloom_sid: str | None = Cookie(None),
):
    sess, sid = _get_session(bgloom_sid)
    try:
        content = await file.read()
        data = json.loads(content)
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise HTTPException(400, f"Invalid JSON file: {e}")

    state = data.get("state", data)
    schema = data.get("schema", None)
    warnings = _check_unregistered_processes(state)

    sess.state = copy.deepcopy(state)
    sess.schema = copy.deepcopy(schema) if schema else sess.schema
    return _session_response({"ok": True, "warnings": warnings}, sid)


@app.post("/api/load")
def post_load(req: LoadRequest, bgloom_sid: str | None = Cookie(None)):
    sess, sid = _get_session(bgloom_sid)
    warnings = _check_unregistered_processes(req.state)
    sess.state = copy.deepcopy(req.state)
    sess.schema = copy.deepcopy(req.schema_) if req.schema_ else sess.schema
    return _session_response({"ok": True, "warnings": warnings}, sid)


@app.get("/api/node/{path:path}")
def get_node(path: str, bgloom_sid: str | None = Cookie(None)):
    sess, sid = _get_session(bgloom_sid)
    parts = path.split("/") if path else []
    value = _get_at_path(sess.state, parts)
    return _session_response({"path": parts, "value": value}, sid)


@app.put("/api/node/{path:path}/value")
def put_node_value(path: str, req: UpdateValueRequest, bgloom_sid: str | None = Cookie(None)):
    sess, sid = _get_session(bgloom_sid)
    parts = path.split("/")
    _set_at_path(sess.state, parts, req.value)
    return _session_response({"ok": True, "path": parts, "value": req.value}, sid)


@app.put("/api/node/{path:path}/config")
def put_node_config(path: str, req: UpdateValueRequest, bgloom_sid: str | None = Cookie(None)):
    sess, sid = _get_session(bgloom_sid)
    parts = path.split("/")
    node = _get_at_path(sess.state, parts)
    if not isinstance(node, dict) or "_type" not in node:
        # Also check structural process detection
        if not is_process(node):
            raise HTTPException(400, "Not a process node")
    node["config"] = req.value
    return _session_response({"ok": True, "path": parts}, sid)


@app.post("/api/process")
def post_process(req: AddProcessRequest, bgloom_sid: str | None = Cookie(None)):
    sess, sid = _get_session(bgloom_sid)
    process_spec: dict[str, Any] = {
        "_type": req.process_type,
        "address": req.address,
        "config": req.config,
        "inputs": {k: v for k, v in req.inputs.items()},
        "outputs": {k: v for k, v in req.outputs.items()},
    }
    _set_at_path(sess.state, req.path, process_spec)
    return _session_response({"ok": True, "path": req.path}, sid)


@app.post("/api/store")
def post_store(req: AddStoreRequest, bgloom_sid: str | None = Cookie(None)):
    sess, sid = _get_session(bgloom_sid)
    _set_at_path(sess.state, req.path, req.value)
    return _session_response({"ok": True, "path": req.path}, sid)


@app.post("/api/nest")
def post_nest(req: NestRequest, bgloom_sid: str | None = Cookie(None)):
    sess, sid = _get_session(bgloom_sid)
    value = copy.deepcopy(_get_at_path(sess.state, req.source_path))
    node_name = req.source_path[-1]

    parent = _get_at_path(sess.state, req.target_parent)
    if not isinstance(parent, dict):
        raise HTTPException(400, "Target parent must be a group/dict node")

    target_str = "/".join(req.target_parent)
    source_str = "/".join(req.source_path)
    if target_str.startswith(source_str + "/") or target_str == source_str:
        raise HTTPException(400, "Cannot nest a node under itself or its descendants")

    new_path = req.target_parent + [node_name]
    _set_at_path(sess.state, new_path, value)
    _delete_at_path(sess.state, req.source_path)
    return _session_response({"ok": True, "from": req.source_path, "to": new_path}, sid)


@app.post("/api/rewire")
def post_rewire(req: RewireRequest, bgloom_sid: str | None = Cookie(None)):
    sess, sid = _get_session(bgloom_sid)
    node = _get_at_path(sess.state, req.process_path)
    if not is_process(node):
        raise HTTPException(400, "Not a process node")
    # Create the wires dict if it doesn't exist, and add/update the port
    if req.direction not in node:
        node[req.direction] = {}
    node[req.direction][req.port_name] = req.new_target
    return _session_response(
        {"ok": True, "process": req.process_path, "port": req.port_name, "target": req.new_target},
        sid,
    )


@app.delete("/api/node/{path:path}")
def delete_node(path: str, bgloom_sid: str | None = Cookie(None)):
    sess, sid = _get_session(bgloom_sid)
    parts = path.split("/")
    _delete_at_path(sess.state, parts)
    return _session_response({"ok": True, "path": parts}, sid)


@app.post("/api/check")
def post_check(req: CheckRequest, bgloom_sid: str | None = Cookie(None)):
    sess, sid = _get_session(bgloom_sid)
    core = _get_core()
    try:
        if req.path:
            schema_sub = _get_at_path(sess.schema, req.path) if sess.schema else {}
            state_sub = _get_at_path(sess.state, req.path)
        else:
            schema_sub = sess.schema or {}
            state_sub = sess.state
        valid = core.check(schema_sub, state_sub)
        return _session_response({"valid": valid, "path": req.path or []}, sid)
    except Exception as e:
        return _session_response({"valid": False, "error": str(e), "path": req.path or []}, sid)


@app.post("/api/fill")
def post_fill(bgloom_sid: str | None = Cookie(None)):
    sess, sid = _get_session(bgloom_sid)
    core = _get_core()
    try:
        schema = sess.schema or {}
        sess.state = core.fill(schema, sess.state)
        return _session_response({"ok": True}, sid)
    except Exception as e:
        raise HTTPException(400, f"Fill failed: {e}")


@app.post("/api/infer")
def post_infer(bgloom_sid: str | None = Cookie(None)):
    sess, sid = _get_session(bgloom_sid)
    core = _get_core()
    try:
        inferred = core.infer(sess.state)
        rendered = core.render(inferred)
        return _session_response({"schema": rendered}, sid)
    except Exception as e:
        return _session_response({"schema": None, "error": str(e)}, sid)


# ── Shared (session-independent) endpoints ───────────────────────────────────

@app.get("/api/core-info")
def get_core_info() -> dict:
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


@app.get("/api/registry")
def get_registry() -> dict:
    try:
        core = _get_core()
        return {"processes": [_process_info(name, core) for name in core.link_registry]}
    except Exception as e:
        return {"processes": [], "error": str(e)}


@app.get("/api/types")
def get_types() -> dict:
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


@app.get("/api/process-source/{address:path}")
def get_process_source(address: str) -> dict:
    core = _get_core()
    name = address.split(":", 1)[-1] if ":" in address else address
    return _process_info(name, core)


# ── Library endpoints (examples + per-session saved bigraphs) ────────────────

@app.get("/api/library")
def get_library(bgloom_sid: str | None = Cookie(None)):
    """List available bigraphs: built-in examples + user's saved bigraphs."""
    sess, sid = _get_session(bgloom_sid)
    examples = [
        {"name": name, "source": "example", "has_view": bool(sessions.examples[name].view_state and sessions.examples[name].view_state.get("positions"))}
        for name in sessions.examples
    ]
    saved = [
        {"name": name, "source": "saved", "saved_at": bg.saved_at, "has_view": bg.view_state is not None}
        for name, bg in sess.library.items()
    ]
    return _session_response({"files": examples + saved}, sid)


@app.post("/api/library/load/{name}")
def load_from_library(name: str, bgloom_sid: str | None = Cookie(None)):
    """Load a bigraph from the library (example or saved) into the session."""
    sess, sid = _get_session(bgloom_sid)

    if name in sessions.examples:
        bg = sessions.examples[name]
    elif name in sess.library:
        bg = sess.library[name]
    else:
        raise HTTPException(404, f"Bigraph '{name}' not found in library")

    sess.state = copy.deepcopy(bg.state)
    sess.schema = copy.deepcopy(bg.schema) if bg.schema else None
    warnings = _check_unregistered_processes(sess.state)
    return _session_response({
        "ok": True,
        "name": name,
        "warnings": warnings,
        "view_state": bg.view_state,
    }, sid)


class SaveRequest(BaseModel):
    name: str
    view_state: dict[str, Any] | None = None


@app.post("/api/library/save")
def save_to_library(req: SaveRequest, bgloom_sid: str | None = Cookie(None)):
    """Save the current bigraph state and view state to the session's library."""
    from bigraph_loom.session import SavedBigraph

    sess, sid = _get_session(bgloom_sid)
    sess.library[req.name] = SavedBigraph(
        name=req.name,
        state=copy.deepcopy(sess.state),
        schema=copy.deepcopy(sess.schema) if sess.schema else None,
        view_state=copy.deepcopy(req.view_state) if req.view_state else None,
    )
    return _session_response({"ok": True, "name": req.name}, sid)


@app.delete("/api/library/{name}")
def delete_from_library(name: str, bgloom_sid: str | None = Cookie(None)):
    """Delete a saved bigraph from the session's library."""
    sess, sid = _get_session(bgloom_sid)
    if name not in sess.library:
        raise HTTPException(404, f"Saved bigraph '{name}' not found")
    del sess.library[name]
    return _session_response({"ok": True, "name": name}, sid)
