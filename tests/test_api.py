"""Tests for bigraph_loom API endpoints."""

import json
import pytest
from fastapi.testclient import TestClient

from bigraph_loom.api import app, load_bigraph, set_core
from bigraph_loom.session import sessions


@pytest.fixture(autouse=True)
def reset_state():
    """Reset session state before each test."""
    sessions._sessions.clear()
    sessions._default_state = {}
    sessions._default_schema = None
    sessions.examples.clear()
    yield


@pytest.fixture
def client():
    return TestClient(app)


SIMPLE_STATE = {
    "A": 1.0,
    "B": 0.0,
    "reaction": {
        "_type": "process",
        "address": "local:Reaction",
        "inputs": {"substrate": ["A"]},
        "outputs": {"product": ["B"]},
    },
}


# ── Graph endpoint ───────────────────────────────────────────────────────────

def test_graph_empty(client):
    r = client.get("/api/graph")
    assert r.status_code == 200
    data = r.json()
    assert data["nodes"] == []
    assert data["edges"] == []


def test_graph_with_state(client):
    load_bigraph(SIMPLE_STATE)
    r = client.get("/api/graph")
    data = r.json()
    assert len(data["nodes"]) == 3
    assert len(data["edges"]) == 2


# ── State endpoint ───────────────────────────────────────────────────────────

def test_get_state(client):
    load_bigraph(SIMPLE_STATE)
    r = client.get("/api/state")
    data = r.json()
    assert "A" in data["state"]
    assert data["state"]["A"] == 1.0


def test_put_state(client):
    load_bigraph(SIMPLE_STATE)
    r = client.put("/api/state", json={"state": {"X": 42}, "run_check": False})
    assert r.json()["ok"]
    r2 = client.get("/api/state")
    assert r2.json()["state"] == {"X": 42}


# ── Load / Import ────────────────────────────────────────────────────────────

def test_load(client):
    r = client.post("/api/load", json={"state": SIMPLE_STATE})
    assert r.json()["ok"]
    r2 = client.get("/api/graph")
    assert len(r2.json()["nodes"]) == 3


def test_import_pbg(client, tmp_path):
    pbg = tmp_path / "test.pbg"
    pbg.write_text(json.dumps({"state": SIMPLE_STATE}))
    with open(pbg, "rb") as f:
        r = client.post("/api/import", files={"file": ("test.pbg", f, "application/json")})
    assert r.json()["ok"]
    r2 = client.get("/api/graph")
    assert len(r2.json()["nodes"]) == 3


# ── Node operations ──────────────────────────────────────────────────────────

def test_get_node(client):
    load_bigraph(SIMPLE_STATE)
    r = client.get("/api/node/A")
    assert r.json()["value"] == 1.0


def test_update_value(client):
    load_bigraph(SIMPLE_STATE)
    r = client.put("/api/node/A/value", json={"value": 99})
    assert r.json()["ok"]
    r2 = client.get("/api/node/A")
    assert r2.json()["value"] == 99


def test_delete_node(client):
    load_bigraph(SIMPLE_STATE)
    r = client.delete("/api/node/A")
    assert r.json()["ok"]
    r2 = client.get("/api/state")
    assert "A" not in r2.json()["state"]


# ── Add store / process ──────────────────────────────────────────────────────

def test_add_store(client):
    load_bigraph({})
    r = client.post("/api/store", json={"path": ["new_store"], "value": 5.0})
    assert r.json()["ok"]
    r2 = client.get("/api/state")
    assert r2.json()["state"]["new_store"] == 5.0


def test_add_process(client):
    load_bigraph({})
    r = client.post("/api/process", json={
        "path": ["my_proc"],
        "process_type": "process",
        "address": "local:MyProc",
        "inputs": {"x": ["a"]},
        "outputs": {"y": ["b"]},
    })
    assert r.json()["ok"]
    r2 = client.get("/api/state")
    proc = r2.json()["state"]["my_proc"]
    assert proc["address"] == "local:MyProc"


# ── Nest ─────────────────────────────────────────────────────────────────────

def test_nest(client):
    load_bigraph({"outer": {}, "inner": 1.0})
    r = client.post("/api/nest", json={
        "source_path": ["inner"],
        "target_parent": ["outer"],
    })
    assert r.json()["ok"]
    state = client.get("/api/state").json()["state"]
    assert "inner" not in state
    assert state["outer"]["inner"] == 1.0


def test_nest_cycle_prevention(client):
    load_bigraph({"a": {"b": {}}})
    r = client.post("/api/nest", json={
        "source_path": ["a"],
        "target_parent": ["a", "b"],
    })
    assert r.status_code == 400


# ── Rewire ───────────────────────────────────────────────────────────────────

def test_rewire(client):
    load_bigraph(SIMPLE_STATE)
    r = client.post("/api/rewire", json={
        "process_path": ["reaction"],
        "port_name": "substrate",
        "direction": "inputs",
        "new_target": ["B"],
    })
    assert r.json()["ok"]
    state = client.get("/api/state").json()["state"]
    assert state["reaction"]["inputs"]["substrate"] == ["B"]


# ── Library ──────────────────────────────────────────────────────────────────

def test_library_empty(client):
    r = client.get("/api/library")
    assert r.json()["files"] == []


def test_library_examples(client):
    sessions.add_example("test_ex", {"X": 1})
    r = client.get("/api/library")
    names = [f["name"] for f in r.json()["files"]]
    assert "test_ex" in names


def test_library_save_load(client):
    load_bigraph(SIMPLE_STATE)
    r = client.post("/api/library/save", json={"name": "my_save"})
    assert r.json()["ok"]

    # Load something else
    client.post("/api/load", json={"state": {"Z": 0}})
    assert client.get("/api/state").json()["state"] == {"Z": 0}

    # Load saved
    r2 = client.post("/api/library/load/my_save")
    assert r2.json()["ok"]
    state = client.get("/api/state").json()["state"]
    assert "A" in state
    assert "reaction" in state


def test_library_delete(client):
    load_bigraph(SIMPLE_STATE)
    client.post("/api/library/save", json={"name": "to_delete"})
    r = client.delete("/api/library/to_delete")
    assert r.json()["ok"]
    files = client.get("/api/library").json()["files"]
    assert all(f["name"] != "to_delete" for f in files)


# ── Session isolation ────────────────────────────────────────────────────────

def test_sessions_isolated():
    """Two separate clients get independent state."""
    load_bigraph(SIMPLE_STATE)

    client_a = TestClient(app, cookies={})
    client_b = TestClient(app, cookies={})

    # User A gets session
    r1 = client_a.get("/api/state")
    sid_a = r1.cookies.get("bgloom_sid")
    client_a.cookies.set("bgloom_sid", sid_a)

    # User A modifies
    client_a.put("/api/node/A/value", json={"value": 999})

    # User B gets a different session
    r2 = client_b.get("/api/state")
    sid_b = r2.cookies.get("bgloom_sid")

    assert sid_a != sid_b

    # User B has original value
    client_b.cookies.set("bgloom_sid", sid_b)
    assert client_b.get("/api/state").json()["state"]["A"] == 1.0

    # User A has modified value
    assert client_a.get("/api/state").json()["state"]["A"] == 999


# ── Core endpoints ───────────────────────────────────────────────────────────

def test_core_info(client):
    r = client.get("/api/core-info")
    data = r.json()
    assert "class" in data
    assert data["num_types"] > 0
    assert data["num_processes"] > 0


def test_registry(client):
    r = client.get("/api/registry")
    assert len(r.json()["processes"]) > 0


def test_process_source(client):
    r = client.get("/api/process-source/local:Composite")
    data = r.json()
    assert data["registered"]
    assert data["update_signature"] is not None
