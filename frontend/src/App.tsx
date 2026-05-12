import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ConnectionMode,
  type Node,
  type Edge,
  type Connection,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import StoreNode from "./nodes/StoreNode";
import ProcessNode from "./nodes/ProcessNode";
import InspectorPanel from "./panels/InspectorPanel";
import LibraryPanel from "./panels/LibraryPanel";
import ProcessListPanel from "./panels/ProcessListPanel";
import EditPanel from "./panels/EditPanel";
import SimulationPanel from "./panels/SimulationPanel";
import {
  exportPbg,
  parsePbgFile,
  getInState,
  setInState,
  deleteInState,
  loadLibraryEntryState,
  type ViewState,
  type ImportWarning,
  type AnyDict,
} from "./api";
import { bigraphToFlow, type FlowNodeData } from "./convert";
import { applyLayout, applyCompactLayout } from "./layout";
import "./App.css";

const JsonPanel = lazy(() => import("./panels/JsonPanel"));

const nodeTypes = { store: StoreNode, process: ProcessNode };

type SidePanel = "inspect" | "json" | "library" | "processes" | "edit" | "simulation";

const DEFAULT_STATE: AnyDict = {};

const STORAGE_KEY = "bgloom_current_state";

function AppInner() {
  const [pbgState, setPbgState] = useState<AnyDict>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved) as AnyDict;
    } catch { /* ignore */ }
    return DEFAULT_STATE;
  });
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [hiddenNodes, setHiddenNodes] = useState<Set<string>>(new Set());
  const [sidePanel, setSidePanel] = useState<SidePanel>("inspect");
  const [importWarnings, setImportWarnings] = useState<ImportWarning[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState(320);

  const cachedLayout = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const pendingViewState = useRef<ViewState | null>(null);
  const selectedNodeRef = useRef<Node | null>(null);
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const hiddenRef = useRef(hiddenNodes);
  hiddenRef.current = hiddenNodes;

  const reactFlow = useReactFlow();

  const placeChildrenRef = useRef(new Map<string, string[]>());

  // Persist state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pbgState));
    } catch { /* ignore */ }
  }, [pbgState]);

  // Convert state -> flow nodes/edges
  const flowResult = useMemo(() => bigraphToFlow(pbgState), [pbgState]);

  // Build place-children map
  useEffect(() => {
    const map = new Map<string, string[]>();
    for (const e of flowResult.edges) {
      if (e.data?.edgeType === "place") {
        const list = map.get(e.source) ?? [];
        list.push(e.target);
        map.set(e.source, list);
      }
    }
    placeChildrenRef.current = map;
  }, [flowResult.edges]);

  // Compute layout
  const computeLayout = useCallback(
    (allNodes: Node<FlowNodeData>[], allEdges: Edge[]): { nodes: Node[]; edges: Edge[] } => {
      const vs = pendingViewState.current;
      let nodesToLayout = allNodes;
      let edgesToLayout = allEdges;

      if (vs) {
        const collapsedSet = new Set(vs.collapsed ?? []);
        const hiddenSet = new Set(vs.hidden ?? []);

        if (collapsedSet.size > 0 || hiddenSet.size > 0) {
          const placeChildren = new Map<string, string[]>();
          for (const e of allEdges) {
            if ((e.data as any)?.edgeType === "place") {
              const list = placeChildren.get(e.source) ?? [];
              list.push(e.target);
              placeChildren.set(e.source, list);
            }
          }
          const getDesc = (ids: Iterable<string>): Set<string> => {
            const desc = new Set<string>();
            const queue = [...ids];
            while (queue.length) {
              const id = queue.shift()!;
              for (const child of placeChildren.get(id) ?? []) {
                if (!desc.has(child)) { desc.add(child); queue.push(child); }
              }
            }
            return desc;
          };

          const collapsedDesc = getDesc(collapsedSet);
          const hiddenWithDesc = new Set(hiddenSet);
          for (const id of hiddenSet) {
            for (const d of getDesc([id])) hiddenWithDesc.add(d);
          }

          const excludeIds = new Set([...collapsedDesc, ...hiddenWithDesc]);
          nodesToLayout = allNodes.filter((n) => !excludeIds.has(n.id));
          const visibleIds = new Set(nodesToLayout.map((n) => n.id));
          edgesToLayout = allEdges.filter(
            (e) => visibleIds.has(e.source) && visibleIds.has(e.target)
          );
        }
      }

      let laid = applyLayout(nodesToLayout, edgesToLayout);

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

      const laidIds = new Map(laid.map((n) => [n.id, n]));
      const fullNodes = allNodes.map((n) => laidIds.get(n.id) ?? n);
      return { nodes: fullNodes, edges: allEdges };
    },
    [reactFlow]
  );

  // Sync flow results to React Flow state
  useEffect(() => {
    cachedLayout.current = null;
    const { nodes: flowNodes, edges: flowEdges } = flowResult;
    const { nodes: laid, edges: allEdges } = computeLayout(flowNodes, flowEdges);
    cachedLayout.current = { nodes: laid, edges: allEdges };
    applyFilter(laid, allEdges);
  }, [flowResult]);

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

  const applyFilter = useCallback(
    (allNodes: Node[], allEdges: Edge[]) => {
      const currentCollapsed = collapsedRef.current;
      const currentHidden = hiddenRef.current;

      const hiddenWithDescendants = new Set(currentHidden);
      for (const id of currentHidden) {
        for (const desc of getDescendants([id])) {
          hiddenWithDescendants.add(desc);
        }
      }

      const collapsedDescendants = getDescendants(currentCollapsed);

      let visibleNodes = allNodes.filter(
        (n) => !hiddenWithDescendants.has(n.id) && !collapsedDescendants.has(n.id)
      );

      const visibleIds = new Set(visibleNodes.map((n) => n.id));
      let visibleEdges = allEdges.filter(
        (e) => visibleIds.has(e.source) && visibleIds.has(e.target)
      );

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

  // Re-filter when collapsed/hidden change
  useEffect(() => {
    if (!cachedLayout.current) return;
    const allNodes = cachedLayout.current.nodes;
    const allEdges = cachedLayout.current.edges;

    const currentCollapsed = collapsedRef.current;
    const currentHidden = hiddenRef.current;

    const hiddenWithDesc = new Set(currentHidden);
    for (const id of currentHidden) {
      for (const d of getDescendants([id])) hiddenWithDesc.add(d);
    }
    const collapsedDesc = getDescendants(currentCollapsed);
    const excludeIds = new Set([...collapsedDesc, ...hiddenWithDesc]);

    const visibleNodes = allNodes.filter((n) => !excludeIds.has(n.id));

    const needsLayout = visibleNodes.some(
      (n) => n.position.x === 0 && n.position.y === 0
    );

    if (needsLayout && visibleNodes.length > 0) {
      const visibleIds = new Set(visibleNodes.map((n) => n.id));
      const visibleEdges = allEdges.filter(
        (e) => visibleIds.has(e.source) && visibleIds.has(e.target)
      );
      const laid = applyLayout(visibleNodes, visibleEdges);

      const laidMap = new Map(laid.map((n) => [n.id, n]));
      cachedLayout.current.nodes = allNodes.map((n) => laidMap.get(n.id) ?? n);
    }

    applyFilter(cachedLayout.current.nodes, cachedLayout.current.edges);
  }, [collapsed, hiddenNodes, applyFilter, getDescendants]);

  const syncPositionsToCache = useCallback(() => {
    if (!cachedLayout.current) return;
    const currentNodes = reactFlow.getNodes();
    const posMap = new Map(currentNodes.map((n) => [n.id, n.position]));
    cachedLayout.current.nodes = cachedLayout.current.nodes.map((n) => {
      const pos = posMap.get(n.id);
      return pos ? { ...n, position: pos } : n;
    });
  }, [reactFlow]);

  // ── State mutation helpers ────────────────────────────────────────────────

  const mutateState = useCallback((fn: (prev: AnyDict) => AnyDict) => {
    setPbgState((prev) => fn(prev));
  }, []);

  const handleAddStore = useCallback((path: string[], value: unknown) => {
    mutateState((prev) => setInState(prev, path, value));
  }, [mutateState]);

  const handleAddProcess = useCallback(
    (path: string[], data: {
      address: string;
      process_type?: string;
      config?: Record<string, unknown>;
      inputs?: Record<string, string[]>;
      outputs?: Record<string, string[]>;
    }) => {
      mutateState((prev) => {
        const process: AnyDict = {
          _type: data.process_type ?? "process",
          address: data.address,
          config: data.config ?? {},
          inputs: data.inputs ?? {},
          outputs: data.outputs ?? {},
        };
        return setInState(prev, path, process);
      });
    },
    [mutateState]
  );

  const handleUpdateNodeValue = useCallback((path: string[], value: unknown) => {
    mutateState((prev) => setInState(prev, path, value));
  }, [mutateState]);

  const handleUpdateNodeConfig = useCallback((path: string[], config: Record<string, unknown>) => {
    mutateState((prev) => {
      const current = getInState(prev, path);
      if (typeof current !== "object" || current === null) return prev;
      const updated = { ...(current as AnyDict), config };
      return setInState(prev, path, updated);
    });
  }, [mutateState]);

  const handleDeleteNode = useCallback((path: string[]) => {
    mutateState((prev) => deleteInState(prev, path));
  }, [mutateState]);

  const handleRewirePort = useCallback(
    (processPath: string[], portName: string, direction: "inputs" | "outputs", newTarget: string[]) => {
      mutateState((prev) => {
        const proc = getInState(prev, processPath) as AnyDict | undefined;
        if (!proc || typeof proc !== "object") return prev;
        const ports = { ...(proc[direction] as AnyDict ?? {}) };
        ports[portName] = newTarget;
        const updated = { ...proc, [direction]: ports };
        return setInState(prev, processPath, updated);
      });
    },
    [mutateState]
  );

  const handleNestNode = useCallback((sourcePath: string[], targetParent: string[]) => {
    mutateState((prev) => {
      // Move source node into target parent
      const source = getInState(prev, sourcePath);
      if (source === undefined) return prev;
      let state = deleteInState(prev, sourcePath);
      state = setInState(state, [...targetParent, ...sourcePath.slice(-1)], source);
      return state;
    });
  }, [mutateState]);

  const handleApplyState = useCallback((state: AnyDict) => {
    setPbgState(state);
    setCollapsed(new Set());
    setHiddenNodes(new Set());
    cachedLayout.current = null;
  }, []);

  // ── View state ────────────────────────────────────────────────────────────

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
    const newCollapsed = new Set(vs.collapsed ?? []);
    const newHidden = new Set(vs.hidden ?? []);
    setCollapsed(newCollapsed);
    setHiddenNodes(newHidden);
    collapsedRef.current = newCollapsed;
    hiddenRef.current = newHidden;
    pendingViewState.current = vs;
    cachedLayout.current = null;
  }, []);

  // ── Collapse/expand/compact ───────────────────────────────────────────────

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
    if (cachedLayout.current) {
      cachedLayout.current = null;
      const { nodes: flowNodes, edges: flowEdges } = flowResult;
      const { nodes: laid, edges: allEdges } = computeLayout(flowNodes, flowEdges);
      cachedLayout.current = { nodes: laid, edges: allEdges };
    }
  }, [flowResult, computeLayout]);

  const handleCompact = useCallback(() => {
    setNodes((current) => applyCompactLayout(current));
    setTimeout(() => {
      syncPositionsToCache();
      reactFlow.fitView({ padding: 0.1 });
    }, 50);
  }, [setNodes, reactFlow, syncPositionsToCache]);

  const handleHierarchical = useCallback(() => {
    if (!cachedLayout.current) return;
    const allEdges = cachedLayout.current.edges;
    setNodes((current) => applyLayout(current, allEdges));
    setTimeout(() => {
      syncPositionsToCache();
      reactFlow.fitView({ padding: 0.1 });
    }, 50);
  }, [setNodes, reactFlow, syncPositionsToCache]);

  // ── Selection ─────────────────────────────────────────────────────────────

  const onSelectionChange = useCallback(
    ({ nodes: sel }: OnSelectionChangeParams) => {
      const selected = sel.length === 1 ? sel[0] : null;
      setSelectedNode(selected);
      selectedNodeRef.current = selected;
      if (selected) setSidePanel("inspect");

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

  // ── Connect (drag between nodes) ──────────────────────────────────────────

  const onConnect = useCallback(
    (connection: Connection) => {
      const sourceNode = cachedLayout.current?.nodes.find((n) => n.id === connection.source);
      const targetNode = cachedLayout.current?.nodes.find((n) => n.id === connection.target);
      if (!sourceNode || !targetNode) return;

      const srcData = sourceNode.data as any;
      const tgtData = targetNode.data as any;

      if (srcData.nodeType === "process" && connection.sourceHandle) {
        handleRewirePort(srcData.path, connection.sourceHandle, "outputs", tgtData.path);
      } else if (tgtData.nodeType === "process" && connection.targetHandle) {
        handleRewirePort(tgtData.path, connection.targetHandle, "inputs", srcData.path);
      } else if (srcData.nodeType === "store" && tgtData.nodeType === "store") {
        handleNestNode(tgtData.path, srcData.path);
      }
    },
    [handleRewirePort, handleNestNode]
  );

  // ── Process toggle ────────────────────────────────────────────────────────

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

  // ── New / Import / Export ─────────────────────────────────────────────────

  const handleNew = useCallback(() => {
    setPbgState({});
    setCollapsed(new Set());
    setHiddenNodes(new Set());
    cachedLayout.current = null;
  }, []);

  const handleImport = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pbg,.json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const parsed = await parsePbgFile(file);
        if (parsed.view_state) {
          restoreViewState(parsed.view_state);
        }
        setPbgState(parsed.state);
        setCollapsed(new Set());
        setHiddenNodes(new Set());
        cachedLayout.current = null;
      } catch (err: any) {
        console.error("Import failed:", err.message);
      }
    };
    input.click();
  }, [restoreViewState]);

  const handleExport = useCallback(() => {
    exportPbg(pbgState, null, getViewState());
  }, [pbgState, getViewState]);

  // ── Library ───────────────────────────────────────────────────────────────

  const handleLibraryLoad = useCallback((name: string) => {
    const state = loadLibraryEntryState(name);
    if (state) {
      setPbgState(state);
      setCollapsed(new Set());
      setHiddenNodes(new Set());
      cachedLayout.current = null;
      return { ok: true, warnings: [] as ImportWarning[], view_state: null as ViewState | null };
    }
    return { ok: false, warnings: [] as ImportWarning[], view_state: null as ViewState | null };
  }, []);

  // ── Panels computed props ─────────────────────────────────────────────────

  const groupNodes = useMemo(() =>
    nodes.filter((n) => (n.data as any)?.isGroup), [nodes]);
  const allStoreNodes = useMemo(() =>
    nodes.filter((n) => n.type !== "process"), [nodes]);
  const storePaths = useMemo(() =>
    groupNodes.map((n) => (n.data as any).path as string[]), [groupNodes]);

  // Sidebar resize
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: MouseEvent) => setSidebarWidth(Math.max(200, Math.min(800, startW + startX - ev.clientX)));
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [sidebarWidth]);

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
          <button className="header-btn" onClick={handleNew}>New</button>
          <button className="header-btn" onClick={handleImport}>Import</button>
          <button className="header-btn" onClick={handleExport}>Export</button>
          <span className="header-sep" />
          <button className="header-btn header-btn-run" onClick={() => setSidePanel("simulation")}>
            Run
          </button>
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
              className={sidePanel === "simulation" ? "panel-tab-active" : ""}
              onClick={() => setSidePanel(sidePanel === "simulation" ? "inspect" : "simulation")}
            >Simulation</button>
            <button
              className={sidePanel === "edit" ? "panel-tab-active" : ""}
              onClick={() => setSidePanel(sidePanel === "edit" ? "inspect" : "edit")}
            >Edit</button>
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
            onConnect={onConnect}
            connectionMode={ConnectionMode.Loose}
            fitView
            minZoom={0.1}
            maxZoom={4}
            defaultEdgeOptions={{ type: "straight", animated: false }}
          >
            <Background gap={20} size={1} />
            <Controls />
          </ReactFlow>
        </div>
        <div className="sidebar-resize-handle" onMouseDown={handleResizeStart} />
        <div className="sidebar" style={{ width: sidebarWidth }}>
          {sidePanel === "inspect" ? (
            <InspectorPanel
              node={selectedNode}
              onHide={handleHideNode}
              groupNodes={groupNodes}
              allStoreNodes={allStoreNodes}
              onUpdateNodeValue={handleUpdateNodeValue}
              onUpdateNodeConfig={handleUpdateNodeConfig}
              onDeleteNode={handleDeleteNode}
              onRewirePort={handleRewirePort}
              onNestNode={handleNestNode}
            />
          ) : sidePanel === "json" ? (
            <Suspense fallback={<div style={{padding:16,color:"#94a3b8"}}>Loading editor...</div>}>
              <JsonPanel
                pbgState={pbgState}
                onApplyState={handleApplyState}
              />
            </Suspense>
          ) : sidePanel === "processes" ? (
            <ProcessListPanel
              allProcessNodes={allProcessNodes}
              hiddenNodes={hiddenNodes}
              onToggle={handleToggleProcess}
              onHideAll={handleHideAllProcesses}
              onShowAll={handleShowAllProcesses}
            />
          ) : sidePanel === "edit" ? (
            <EditPanel
              storePaths={storePaths}
              onAddStore={handleAddStore}
              onAddProcess={handleAddProcess}
            />
          ) : sidePanel === "simulation" ? (
            <SimulationPanel pbgState={pbgState} />
          ) : (
            <LibraryPanel
              onWarnings={(w) => {
                setImportWarnings(w);
                if (w.length) setTimeout(() => setImportWarnings([]), 15000);
              }}
              getViewState={getViewState}
              restoreViewState={restoreViewState}
              pbgState={pbgState}
              onLibraryLoad={handleLibraryLoad}
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
