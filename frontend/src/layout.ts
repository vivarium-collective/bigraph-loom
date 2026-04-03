import Dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";

/**
 * Hierarchical layout: uses only place edges to build a tree.
 * Stores form the tree (outers above inners). Processes go to the right.
 */
export function applyLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 50, ranksep: 70, marginx: 30, marginy: 30 });

  const processIds = new Set(
    nodes.filter((n) => n.type === "process").map((n) => n.id)
  );

  for (const n of nodes) {
    const w = n.type === "process" ? 140 : 80;
    const h = n.type === "process" ? 50 : 60;
    g.setNode(n.id, { width: w, height: h });
  }

  // Only use place edges for the tree layout — wire edges don't affect positioning
  for (const e of edges) {
    if ((e.data as any)?.edgeType === "place") {
      g.setEdge(e.source, e.target);
    }
  }

  Dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    if (!pos) return n;
    let x = pos.x - (pos.width ?? 0) / 2;
    const y = pos.y - (pos.height ?? 0) / 2;
    // Offset processes to the right so they don't overlap the store tree
    if (processIds.has(n.id)) x += 200;
    return { ...n, position: { x, y } };
  });
}

/**
 * Compact layout: tight grid, no hierarchy consideration.
 */
export function applyCompactLayout(nodes: Node[]): Node[] {
  const spacing = 100;
  const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  return nodes.map((n, i) => ({
    ...n,
    position: {
      x: (i % cols) * spacing,
      y: Math.floor(i / cols) * spacing,
    },
  }));
}
