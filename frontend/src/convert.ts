import type { Node, Edge } from "@xyflow/react";

export const PROCESS_TYPES = new Set(["process", "edge", "step", "composite"]);

export type AnyDict = Record<string, unknown>;

/**
 * Serialize a path array into a slash-separated node ID.
 */
export function pathToId(path: string[]): string {
  return path.length > 0 ? path.join("/") : "__root__";
}

/**
 * Detect whether a value represents a process node.
 */
export function isProcess(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const d = value as AnyDict;
  if (typeof d._type === "string" && PROCESS_TYPES.has(d._type)) return true;
  if ("address" in d && ("inputs" in d || "outputs" in d)) return true;
  return false;
}

/**
 * Normalize a process address to "protocol:name" form.
 */
export function normalizeAddress(address: unknown): string {
  if (typeof address === "string") return address;
  if (typeof address === "object" && address !== null) {
    const d = address as AnyDict;
    const protocol = typeof d.protocol === "string" ? d.protocol : "local";
    const data = typeof d.data === "string" ? d.data : "";
    return `${protocol}:${data}`;
  }
  return String(address);
}

/**
 * Resolve a relative wire path against a parent path.
 * E.g. resolveWire(["a", "b"], ["..", "mass"]) => ["a", "mass"]
 */
export function resolveWire(parentPath: string[], wire: string[]): string[] {
  const result = [...parentPath];
  for (const segment of wire) {
    if (segment === "..") {
      result.pop();
    } else {
      result.push(segment);
    }
  }
  return result;
}

/**
 * Parse a port schema string into a key/value map.
 * E.g. "biomass:mass|substrates:map[concentration]" => {biomass: "mass", substrates: "map[concentration]"}
 */
export function parsePortSchema(schema: unknown): Record<string, string> {
  if (typeof schema === "object" && schema !== null && !Array.isArray(schema)) {
    return schema as Record<string, string>;
  }
  if (typeof schema === "string" && schema.length > 0) {
    const result: Record<string, string> = {};
    let depth = 0;
    let current = "";
    for (const ch of schema) {
      if (ch === "(" || ch === "[") {
        depth++;
        current += ch;
      } else if (ch === ")" || ch === "]") {
        depth--;
        current += ch;
      } else if (ch === "|" && depth === 0) {
        parsePortEntry(current.trim(), result);
        current = "";
      } else {
        current += ch;
      }
    }
    if (current.trim()) {
      parsePortEntry(current.trim(), result);
    }
    return result;
  }
  return {};
}

function parsePortEntry(entry: string, result: Record<string, string>): void {
  let depth = 0;
  for (let i = 0; i < entry.length; i++) {
    const ch = entry[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === ":" && depth === 0) {
      const name = entry.slice(0, i).trim();
      const typeStr = entry.slice(i + 1).trim();
      if (name) result[name] = typeStr;
      return;
    }
  }
  if (entry) result[entry] = "";
}

/**
 * Serialize a store value for display.
 */
export function serializeValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value) && value.length <= 5) {
    return value.map(serializeValue);
  }
  if (Array.isArray(value)) {
    return `[${value.length} items]`;
  }
  return String(value).slice(0, 100);
}

/**
 * Lightweight config summary — scalar values only.
 */
export function summarizeConfig(config: unknown): Record<string, unknown> {
  if (typeof config !== "object" || config === null || Array.isArray(config)) return {};
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      result[k] = v;
    } else if (typeof v === "object" && !Array.isArray(v)) {
      result[k] = `{${Object.keys(v as AnyDict).length} keys}`;
    } else if (Array.isArray(v)) {
      result[k] = `[${v.length} items]`;
    } else {
      result[k] = String(v).slice(0, 50);
    }
  }
  return result;
}

function safeSerialize(obj: unknown): unknown {
  if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[String(k)] = safeSerialize(v);
    }
    return result;
  }
  if (Array.isArray(obj)) {
    return obj.map(safeSerialize);
  }
  if (obj === null || typeof obj === "string" || typeof obj === "number" || typeof obj === "boolean") {
    return obj;
  }
  return String(obj);
}

function placeEdge(parentId: string, childId: string): Edge {
  return {
    id: `place-${parentId}-${childId}`,
    source: parentId,
    target: childId,
    type: "straight",
    animated: false,
    data: { edgeType: "place" },
    style: { stroke: "#94a3b8", strokeWidth: 2 },
  };
}

/**
 * Data for a React Flow node produced by bigraphToFlow.
 */
export interface FlowNodeData {
  label: string;
  nodeType: "process" | "store";
  path: string[];
  processType?: string;
  address?: string;
  config?: Record<string, unknown>;
  interval?: number;
  inputPorts?: string[];
  outputPorts?: string[];
  inputPortsSchema?: Record<string, string>;
  outputPortsSchema?: Record<string, string>;
  inputWires?: Record<string, string>;
  outputWires?: Record<string, string>;
  value?: unknown;
  valueType?: string;
  isGroup?: boolean;
  implicit?: boolean;
  isCollapsed?: boolean;
  [key: string]: unknown;
}

/**
 * The result of a bigraph-to-flow conversion.
 */
export interface FlowGraph {
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
}

function addProcessNode(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  key: string,
  value: AnyDict,
  nodePath: string[],
  nodeId: string,
): void {
  const address = normalizeAddress(value.address);
  const processType = typeof value._type === "string" ? value._type : "process";
  const inputPortsSchema = parsePortSchema(value._inputs);
  const outputPortsSchema = parsePortSchema(value._outputs);

  const inputs = typeof value.inputs === "object" && value.inputs !== null
    ? (value.inputs as AnyDict)
    : {};
  const outputs = typeof value.outputs === "object" && value.outputs !== null
    ? (value.outputs as AnyDict)
    : {};

  const allInputPorts = [...new Set([
    ...Object.keys(inputs),
    ...Object.keys(inputPortsSchema),
  ])];
  const allOutputPorts = [...new Set([
    ...Object.keys(outputs),
    ...Object.keys(outputPortsSchema),
  ])];

  const inputWires: Record<string, string> = {};
  for (const [port, wire] of Object.entries(inputs)) {
    inputWires[port] = Array.isArray(wire) ? wire.join("/") : String(wire);
  }
  const outputWires: Record<string, string> = {};
  for (const [port, wire] of Object.entries(outputs)) {
    outputWires[port] = Array.isArray(wire) ? wire.join("/") : String(wire);
  }

  nodes.push({
    id: nodeId,
    type: "process",
    position: { x: 0, y: 0 },
    data: {
      label: key,
      nodeType: "process",
      processType,
      address,
      config: summarizeConfig(value.config),
      interval: typeof value.interval === "number" ? value.interval : undefined,
      path: nodePath,
      inputPorts: allInputPorts,
      outputPorts: allOutputPorts,
      inputPortsSchema: safeSerialize(inputPortsSchema) as Record<string, string>,
      outputPortsSchema: safeSerialize(outputPortsSchema) as Record<string, string>,
      inputWires,
      outputWires,
    },
  });

  const processParent = nodePath.slice(0, -1);

  for (const [portName, wire] of Object.entries(inputs)) {
    if (!Array.isArray(wire)) continue;
    const targetPath = resolveWire(processParent, wire);
    const targetId = pathToId(targetPath);
    edges.push({
      id: `e-${targetId}-${nodeId}-in-${portName}`,
      source: targetId,
      target: nodeId,
      targetHandle: portName,
      type: "straight",
      animated: false,
      data: { edgeType: "input", port: portName },
      style: { strokeDasharray: "6 3" },
    });
  }

  for (const [portName, wire] of Object.entries(outputs)) {
    if (!Array.isArray(wire)) continue;
    const targetPath = resolveWire(processParent, wire);
    const targetId = pathToId(targetPath);
    edges.push({
      id: `e-${nodeId}-${targetId}-out-${portName}`,
      source: nodeId,
      sourceHandle: portName,
      target: targetId,
      type: "straight",
      animated: false,
      data: { edgeType: "output", port: portName },
      style: { strokeDasharray: "6 3" },
    });
  }
}

function addStoreNode(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  key: string,
  value: AnyDict,
  _schema: unknown,
  nodePath: string[],
  nodeId: string,
): void {
  nodes.push({
    id: nodeId,
    type: "store",
    position: { x: 0, y: 0 },
    data: {
      label: key,
      nodeType: "store",
      isGroup: true,
      path: nodePath,
    },
  });
  const child = bigraphToFlow(value, _schema, nodePath, nodeId);
  nodes.push(...child.nodes);
  edges.push(...child.edges);
}

function addLeafNode(
  nodes: Node<FlowNodeData>[],
  key: string,
  value: unknown,
  nodePath: string[],
  nodeId: string,
): void {
  nodes.push({
    id: nodeId,
    type: "store",
    position: { x: 0, y: 0 },
    data: {
      label: key,
      nodeType: "store",
      value: serializeValue(value),
      valueType: value === null ? "null" : Array.isArray(value) ? "list" : typeof value,
      path: nodePath,
    },
  });
}

function addImplicitStores(nodes: Node<FlowNodeData>[], edges: Edge[]): void {
  const existingIds = new Set(nodes.map((n) => n.id));

  const missingIds: Record<string, string> = {};
  for (const edge of edges) {
    for (const endpoint of [edge.source, edge.target]) {
      if (endpoint && !existingIds.has(endpoint) && !(endpoint in missingIds)) {
        const parts = endpoint.split("/");
        missingIds[endpoint] = parts[parts.length - 1];
      }
    }
  }

  const extraMissing: Record<string, string> = {};
  for (const nodeId of Object.keys(missingIds)) {
    const parts = nodeId.split("/");
    for (let i = 1; i < parts.length; i++) {
      const ancestorId = parts.slice(0, i).join("/");
      if (!existingIds.has(ancestorId) && !(ancestorId in missingIds)) {
        extraMissing[ancestorId] = parts[i - 1];
      }
    }
  }
  Object.assign(missingIds, extraMissing);

  for (const [nodeId, label] of Object.entries(missingIds)) {
    const parts = nodeId.split("/");
    const hasChildren = Object.keys(missingIds).some(
      (mid) => mid !== nodeId && mid.startsWith(nodeId + "/")
    ) || [...existingIds].some(
      (eid) => eid.startsWith(nodeId + "/")
    );

    nodes.push({
      id: nodeId,
      type: "store",
      position: { x: 0, y: 0 },
      data: {
        label,
        nodeType: "store",
        implicit: true,
        isGroup: hasChildren,
        path: parts,
      },
    });
    existingIds.add(nodeId);

    if (parts.length > 1) {
      const parentId = parts.slice(0, -1).join("/");
      if (existingIds.has(parentId) || parentId in missingIds) {
        edges.push(placeEdge(parentId, nodeId));
      }
    }
  }
}

/**
 * Convert a bigraph state dict into React Flow nodes and edges.
 *
 * All nodes are flat (no parentId). Hierarchy is represented by place edges.
 * @param state The bigraph state dict.
 * @param schema Optional schema (currently unused, kept for API compatibility).
 * @param path Current path in the state tree (used internally for recursion).
 * @param parentId Parent node ID for place edges (used internally for recursion).
 */
export function bigraphToFlow(
  state: AnyDict,
  schema?: unknown,
  path: string[] = [],
  parentId: string | null = null,
): FlowGraph {
  const nodes: Node<FlowNodeData>[] = [];
  const edges: Edge[] = [];

  for (const [key, value] of Object.entries(state)) {
    if (key.startsWith("_")) continue;

    const nodePath = [...path, key];
    const nodeId = pathToId(nodePath);

    if (isProcess(value)) {
      addProcessNode(nodes, edges, key, value as AnyDict, nodePath, nodeId);
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      addStoreNode(nodes, edges, key, value as AnyDict, schema, nodePath, nodeId);
    } else {
      addLeafNode(nodes, key, value, nodePath, nodeId);
    }

    if (parentId) {
      edges.push(placeEdge(parentId, nodeId));
    }
  }

  if (!parentId) {
    addImplicitStores(nodes, edges);
  }

  return { nodes, edges };
}
