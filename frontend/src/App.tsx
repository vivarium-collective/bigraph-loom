import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import StoreNode from "./nodes/StoreNode";
import ProcessNode from "./nodes/ProcessNode";
import GroupNode from "./nodes/GroupNode";
import InspectorPanel from "./panels/InspectorPanel";
import AddPanel from "./panels/AddPanel";
import JsonPanel from "./panels/JsonPanel";
import {
  fetchGraph,
  exportPbg,
  importPbgFile,
  runCheck,
  nestNode,
  fetchCoreInfo,
  type ViewMode,
  type ImportWarning,
} from "./api";
import { applyLayout } from "./layout";
import "./App.css";

const nodeTypes = {
  store: StoreNode,
  process: ProcessNode,
  group: GroupNode,
};

type SidePanel = "inspect" | "add" | "json";

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [hiddenNodes, setHiddenNodes] = useState<Set<string>>(new Set());
  const [sidePanel, setSidePanel] = useState<SidePanel>("inspect");
  const [viewMode, setViewMode] = useState<ViewMode>("nested");
  const [checkResult, setCheckResult] = useState<{
    valid: boolean;
    error?: string;
  } | null>(null);
  const [coreInfo, setCoreInfo] = useState<{
    class: string;
    module: string;
    source_file: string | null;
    num_types: number;
    num_processes: number;
  } | null>(null);
  const [importWarnings, setImportWarnings] = useState<ImportWarning[]>([]);

  // Load Core info once
  useEffect(() => {
    fetchCoreInfo().then(setCoreInfo).catch(() => {});
  }, []);

  const loadGraph = useCallback(async () => {
    try {
      const data = await fetchGraph(viewMode);

      // Filter out hidden nodes
      let visibleNodes = data.nodes.filter((n) => !hiddenNodes.has(n.id));

      // Filter out children of collapsed groups (only in nested mode)
      if (viewMode === "nested") {
        visibleNodes = visibleNodes.filter((n) => {
          if (!n.parentId) return true;
          let pid: string | undefined = n.parentId;
          while (pid) {
            if (collapsed.has(pid)) return false;
            const parent = data.nodes.find((p) => p.id === pid);
            pid = parent?.parentId;
          }
          return true;
        });
      } else {
        // In hierarchical mode, collapse hides all descendants (via place edges)
        if (collapsed.size > 0) {
          const descendantsOf = new Set<string>();
          // Build parent->children map from place edges
          const placeChildren = new Map<string, string[]>();
          for (const e of data.edges) {
            if (e.data?.edgeType === "place") {
              const list = placeChildren.get(e.source) ?? [];
              list.push(e.target);
              placeChildren.set(e.source, list);
            }
          }
          // BFS from each collapsed node to find all descendants
          for (const cid of collapsed) {
            const queue = placeChildren.get(cid) ?? [];
            while (queue.length) {
              const child = queue.shift()!;
              descendantsOf.add(child);
              for (const gc of placeChildren.get(child) ?? []) {
                queue.push(gc);
              }
            }
          }
          visibleNodes = visibleNodes.filter((n) => !descendantsOf.has(n.id));
        }
      }

      const visibleIds = new Set(visibleNodes.map((n) => n.id));
      const visibleEdges = data.edges.filter(
        (e) => visibleIds.has(e.source) && visibleIds.has(e.target)
      );

      // Mark collapsed group nodes so the UI can show the indicator
      const markedNodes = visibleNodes.map((n) => {
        if (collapsed.has(n.id)) {
          return {
            ...n,
            data: { ...n.data, isCollapsed: true },
          };
        }
        return n;
      });

      const laid = applyLayout(
        markedNodes as unknown as Node[],
        visibleEdges as unknown as Edge[],
        viewMode
      );
      setNodes(laid);
      setEdges(visibleEdges as unknown as Edge[]);
    } catch (err) {
      console.error("Failed to load graph:", err);
    }
  }, [collapsed, hiddenNodes, viewMode, setNodes, setEdges]);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  const storePaths = useMemo(() => {
    return nodes
      .filter(
        (n) =>
          n.type === "group" ||
          (n.data && (n.data as any).nodeType === "store" && (n.data as any).isGroup)
      )
      .map((n) => (n.data as any).path as string[]);
  }, [nodes]);

  const onSelectionChange = useCallback(
    ({ nodes: sel }: OnSelectionChangeParams) => {
      if (sel.length === 1) {
        setSelectedNode(sel[0]);
        setSidePanel("inspect");
      } else {
        setSelectedNode(null);
      }
    },
    []
  );

  const onNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      // Toggle collapse on group nodes (nested) or store-with-children (hierarchical)
      const data = node.data as any;
      if (node.type === "group" || data?.isGroup) {
        setCollapsed((prev) => {
          const next = new Set(prev);
          if (next.has(node.id)) next.delete(node.id);
          else next.add(node.id);
          return next;
        });
      }
    },
    []
  );

  const handleCheck = useCallback(async () => {
    const result = await runCheck();
    setCheckResult(result);
    setTimeout(() => setCheckResult(null), 5000);
  }, []);

  const handleNest = useCallback(
    async (sourceId: string, targetId: string) => {
      const sourceNode = nodes.find((n) => n.id === sourceId);
      const targetNode = nodes.find((n) => n.id === targetId);
      if (!sourceNode || !targetNode) return;
      const sourcePath = (sourceNode.data as any).path as string[];
      const targetPath = (targetNode.data as any).path as string[];
      try {
        await nestNode(sourcePath, targetPath);
        loadGraph();
      } catch (err: any) {
        console.error("Nest failed:", err.message);
      }
    },
    [nodes, loadGraph]
  );

  const handleHideNode = useCallback(
    (nodeId: string) => {
      setHiddenNodes((prev) => new Set(prev).add(nodeId));
    },
    []
  );

  const handleShowAll = useCallback(() => {
    setHiddenNodes(new Set());
    setCollapsed(new Set());
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
        if (result.warnings?.length) {
          setTimeout(() => setImportWarnings([]), 15000);
        }
        loadGraph();
      } catch (err: any) {
        console.error("Import failed:", err.message);
      }
    };
    input.click();
  }, [loadGraph]);

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Bigraph Loom</h1>
        <div className="header-actions">
          {/* View toggle */}
          <div className="view-toggle">
            <button
              className={viewMode === "nested" ? "toggle-active" : ""}
              onClick={() => setViewMode("nested")}
              title="Nested view: stores inside stores"
            >
              Nested
            </button>
            <button
              className={viewMode === "hierarchical" ? "toggle-active" : ""}
              onClick={() => setViewMode("hierarchical")}
              title="Hierarchical view: place graph with processes to the side"
            >
              Hierarchy
            </button>
          </div>

          <button className="header-btn" onClick={handleImport} title="Import .pbg file">
            Import .pbg
          </button>
          <button className="header-btn" onClick={handleCheck} title="Run schema check">
            Check
          </button>
          <button className="header-btn" onClick={exportPbg} title="Export .pbg file">
            Export .pbg
          </button>
          {(hiddenNodes.size > 0 || collapsed.size > 0) && (
            <button className="header-btn" onClick={handleShowAll} title="Show all hidden/collapsed nodes">
              Show All
            </button>
          )}
          <button
            className={`header-btn ${sidePanel === "add" ? "header-btn-active" : ""}`}
            onClick={() => setSidePanel(sidePanel === "add" ? "inspect" : "add")}
          >
            + Add
          </button>
          <button
            className={`header-btn ${sidePanel === "json" ? "header-btn-active" : ""}`}
            onClick={() => setSidePanel(sidePanel === "json" ? "inspect" : "json")}
          >
            JSON
          </button>
          {checkResult && (
            <span className={`check-badge ${checkResult.valid ? "check-ok" : "check-fail"}`}>
              {checkResult.valid ? "Valid" : checkResult.error || "Invalid"}
            </span>
          )}
        </div>
      </header>
      {/* Core info bar */}
      {coreInfo && (
        <div className="core-info-bar">
          <span className="core-label">Core:</span>
          <span className="core-class">{coreInfo.class}</span>
          {coreInfo.source_file && (
            <span className="core-file" title={coreInfo.source_file}>
              {coreInfo.source_file}
            </span>
          )}
          <span className="core-stats">
            {coreInfo.num_types} types, {coreInfo.num_processes} processes
          </span>
        </div>
      )}
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
            fitView
            minZoom={0.1}
            maxZoom={4}
            defaultEdgeOptions={{
              type: "smoothstep",
              animated: true,
            }}
          >
            <Background gap={20} size={1} />
            <Controls />
            <MiniMap
              nodeStrokeWidth={3}
              nodeColor={(n: Node) =>
                n.type === "process"
                  ? "#6366f1"
                  : n.type === "group"
                    ? "#e5e7eb"
                    : "#10b981"
              }
            />
          </ReactFlow>
        </div>
        {sidePanel === "inspect" ? (
          <InspectorPanel
            node={selectedNode}
            onUpdate={loadGraph}
            onNest={handleNest}
            onHide={handleHideNode}
            groupNodes={nodes.filter((n) => n.type === "group" || (n.data as any)?.isGroup)}
            allStoreNodes={nodes.filter((n) => n.type !== "process")}
          />
        ) : sidePanel === "add" ? (
          <AddPanel storePaths={storePaths} onUpdate={loadGraph} />
        ) : (
          <JsonPanel onUpdate={loadGraph} />
        )}
      </div>
    </div>
  );
}
