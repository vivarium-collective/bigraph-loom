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
    """Detect whether a dict represents a process node.

    Handles multiple formats:
    - Explicit _type: ``{"_type": "process", ...}``
    - Structural: has ``address`` + (``inputs`` or ``outputs``)
    """
    if not isinstance(value, dict):
        return False
    # Explicit type marker
    if value.get("_type") in PROCESS_TYPES:
        return True
    # Structural detection: has an address and wiring
    if "address" in value and ("inputs" in value or "outputs" in value):
        return True
    return False


def normalize_address(address: Any) -> str:
    """Normalize address to a string like 'local:ClassName'.

    Handles:
    - String: ``"local:Foo"`` → ``"local:Foo"``
    - Dict: ``{"protocol": "local", "data": "Foo"}`` → ``"local:Foo"``
    """
    if isinstance(address, str):
        return address
    if isinstance(address, dict):
        protocol = address.get("protocol", "local")
        data = address.get("data", "")
        return f"{protocol}:{data}"
    return str(address)


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

    # In hierarchical mode, children are NOT given parentId — instead we create place edges.
    use_parent = parent_id if view == "nested" else None

    for key, value in state.items():
        if key.startswith("_"):
            continue

        node_path = path + (key,)
        node_id = path_to_id(node_path)

        if is_process(value):
            _add_process_node(nodes, edges, key, value, node_path, node_id, use_parent)
            if view == "hierarchical" and parent_id:
                edges.append(_place_edge(parent_id, node_id))
        elif isinstance(value, dict):
            _add_group_or_store_node(
                nodes, edges, key, value, schema, node_path, node_id, use_parent, view
            )
            if view == "hierarchical" and parent_id:
                edges.append(_place_edge(parent_id, node_id))
        else:
            _add_leaf_node(nodes, key, value, node_path, node_id, use_parent)
            if view == "hierarchical" and parent_id:
                edges.append(_place_edge(parent_id, node_id))

    # Auto-create implicit store nodes for wire targets that don't have a node yet.
    # This handles state dicts that only contain processes (no explicit stores).
    if not parent_id:  # only at top level
        _add_implicit_stores(nodes, edges, view)

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
    address = normalize_address(value.get("address", ""))
    process_type = value.get("_type", "process")

    # Extract port schemas from _inputs/_outputs if present
    input_ports_schema = _parse_port_schema(value.get("_inputs", {}))
    output_ports_schema = _parse_port_schema(value.get("_outputs", {}))

    node: dict[str, Any] = {
        "id": node_id,
        "type": "process",
        "position": {"x": 0, "y": 0},
        "data": {
            "label": key,
            "nodeType": "process",
            "processType": process_type,
            "address": address,
            "config": value.get("config", {}),
            "interval": value.get("interval"),
            "path": list(node_path),
            "inputPorts": list(value.get("inputs", {}).keys()),
            "outputPorts": list(value.get("outputs", {}).keys()),
            "inputPortsSchema": _safe_serialize(input_ports_schema),
            "outputPortsSchema": _safe_serialize(output_ports_schema),
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
        edges.append({
            "id": f"e-{target_id}-{node_id}-in-{port_name}",
            "source": target_id,
            "target": node_id,
            "targetHandle": port_name,
            "label": port_name,
            "type": "smoothstep",
            "animated": True,
            "data": {"edgeType": "input", "port": port_name},
            "style": {"strokeDasharray": "6 3"},
        })

    for port_name, wire in outputs.items():
        if not isinstance(wire, list):
            continue
        target_path = resolve_wire(process_parent, wire)
        target_id = path_to_id(target_path)
        edges.append({
            "id": f"e-{node_id}-{target_id}-out-{port_name}",
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


def _add_implicit_stores(
    nodes: list[dict],
    edges: list[dict],
    view: ViewMode,
) -> None:
    """Create store nodes for wire targets that don't have an explicit node."""
    existing_ids = {n["id"] for n in nodes}

    # Collect all edge source/target IDs that reference missing nodes
    missing_ids: dict[str, str] = {}  # id -> label
    for edge in edges:
        for endpoint in (edge["source"], edge["target"]):
            if endpoint and endpoint not in existing_ids and endpoint not in missing_ids:
                # Derive the label from the last path segment
                parts = endpoint.split("/")
                missing_ids[endpoint] = parts[-1]

    # Also check for parent paths: if edge targets "unique/RNA",
    # we need both "unique" and "unique/RNA"
    extra_missing: dict[str, str] = {}
    for node_id in list(missing_ids.keys()):
        parts = node_id.split("/")
        for i in range(1, len(parts)):
            ancestor_id = "/".join(parts[:i])
            if ancestor_id not in existing_ids and ancestor_id not in missing_ids:
                extra_missing[ancestor_id] = parts[i - 1]
    missing_ids.update(extra_missing)

    for node_id, label in missing_ids.items():
        parts = node_id.split("/")
        # Determine if this has children among the missing set
        has_children = any(
            mid.startswith(node_id + "/") for mid in missing_ids if mid != node_id
        )
        has_children = has_children or any(
            nid.startswith(node_id + "/") for nid in existing_ids
        )

        if has_children and view == "nested":
            node: dict[str, Any] = {
                "id": node_id,
                "type": "group",
                "position": {"x": 0, "y": 0},
                "data": {
                    "label": label,
                    "nodeType": "store",
                    "isGroup": True,
                    "implicit": True,
                    "path": parts,
                },
                "style": {"width": 250, "height": 200},
            }
            # Set parent if ancestor exists
            if len(parts) > 1:
                parent_id = "/".join(parts[:-1])
                if parent_id in existing_ids or parent_id in missing_ids:
                    node["parentId"] = parent_id
                    node["extent"] = "parent"
        else:
            node = {
                "id": node_id,
                "type": "store",
                "position": {"x": 0, "y": 0},
                "data": {
                    "label": label,
                    "nodeType": "store",
                    "implicit": True,
                    "isGroup": has_children,
                    "path": parts,
                },
            }

        existing_ids.add(node_id)
        nodes.append(node)

        # In hierarchical mode, add place edges for parent-child relationships
        if view == "hierarchical" and len(parts) > 1:
            parent_id = "/".join(parts[:-1])
            if parent_id in existing_ids or parent_id in missing_ids:
                edges.append(_place_edge(parent_id, node_id))


def _parse_port_schema(schema: Any) -> dict:
    """Parse a port schema into a {port_name: type_string} dict.

    Handles:
    - Dict: ``{"biomass": "mass", "substrates": "map[concentration]"}`` → as-is
    - String: ``"biomass:mass|substrates:map[concentration]"`` → parsed to dict
    - Other: returned as empty dict
    """
    if isinstance(schema, dict):
        return schema
    if isinstance(schema, str) and schema:
        result: dict[str, str] = {}
        # Split on | but not inside brackets
        depth = 0
        current = ""
        for ch in schema:
            if ch in "([":
                depth += 1
                current += ch
            elif ch in ")]":
                depth -= 1
                current += ch
            elif ch == "|" and depth == 0:
                _parse_port_entry(current.strip(), result)
                current = ""
            else:
                current += ch
        if current.strip():
            _parse_port_entry(current.strip(), result)
        return result
    return {}


def _parse_port_entry(entry: str, result: dict) -> None:
    """Parse a single 'name:type' entry into result dict."""
    # Find the first colon not inside brackets
    depth = 0
    for i, ch in enumerate(entry):
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        elif ch == ":" and depth == 0:
            name = entry[:i].strip()
            type_str = entry[i + 1:].strip()
            if name:
                result[name] = type_str
            return
    # No colon found — just a name with no type
    if entry:
        result[entry] = ""


def _serialize_value(value: Any) -> Any:
    """Make a value JSON-serializable."""
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, (list, tuple)) and len(value) <= 5:
        return [_serialize_value(v) for v in value]
    if isinstance(value, (list, tuple)):
        return f"[{len(value)} items]"
    return str(value)


def _safe_serialize(obj: Any) -> Any:
    """Convert an object to JSON-safe form."""
    if isinstance(obj, dict):
        return {str(k): _safe_serialize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_safe_serialize(v) for v in obj]
    if isinstance(obj, (str, int, float, bool)) or obj is None:
        return obj
    return str(obj)
