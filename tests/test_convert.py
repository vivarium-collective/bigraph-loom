"""Tests for bigraph_loom.convert."""

import pytest
from bigraph_loom.convert import (
    bigraph_to_flow,
    is_process,
    normalize_address,
    resolve_wire,
    _parse_port_schema,
)


# ── Process detection ────────────────────────────────────────────────────────

def test_is_process_with_type():
    assert is_process({"_type": "process", "address": "local:X"})
    assert is_process({"_type": "step", "address": "local:X"})
    assert is_process({"_type": "composite", "address": "local:X"})


def test_is_process_structural():
    assert is_process({"address": "local:X", "inputs": {}, "outputs": {}})
    assert is_process({"address": {"protocol": "local", "data": "X"}, "inputs": {}})


def test_is_process_negative():
    assert not is_process({"value": 1.0})
    assert not is_process({"nested": {"store": 1}})
    assert not is_process("not a dict")
    assert not is_process(42)


# ── Address normalization ────────────────────────────────────────────────────

def test_normalize_string_address():
    assert normalize_address("local:Foo") == "local:Foo"


def test_normalize_dict_address():
    assert normalize_address({"protocol": "local", "data": "Foo"}) == "local:Foo"


# ── Wire resolution ─────────────────────────────────────────────────────────

def test_resolve_wire_simple():
    assert resolve_wire(("a", "b"), ["c"]) == ("a", "b", "c")


def test_resolve_wire_parent():
    assert resolve_wire(("a", "b"), ["..", "c"]) == ("a", "c")


def test_resolve_wire_root():
    assert resolve_wire(("a",), ["..", "x"]) == ("x",)


# ── Port schema parsing ─────────────────────────────────────────────────────

def test_parse_port_schema_string():
    result = _parse_port_schema("biomass:mass|substrates:map[concentration]")
    assert result == {"biomass": "mass", "substrates": "map[concentration]"}


def test_parse_port_schema_nested_brackets():
    result = _parse_port_schema("particles:map[id:string|position:tuple[float,float]]")
    assert result == {"particles": "map[id:string|position:tuple[float,float]]"}


def test_parse_port_schema_dict():
    assert _parse_port_schema({"a": "float"}) == {"a": "float"}


def test_parse_port_schema_empty():
    assert _parse_port_schema("") == {}
    assert _parse_port_schema({}) == {}
    assert _parse_port_schema(None) == {}


# ── Full conversion ──────────────────────────────────────────────────────────

def test_simple_bigraph():
    state = {
        "A": 1.0,
        "B": 0.0,
        "reaction": {
            "_type": "process",
            "address": "local:Reaction",
            "inputs": {"substrate": ["A"]},
            "outputs": {"product": ["B"]},
        },
    }
    result = bigraph_to_flow(state)
    nodes = result["nodes"]
    edges = result["edges"]

    assert len(nodes) == 3
    assert len([n for n in nodes if n["type"] == "process"]) == 1
    assert len([n for n in nodes if n["type"] == "store"]) == 2
    assert len(edges) == 2  # one input, one output wire


def test_nested_stores():
    state = {
        "cell": {
            "mass": 1.0,
            "volume": 2.0,
        }
    }
    result = bigraph_to_flow(state)
    nodes = result["nodes"]
    edges = result["edges"]

    ids = {n["id"] for n in nodes}
    assert "cell" in ids
    assert "cell/mass" in ids
    assert "cell/volume" in ids

    # Place edges from cell to children
    place_edges = [e for e in edges if e["data"]["edgeType"] == "place"]
    assert len(place_edges) == 2


def test_implicit_stores_created():
    """When state only has processes, stores referenced by wires are auto-created."""
    state = {
        "my_process": {
            "_type": "process",
            "address": "local:P",
            "inputs": {"x": ["store_a"]},
            "outputs": {"y": ["store_b"]},
        },
    }
    result = bigraph_to_flow(state)
    ids = {n["id"] for n in result["nodes"]}
    assert "store_a" in ids
    assert "store_b" in ids


def test_implicit_nested_stores():
    """Wire to 'unique/RNA' creates both 'unique' and 'unique/RNA'."""
    state = {
        "proc": {
            "_type": "process",
            "address": "local:P",
            "inputs": {"rna": ["unique", "RNA"]},
            "outputs": {},
        },
    }
    result = bigraph_to_flow(state)
    ids = {n["id"] for n in result["nodes"]}
    assert "unique" in ids
    assert "unique/RNA" in ids


def test_dict_address_format():
    state = {
        "proc": {
            "address": {"protocol": "local", "data": "MyProc"},
            "inputs": {"x": ["a"]},
            "outputs": {"y": ["b"]},
        },
    }
    result = bigraph_to_flow(state)
    proc = [n for n in result["nodes"] if n["type"] == "process"][0]
    assert proc["data"]["address"] == "local:MyProc"


def test_wire_data_in_nodes():
    state = {
        "A": 1.0,
        "proc": {
            "_type": "process",
            "address": "local:P",
            "inputs": {"x": ["A"]},
            "outputs": {"y": ["A"]},
        },
    }
    result = bigraph_to_flow(state)
    proc = [n for n in result["nodes"] if n["type"] == "process"][0]
    assert proc["data"]["inputWires"] == {"x": "A"}
    assert proc["data"]["outputWires"] == {"y": "A"}


def test_all_ports_shown():
    """Ports from both wires and _inputs/_outputs schema appear."""
    state = {
        "proc": {
            "_type": "process",
            "address": "local:P",
            "_inputs": "wired_port:float|unwired_port:int",
            "inputs": {"wired_port": ["a"]},
            "outputs": {},
        },
    }
    result = bigraph_to_flow(state)
    proc = [n for n in result["nodes"] if n["type"] == "process"][0]
    assert "wired_port" in proc["data"]["inputPorts"]
    assert "unwired_port" in proc["data"]["inputPorts"]
