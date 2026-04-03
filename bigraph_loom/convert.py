"""Convert process-bigraph state dicts into React Flow nodes and edges."""

from __future__ import annotations

from typing import Any

PROCESS_TYPES = {"process", "edge", "step", "composite"}


def path_to_id(path: tuple[str, ...]) -> str:
    return "/".join(path) if path else "__root__"


def is_process(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    if value.get("_type") in PROCESS_TYPES:
        return True
    if "address" in value and ("inputs" in value or "outputs" in value):
        return True
    return False


def normalize_address(address: Any) -> str:
    if isinstance(address, str):
        return address
    if isinstance(address, dict):
        protocol = address.get("protocol", "local")
        data = address.get("data", "")
        return f"{protocol}:{data}"
    return str(address)


def resolve_wire(parent_path: tuple[str, ...], wire: list[str]) -> tuple[str, ...]:
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
    core: object | None = None,
    path: tuple[str, ...] = (),
    parent_id: str | None = None,
) -> dict[str, list[dict]]:
    """Convert a bigraph state dict to React Flow nodes and edges.

    All nodes are flat (no parentId). Hierarchy is represented by place edges.
    """
    nodes: list[dict] = []
    edges: list[dict] = []

    if not isinstance(state, dict):
        return {"nodes": nodes, "edges": edges}

    for key, value in state.items():
        if key.startswith("_"):
            continue

        node_path = path + (key,)
        node_id = path_to_id(node_path)

        if is_process(value):
            _add_process_node(nodes, edges, key, value, node_path, node_id, core)
        elif isinstance(value, dict):
            _add_store_node(nodes, edges, key, value, schema, core, node_path, node_id)
        else:
            _add_leaf_node(nodes, key, value, node_path, node_id)

        if parent_id:
            edges.append(_place_edge(parent_id, node_id))

    if not parent_id:
        _add_implicit_stores(nodes, edges)

    return {"nodes": nodes, "edges": edges}


def _place_edge(parent_id: str, child_id: str) -> dict:
    return {
        "id": f"place-{parent_id}-{child_id}",
        "source": parent_id,
        "target": child_id,
        "type": "straight",
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
    core: object | None = None,
) -> None:
    address = normalize_address(value.get("address", ""))
    process_type = value.get("_type", "process")
    input_ports_schema = _parse_port_schema(value.get("_inputs", {}))
    output_ports_schema = _parse_port_schema(value.get("_outputs", {}))

    # If no port schema from state, try the Core registry
    if not input_ports_schema and not output_ports_schema and core is not None:
        name = address.split(":", 1)[-1] if ":" in address else address
        try:
            cls = core.link_registry[name]
            instance = cls({}, core=core)
            for port, ptype in instance.inputs().items():
                input_ports_schema.setdefault(port, str(ptype))
            for port, ptype in instance.outputs().items():
                output_ports_schema.setdefault(port, str(ptype))
        except Exception:
            pass

    inputs = value.get("inputs", {})
    outputs = value.get("outputs", {})

    # Merge port names from wires and schema so unwired ports are also shown
    all_input_ports = list(dict.fromkeys(
        list(inputs.keys()) + list(input_ports_schema.keys())
    ))
    all_output_ports = list(dict.fromkeys(
        list(outputs.keys()) + list(output_ports_schema.keys())
    ))

    # Wire targets as serializable dicts {port: "path/segments"}
    input_wires = {p: "/".join(w) if isinstance(w, list) else str(w) for p, w in inputs.items()}
    output_wires = {p: "/".join(w) if isinstance(w, list) else str(w) for p, w in outputs.items()}

    nodes.append({
        "id": node_id,
        "type": "process",
        "position": {"x": 0, "y": 0},
        "data": {
            "label": key,
            "nodeType": "process",
            "processType": process_type,
            "address": address,
            "config": _summarize_config(value.get("config", {})),
            "interval": value.get("interval"),
            "path": list(node_path),
            "inputPorts": all_input_ports,
            "outputPorts": all_output_ports,
            "inputPortsSchema": _safe_serialize(input_ports_schema),
            "outputPortsSchema": _safe_serialize(output_ports_schema),
            "inputWires": input_wires,
            "outputWires": output_wires,
        },
    })

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
            "type": "straight",
            "animated": False,
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
            "type": "straight",
            "animated": False,
            "data": {"edgeType": "output", "port": port_name},
            "style": {"strokeDasharray": "6 3"},
        })


def _add_store_node(
    nodes: list[dict],
    edges: list[dict],
    key: str,
    value: dict,
    schema: dict | None,
    core: object | None,
    node_path: tuple[str, ...],
    node_id: str,
) -> None:
    nodes.append({
        "id": node_id,
        "type": "store",
        "position": {"x": 0, "y": 0},
        "data": {
            "label": key,
            "nodeType": "store",
            "isGroup": True,
            "path": list(node_path),
        },
    })
    child = bigraph_to_flow(value, schema=schema, core=core, path=node_path, parent_id=node_id)
    nodes.extend(child["nodes"])
    edges.extend(child["edges"])


def _add_leaf_node(
    nodes: list[dict],
    key: str,
    value: Any,
    node_path: tuple[str, ...],
    node_id: str,
) -> None:
    nodes.append({
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
    })


def _add_implicit_stores(nodes: list[dict], edges: list[dict]) -> None:
    existing_ids = {n["id"] for n in nodes}

    missing_ids: dict[str, str] = {}
    for edge in edges:
        for endpoint in (edge["source"], edge["target"]):
            if endpoint and endpoint not in existing_ids and endpoint not in missing_ids:
                parts = endpoint.split("/")
                missing_ids[endpoint] = parts[-1]

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
        has_children = any(
            mid.startswith(node_id + "/") for mid in missing_ids if mid != node_id
        ) or any(
            nid.startswith(node_id + "/") for nid in existing_ids
        )

        nodes.append({
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
        })
        existing_ids.add(node_id)

        if len(parts) > 1:
            parent_id = "/".join(parts[:-1])
            if parent_id in existing_ids or parent_id in missing_ids:
                edges.append(_place_edge(parent_id, node_id))


def _parse_port_schema(schema: Any) -> dict:
    if isinstance(schema, dict):
        return schema
    if isinstance(schema, str) and schema:
        result: dict[str, str] = {}
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
    if entry:
        result[entry] = ""


def _summarize_config(config: Any) -> dict:
    """Return a lightweight summary of config — keys and scalar values only."""
    if not isinstance(config, dict):
        return {}
    result = {}
    for k, v in config.items():
        if isinstance(v, (str, int, float, bool)) or v is None:
            result[k] = v
        elif isinstance(v, dict):
            result[k] = f"{{{len(v)} keys}}"
        elif isinstance(v, (list, tuple)):
            result[k] = f"[{len(v)} items]"
        else:
            result[k] = str(v)[:50]
    return result


def _serialize_value(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, (list, tuple)) and len(value) <= 5:
        return [_serialize_value(v) for v in value]
    if isinstance(value, (list, tuple)):
        return f"[{len(value)} items]"
    return str(value)[:100]


def _safe_serialize(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {str(k): _safe_serialize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_safe_serialize(v) for v in obj]
    if isinstance(obj, (str, int, float, bool)) or obj is None:
        return obj
    return str(obj)
