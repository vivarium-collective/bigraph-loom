"""Convert process-bigraph state dicts into React Flow nodes and edges."""

from __future__ import annotations

from typing import Any, Literal

PROCESS_TYPES = {"process", "edge", "step", "composite"}
PROCESS_SCHEMA_KEYS = {
    "config", "address", "interval", "inputs", "outputs",
    "instance", "bridge", "_type", "_inputs", "_outputs",
}

ViewMode = Literal["nested", "hierarchical"]


def path_to_id(path: tuple[str, ...]) -> str:
    return "/".join(path) if path else "__root__"


def is_process(value: Any) -> bool:
    return isinstance(value, dict) and value.get("_type") in PROCESS_TYPES


def resolve_wire(parent_path: tuple[str, ...], wire: list[str]) -> tuple[str, ...]:
    """Resolve a wire path relative to the process's parent location."""
    result = list(parent_path)
    for segment in wire:
        if segment == "..":
            if result:
                result.pop()
        else:
            result.append(segment)
    return tuple(result)


def bigraph_to_flow(
    state: dict,
    schema: dict | None = None,
    view: ViewMode = "nested",
    path: tuple[str, ...] = (),
    parent_id: str | None = None,
) -> dict[str, list[dict]]:
    """Convert a bigraph state dict to React Flow nodes and edges.

    Args:
        state: The bigraph state dict.
        schema: Optional schema dict.
        view: "nested" uses compound/parent nodes; "hierarchical" uses
              place edges with processes laid out to the side.
        path: Current traversal path (used internally for recursion).
        parent_id: Parent node id (used internally for recursion).

    Returns:
        ``{"nodes": [...], "edges": [...]}``.
    """
    nodes: list[dict] = []
    edges: list[dict] = []

    if not isinstance(state, dict):
        return {"nodes": nodes, "edges": edges}

    # In hierarchical mode, only the top-level call should have parent_id=None.
    # Children are NOT given parentId — instead we create place edges.
    use_parent = parent_id if view == "nested" else None

    for key, value in state.items():
        if key.startswith("_"):
            continue

        node_path = path + (key,)
        node_id = path_to_id(node_path)

        if is_process(value):
            _add_process_node(nodes, edges, key, value, node_path, node_id, use_parent)
            # In hierarchical mode, add a place edge from parent to process
            if view == "hierarchical" and parent_id:
                edges.append(_place_edge(parent_id, node_id))
        elif isinstance(value, dict):
            _add_group_or_store_node(
                nodes, edges, key, value, schema, node_path, node_id, use_parent, view
            )
            # In hierarchical mode, add a place edge from parent to this node
            if view == "hierarchical" and parent_id:
                edges.append(_place_edge(parent_id, node_id))
        else:
            _add_leaf_node(nodes, key, value, node_path, node_id, use_parent)
            # In hierarchical mode, add a place edge from parent to leaf
            if view == "hierarchical" and parent_id:
                edges.append(_place_edge(parent_id, node_id))

    return {"nodes": nodes, "edges": edges}


def _place_edge(parent_id: str, child_id: str) -> dict:
    """Create a place edge (solid, no animation) for hierarchical view."""
    return {
        "id": f"place-{parent_id}-{child_id}",
        "source": parent_id,
        "target": child_id,
        "type": "smoothstep",
        "animated": False,
        "data": {"edgeType": "place"},
        "style": {"stroke": "#94a3b8", "strokeWidth": 2},
    }


def _add_process_node(
    nodes: list[dict],
    edges: list[dict],
    key: str,
    value: dict,
    node_path: tuple[str, ...],
    node_id: str,
    parent_id: str | None,
) -> None:
    node: dict[str, Any] = {
        "id": node_id,
        "type": "process",
        "position": {"x": 0, "y": 0},
        "data": {
            "label": key,
            "nodeType": "process",
            "processType": value.get("_type", "process"),
            "address": value.get("address", ""),
            "config": value.get("config", {}),
            "interval": value.get("interval"),
            "path": list(node_path),
            "inputPorts": list(value.get("inputs", {}).keys()),
            "outputPorts": list(value.get("outputs", {}).keys()),
        },
    }
    if parent_id:
        node["parentId"] = parent_id
        node["extent"] = "parent"
    nodes.append(node)

    # Wire edges
    inputs = value.get("inputs", {})
    outputs = value.get("outputs", {})
    process_parent = node_path[:-1]

    for port_name, wire in inputs.items():
        if not isinstance(wire, list):
            continue
        target_path = resolve_wire(process_parent, wire)
        target_id = path_to_id(target_path)
        is_bidir = port_name in outputs and outputs[port_name] == wire
        edge_type = "bidirectional" if is_bidir else "input"
        edges.append({
            "id": f"e-{target_id}-{node_id}-{port_name}",
            "source": target_id,
            "target": node_id,
            "targetHandle": port_name,
            "label": port_name,
            "type": "smoothstep",
            "animated": True,
            "data": {"edgeType": edge_type, "port": port_name},
            "style": {"strokeDasharray": "6 3"},
        })

    for port_name, wire in outputs.items():
        if not isinstance(wire, list):
            continue
        if port_name in inputs and inputs[port_name] == wire:
            continue  # already added as bidirectional
        target_path = resolve_wire(process_parent, wire)
        target_id = path_to_id(target_path)
        edges.append({
            "id": f"e-{node_id}-{target_id}-{port_name}",
            "source": node_id,
            "sourceHandle": port_name,
            "target": target_id,
            "label": port_name,
            "type": "smoothstep",
            "animated": True,
            "data": {"edgeType": "output", "port": port_name},
            "style": {"strokeDasharray": "6 3"},
        })


def _add_group_or_store_node(
    nodes: list[dict],
    edges: list[dict],
    key: str,
    value: dict,
    schema: dict | None,
    node_path: tuple[str, ...],
    node_id: str,
    parent_id: str | None,
    view: ViewMode,
) -> None:
    """Add a dict node — as a compound group (nested) or a plain store (hierarchical)."""
    if view == "nested":
        # Compound group node that visually contains children
        node: dict[str, Any] = {
            "id": node_id,
            "type": "group",
            "position": {"x": 0, "y": 0},
            "data": {
                "label": key,
                "nodeType": "store",
                "isGroup": True,
                "path": list(node_path),
            },
            "style": {
                "width": 250,
                "height": 200,
            },
        }
        if parent_id:
            node["parentId"] = parent_id
            node["extent"] = "parent"
        nodes.append(node)

        child = bigraph_to_flow(value, schema=schema, view=view, path=node_path, parent_id=node_id)
        nodes.extend(child["nodes"])
        edges.extend(child["edges"])
    else:
        # Hierarchical: store node with place edges to children (no nesting)
        node = {
            "id": node_id,
            "type": "store",
            "position": {"x": 0, "y": 0},
            "data": {
                "label": key,
                "nodeType": "store",
                "isGroup": True,
                "path": list(node_path),
            },
        }
        nodes.append(node)

        child = bigraph_to_flow(value, schema=schema, view=view, path=node_path, parent_id=node_id)
        nodes.extend(child["nodes"])
        edges.extend(child["edges"])


def _add_leaf_node(
    nodes: list[dict],
    key: str,
    value: Any,
    node_path: tuple[str, ...],
    node_id: str,
    parent_id: str | None,
) -> None:
    node: dict[str, Any] = {
        "id": node_id,
        "type": "store",
        "position": {"x": 0, "y": 0},
        "data": {
            "label": key,
            "nodeType": "store",
            "value": _serialize_value(value),
            "valueType": type(value).__name__,
            "path": list(node_path),
        },
    }
    if parent_id:
        node["parentId"] = parent_id
        node["extent"] = "parent"
    nodes.append(node)


def _serialize_value(value: Any) -> Any:
    """Make a value JSON-serializable."""
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)
