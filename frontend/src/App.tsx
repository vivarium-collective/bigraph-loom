import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import StoreNode from "./nodes/StoreNode";
import ProcessNode from "./nodes/ProcessNode";
import InspectorPanel from "./panels/InspectorPanel";
import LibraryPanel from "./panels/LibraryPanel";
import ProcessListPanel from "./panels/ProcessListPanel";
import {
  fetchGraph,
  exportPbg,
  importPbgFile,
  type ViewState,
  type ImportWarning,
  type GraphResponse,
} from "./api";
import { applyLayout, applyCompactLayout } from "./layout";
import "./App.css";

const JsonPanel = lazy(() => import("./panels/JsonPanel"));

const nodeTypes = { store: StoreNode, process: ProcessNode };

type SidePanel = "inspect" | "json" | "library" | "processes";

function AppInner() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [hiddenNodes, setHiddenNodes] = useState<Set<string>>(new Set());
  const [sidePanel, setSidePanel] = useState<SidePanel>("inspect");
  const [importWarnings, setImportWarnings] = useState<ImportWarning[]>([]);

  const cachedGraph = useRef<GraphResponse | null>(null);
  const cachedLayout = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const pendingViewState = useRef<ViewState | null>(null);
  const selectedNodeRef = useRef<Node | null>(null);
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const hiddenRef = useRef(hiddenNodes);
  hiddenRef.current = hiddenNodes;

  const reactFlow = useReactFlow();

  // ── Build parent→children map from place edges (stable across filters) ──
  const placeChildrenRef = useRef(new Map<string, string[]>());

  // ── Fetch graph data ──────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    const data = await fetchGraph();
    cachedGraph.current = data;
    cachedLayout.current = null;

    // Build place-children map once
    const map = new Map<string, string[]>();
    for (const e of data.edges) {
      if (e.data?.edgeType === "place") {
        const list = map.get(e.source) ?? [];
        list.push(e.target);
        map.set(e.source, list);
      }
    }
    placeChildrenRef.current = map;

    return data;
  }, []);

  // ── Compute layout ────────────────────────────────────────────────────
  const computeLayout = useCallback(
    (data: GraphResponse): { nodes: Node[]; edges: Edge[] } => {
      if (cachedLayout.current && cachedLayout.current.nodes.length > 0) {
        return cachedLayout.current;
      }

      const allNodes = data.nodes as unknown as Node[];
      const allEdges = data.edges as unknown as Edge[];
      let laid = applyLayout(allNodes, allEdges);

      const vs = pendingViewState.current;
      if (vs?.positions && Object.keys(vs.positions).length > 0) {
        laid = laid.map((n) => {
          const copy = { ...n };
          const savedPos = vs.positions[n.id];
          if (savedPos) copy.position = { x: savedPos.x, y: savedPos.y };
          const savedStyle = vs.styles?.[n.id];
          if (savedStyle) copy.style = { ...copy.style, ...savedStyle };
          return copy;
        });
        if (vs.zoom != null || vs.panX != null) {
          setTimeout(() => {
            reactFlow.setViewport({ x: vs.panX ?? 0, y: vs.panY ?? 0, zoom: vs.zoom ?? 1 });
          }, 50);
        }
        pendingViewState.current = null;
      }

      cachedLayout.current = { nodes: laid, edges: allEdges };
      return cachedLayout.current;
    },
    [reactFlow]
  );

  // ── Get all descendants of a set of node IDs ──────────────────────────
  const getDescendants = useCallback((ids: Iterable<string>): Set<string> => {
    const desc = new Set<string>();
    const queue = [...ids];
    while (queue.length) {
      const id = queue.shift()!;
      for (const child of placeChildrenRef.current.get(id) ?? []) {
        if (!desc.has(child)) {
          desc.add(child);
          queue.push(child);
        }
      }
    }
    return desc;
  }, []);

  // ── Apply visibility filter (no re-fetch, no re-layout) ──────────────
  const applyFilter = useCallback(
    (allNodes: Node[], allEdges: Edge[]) => {
      const currentCollapsed = collapsedRef.current;
      const currentHidden = hiddenRef.current;

      // Expand hidden set to include all descendants of hidden nodes
      const hiddenWithDescendants = new Set(currentHidden);
      for (const id of currentHidden) {
        for (const desc of getDescendants([id])) {
          hiddenWithDescendants.add(desc);
        }
      }

      // Expand collapsed set to hide all descendants
      const collapsedDescendants = getDescendants(currentCollapsed);

      let visibleNodes = allNodes.filter(
        (n) => !hiddenWithDescendants.has(n.id) && !collapsedDescendants.has(n.id)
      );

      const visibleIds = new Set(visibleNodes.map((n) => n.id));
      let visibleEdges = allEdges.filter(
        (e) => visibleIds.has(e.source) && visibleIds.has(e.target)
      );

      // For large graphs, always show place edges but limit wire edges
      const placeEdges = visibleEdges.filter((e) => (e.data as any)?.edgeType === "place");
      const wireEdges = visibleEdges.filter((e) => (e.data as any)?.edgeType !== "place");
      const WIRE_LIMIT = 200;
      if (wireEdges.length > WIRE_LIMIT) {
        const sel = selectedNodeRef.current;
        const filteredWires = sel
          ? wireEdges.filter((e) => e.source === sel.id || e.target === sel.id)
          : [];
        visibleEdges = [...placeEdges, ...filteredWires];
      }

      const marked = visibleNodes.map((n) =>
        currentCollapsed.has(n.id)
          ? { ...n, data: { ...n.data, isCollapsed: true } }
          : n
      );

      setNodes(marked);
      setEdges(visibleEdges);
    },
    [setNodes, setEdges, getDescendants]
  );

  // ── Full reload ───────────────────────────────────────────────────────
  const loadGraph = useCallback(async () => {
    try {
      const data = await fetchData();
      const { nodes: laid, edges: allEdges } = computeLayout(data);
      applyFilter(laid, allEdges);
    } catch (err) {
      console.error("Failed to load graph:", err);
    }
  }, [fetchData, computeLayout, applyFilter]);

  useEffect(() => { loadGraph(); }, [loadGraph]);

  // Re-filter when collapsed/hidden change
  useEffect(() => {
    if (!cachedLayout.current) return;
    applyFilter(cachedLayout.current.nodes, cachedLayout.current.edges);
  }, [collapsed, hiddenNodes, applyFilter]);

  // ── Sync positions to cache ───────────────────────────────────────────
  const syncPositionsToCache = useCallback(() => {
    if (!cachedLayout.current) return;
    const currentNodes = reactFlow.getNodes();
    const posMap = new Map(currentNodes.map((n) => [n.id, n.position]));
    cachedLayout.current.nodes = cachedLayout.current.nodes.map((n) => {
      const pos = posMap.get(n.id);
      return pos ? { ...n, position: pos } : n;
    });
  }, [reactFlow]);

  // ── View state ────────────────────────────────────────────────────────
  const getViewState = useCallback((): ViewState => {
    const positions: Record<string, { x: number; y: number }> = {};
    const styles: Record<string, Record<string, unknown>> = {};
    for (const n of nodes) {
      positions[n.id] = { x: n.position.x, y: n.position.y };
      if (n.style && (n.style.width || n.style.height)) {
        styles[n.id] = { width: n.style.width, height: n.style.height };
      }
    }
    const vp = reactFlow.getViewport();
    return {
      positions, styles,
      collapsed: Array.from(collapsed),
      hidden: Array.from(hiddenNodes),
      viewMode: "hierarchical",
      zoom: vp.zoom, panX: vp.x, panY: vp.y,
    };
  }, [nodes, collapsed, hiddenNodes, reactFlow]);

  const restoreViewState = useCallback((vs: ViewState) => {
    setCollapsed(new Set(vs.collapsed ?? []));
    setHiddenNodes(new Set(vs.hidden ?? []));
    pendingViewState.current = vs;
    cachedLayout.current = null;
  }, []);

  // ── Collapse/expand/compact ───────────────────────────────────────────
  const allGroupIds = useMemo(() => {
    if (!cachedLayout.current) return new Set<string>();
    return new Set(
      cachedLayout.current.nodes
        .filter((n) => (n.data as any)?.isGroup)
        .map((n) => n.id)
    );
  }, [nodes]);

  const allProcessNodes = useMemo(() => {
    if (!cachedLayout.current) return [] as Node[];
    return cachedLayout.current.nodes.filter((n) => n.type === "process");
  }, [nodes]);

  const handleCollapseAll = useCallback(() => {
    setCollapsed(new Set(allGroupIds));
  }, [allGroupIds]);

  const handleExpandAll = useCallback(() => {
    setCollapsed(new Set());
    setHiddenNodes(new Set());
    // Re-layout so newly revealed nodes get proper positions
    if (cachedGraph.current) {
      cachedLayout.current = null; // force re-layout
      const data = cachedGraph.current;
      const allNodes = data.nodes as unknown as Node[];
      const allEdges = data.edges as unknown as Edge[];
      const laid = applyLayout(allNodes, allEdges);
      cachedLayout.current = { nodes: laid, edges: allEdges };
    }
  }, []);

  const handleCompact = useCallback(() => {
    setNodes((current) => applyCompactLayout(current));
    setTimeout(() => {
      syncPositionsToCache();
      reactFlow.fitView({ padding: 0.1 });
    }, 50);
  }, [setNodes, reactFlow, syncPositionsToCache]);

  const handleHierarchical = useCallback(() => {
    // Re-run dagre tree layout using place edges (outers above inners)
    if (!cachedLayout.current) return;
    const allEdges = cachedLayout.current.edges;
    setNodes((current) => applyLayout(current, allEdges));
    setTimeout(() => {
      syncPositionsToCache();
      reactFlow.fitView({ padding: 0.1 });
    }, 50);
  }, [setNodes, reactFlow, syncPositionsToCache]);

  // ── Selection ─────────────────────────────────────────────────────────
  const onSelectionChange = useCallback(
    ({ nodes: sel }: OnSelectionChangeParams) => {
      const selected = sel.length === 1 ? sel[0] : null;
      setSelectedNode(selected);
      selectedNodeRef.current = selected;
      if (selected) setSidePanel("inspect");

      // Update edges only (for large-graph edge filtering)
      if (cachedLayout.current) {
        const currentHidden = hiddenRef.current;
        const visibleNodeIds = new Set(reactFlow.getNodes().map((n) => n.id));
        let visibleEdges = cachedLayout.current.edges.filter(
          (e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target)
            && !currentHidden.has(e.source) && !currentHidden.has(e.target)
        );
        const placeEdges = visibleEdges.filter((e) => (e.data as any)?.edgeType === "place");
        const wireEdges = visibleEdges.filter((e) => (e.data as any)?.edgeType !== "place");
        const WIRE_LIMIT = 200;
        if (wireEdges.length > WIRE_LIMIT) {
          const filteredWires = selected
            ? wireEdges.filter((e) => e.source === selected.id || e.target === selected.id)
            : [];
          setEdges([...placeEdges, ...filteredWires]);
        } else {
          setEdges(visibleEdges);
        }
      }
    },
    [reactFlow, setEdges]
  );

  const onNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const data = node.data as any;
      if (data?.isGroup) {
        setCollapsed((prev) => {
          const next = new Set(prev);
          if (next.has(node.id)) next.delete(node.id);
          else next.add(node.id);
          return next;
        });
      } else {
        setHiddenNodes((prev) => new Set(prev).add(node.id));
      }
    },
    []
  );

  const onNodeDragStop = useCallback(() => {
    syncPositionsToCache();
  }, [syncPositionsToCache]);

  // ── Process toggle ────────────────────────────────────────────────────
  const handleToggleProcess = useCallback((nodeId: string) => {
    setHiddenNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const handleHideAllProcesses = useCallback(() => {
    setHiddenNodes((prev) => {
      const next = new Set(prev);
      for (const n of allProcessNodes) next.add(n.id);
      return next;
    });
  }, [allProcessNodes]);

  const handleShowAllProcesses = useCallback(() => {
    setHiddenNodes((prev) => {
      const next = new Set(prev);
      for (const n of allProcessNodes) next.delete(n.id);
      return next;
    });
  }, [allProcessNodes]);

  const handleHideNode = useCallback((nodeId: string) => {
    setHiddenNodes((prev) => new Set(prev).add(nodeId));
  }, []);

  const handleImport = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pbg,.json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const result = await importPbgFile(file);
        setImportWarnings(result.warnings ?? []);
        if (result.warnings?.length) setTimeout(() => setImportWarnings([]), 15000);
        setCollapsed(new Set());
        setHiddenNodes(new Set());
        loadGraph();
      } catch (err: any) {
        console.error("Import failed:", err.message);
      }
    };
    input.click();
  }, [loadGraph]);

  const groupNodes = useMemo(() =>
    nodes.filter((n) => (n.data as any)?.isGroup), [nodes]);
  const allStoreNodes = useMemo(() =>
    nodes.filter((n) => n.type !== "process"), [nodes]);

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Bigraph Loom</h1>
        <div className="header-actions">
          <div className="view-toggle">
            <button onClick={handleCompact} title="Gather nodes into a tight grid">Compact</button>
            <button onClick={handleHierarchical} title="Tree layout: outers above inners">Hierarchy</button>
            <button onClick={handleExpandAll} title="Show all hidden/collapsed nodes">Expand</button>
            <button onClick={handleCollapseAll} title="Collapse all groups">Collapse</button>
          </div>
          <span className="header-sep" />
          <button className="header-btn" onClick={handleImport}>Import</button>
          <button className="header-btn" onClick={exportPbg}>Export</button>
          <span className="header-sep" />
          <div className="panel-tabs">
            <button
              className={sidePanel === "library" ? "panel-tab-active" : ""}
              onClick={() => setSidePanel(sidePanel === "library" ? "inspect" : "library")}
            >Library</button>
            <button
              className={sidePanel === "processes" ? "panel-tab-active" : ""}
              onClick={() => setSidePanel(sidePanel === "processes" ? "inspect" : "processes")}
            >Processes</button>
            <button
              className={sidePanel === "json" ? "panel-tab-active" : ""}
              onClick={() => setSidePanel(sidePanel === "json" ? "inspect" : "json")}
            >JSON</button>
          </div>
        </div>
      </header>
      {importWarnings.length > 0 && (
        <div className="warnings-bar">
          <strong>Unregistered processes:</strong>
          {importWarnings.map((w, i) => (
            <span key={i} className="warning-item" title={w.message}>
              {w.address} at {w.path.join("/")}
            </span>
          ))}
          <button className="warning-dismiss" onClick={() => setImportWarnings([])}>Dismiss</button>
        </div>
      )}
      <div className="app-body">
        <div className="canvas-container">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onSelectionChange={onSelectionChange}
            onNodeDoubleClick={onNodeDoubleClick}
            onNodeDragStop={onNodeDragStop}
            fitView
            minZoom={0.1}
            maxZoom={4}
            defaultEdgeOptions={{ type: "straight", animated: false }}
          >
            <Background gap={20} size={1} />
            <Controls />
          </ReactFlow>
        </div>
        <div className="sidebar">
          {sidePanel === "inspect" ? (
            <InspectorPanel
              node={selectedNode}
              onUpdate={loadGraph}
              onHide={handleHideNode}
              groupNodes={groupNodes}
              allStoreNodes={allStoreNodes}
            />
          ) : sidePanel === "json" ? (
            <Suspense fallback={<div style={{padding:16,color:"#94a3b8"}}>Loading editor...</div>}>
              <JsonPanel onUpdate={loadGraph} />
            </Suspense>
          ) : sidePanel === "processes" ? (
            <ProcessListPanel
              allProcessNodes={allProcessNodes}
              hiddenNodes={hiddenNodes}
              onToggle={handleToggleProcess}
              onHideAll={handleHideAllProcesses}
              onShowAll={handleShowAllProcesses}
            />
          ) : (
            <LibraryPanel
              onUpdate={loadGraph}
              onWarnings={(w) => {
                setImportWarnings(w);
                if (w.length) setTimeout(() => setImportWarnings([]), 15000);
              }}
              getViewState={getViewState}
              restoreViewState={restoreViewState}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <AppInner />
    </ReactFlowProvider>
  );
}
