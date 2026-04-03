import Dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";
import type { ViewMode } from "./api";

/**
 * Apply layout to nodes based on view mode.
 *
 * - "nested": dagre for root nodes, grid for children inside parents.
 * - "hierarchical": dagre for all nodes, stores top-down, processes offset to the side.
 */
export function applyLayout(
  nodes: Node[],
  edges: Edge[],
  view: ViewMode = "nested"
): Node[] {
  if (view === "hierarchical") {
    return applyHierarchicalLayout(nodes, edges);
  }
  return applyNestedLayout(nodes, edges);
}

function applyNestedLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 80, ranksep: 100, marginx: 40, marginy: 40 });

  const rootNodes = nodes.filter((n) => !n.parentId);
  const childrenByParent = new Map<string, Node[]>();

  for (const n of nodes) {
    if (n.parentId) {
      const list = childrenByParent.get(n.parentId) ?? [];
      list.push(n);
      childrenByParent.set(n.parentId, list);
    }
  }

  for (const n of rootNodes) {
    const w = n.type === "group" ? 280 : n.type === "process" ? 140 : 80;
    const h = n.type === "group" ? 240 : n.type === "process" ? 60 : 80;
    g.setNode(n.id, { width: w, height: h });
  }

  const rootIds = new Set(rootNodes.map((n) => n.id));
  for (const e of edges) {
    if (rootIds.has(e.source) && rootIds.has(e.target)) {
      g.setEdge(e.source, e.target);
    }
  }

  Dagre.layout(g);

  const positioned = nodes.map((n) => {
    const copy = { ...n, position: { ...n.position } };
    if (!n.parentId) {
      const pos = g.node(n.id);
      if (pos) {
        copy.position = {
          x: pos.x - (pos.width ?? 0) / 2,
          y: pos.y - (pos.height ?? 0) / 2,
        };
      }
    }
    return copy;
  });

  for (const [parentId, children] of childrenByParent) {
    const cols = Math.ceil(Math.sqrt(children.length));
    children.forEach((child, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const posNode = positioned.find((n) => n.id === child.id);
      if (posNode) {
        posNode.position = { x: 30 + col * 140, y: 40 + row * 120 };
      }
    });

    const parent = positioned.find((n) => n.id === parentId);
    if (parent && parent.style) {
      const rows = Math.ceil(children.length / cols);
      parent.style = {
        ...parent.style,
        width: Math.max(250, 30 + cols * 140 + 30),
        height: Math.max(200, 40 + rows * 120 + 30),
      };
    }
  }

  return positioned;
}

function applyHierarchicalLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 80, marginx: 40, marginy: 40 });

  // In hierarchical mode, all nodes are flat (no parentId).
  // Place edges create the tree structure.
  // We want stores in the main flow and processes offset to the right.
  const processIds = new Set(
    nodes.filter((n) => n.type === "process").map((n) => n.id)
  );

  for (const n of nodes) {
    const w = n.type === "process" ? 140 : 80;
    const h = n.type === "process" ? 60 : 80;
    g.setNode(n.id, { width: w, height: h });
  }

  // Add place edges and wire edges to dagre
  for (const e of edges) {
    g.setEdge(e.source, e.target);
  }

  Dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    const copy = { ...n, position: { ...n.position } };
    if (pos) {
      let x = pos.x - (pos.width ?? 0) / 2;
      const y = pos.y - (pos.height ?? 0) / 2;
      // Offset processes to the right for visual separation
      if (processIds.has(n.id)) {
        x += 180;
      }
      copy.position = { x, y };
    }
    return copy;
  });
}
