import { useState, useEffect } from "react";
import type { Node } from "@xyflow/react";
import type { BigraphNodeData } from "../types";

interface Props {
  node: Node | null;
  onHide: (nodeId: string) => void;
  groupNodes: Node[];
  allStoreNodes?: Node[];
  onUpdateNodeValue: (path: string[], value: unknown) => void;
  onUpdateNodeConfig: (path: string[], config: Record<string, unknown>) => void;
  onDeleteNode: (path: string[]) => void;
  onRewirePort: (processPath: string[], portName: string, direction: "inputs" | "outputs", newTarget: string[]) => void;
  onNestNode: (sourcePath: string[], targetParent: string[]) => void;
}

export default function InspectorPanel({ node, onHide, groupNodes, onUpdateNodeValue, onUpdateNodeConfig, onDeleteNode, onRewirePort, onNestNode }: Props) {
  const [editValue, setEditValue] = useState("");
  const [configEdits, setConfigEdits] = useState<Record<string, string>>({});
  const [wireEdits, setWireEdits] = useState<Record<string, string>>({});
  const [nestTarget, setNestTarget] = useState("");

  const data = node?.data as BigraphNodeData | undefined;

  useEffect(() => {
    if (!data) return;
    if (data.nodeType === "store" && "value" in data && data.value !== undefined) {
      setEditValue(String(data.value));
    }
    if (data.nodeType === "process") {
      const entries: Record<string, string> = {};
      for (const [k, v] of Object.entries(data.config)) entries[k] = String(v);
      setConfigEdits(entries);

      const wires: Record<string, string> = {};
      const iw = (data as any).inputWires ?? {};
      const ow = (data as any).outputWires ?? {};
      for (const p of (data as any).inputPorts ?? []) {
        wires[`in:${p}`] = iw[p] ?? "";
      }
      for (const p of (data as any).outputPorts ?? []) {
        wires[`out:${p}`] = ow[p] ?? "";
      }
      setWireEdits(wires);
    }
    setNestTarget("");
  }, [node?.id]);

  if (!node || !data) {
    return (
      <div className="inspector-panel">
        <div className="inspector-empty">Click a node to inspect</div>
        <div className="inspector-hint">Double-click to collapse groups or hide nodes</div>
      </div>
    );
  }

  const path = data.path;

  function handleValueSave() {
    let parsed: unknown = editValue;
    const num = Number(editValue);
    if (!isNaN(num) && editValue.trim() !== "") parsed = num;
    else if (editValue === "true") parsed = true;
    else if (editValue === "false") parsed = false;
    onUpdateNodeValue(path, parsed);
  }

  function handleConfigSave() {
    const config: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(configEdits)) {
      const num = Number(v);
      if (!isNaN(num) && v.trim() !== "") config[k] = num;
      else if (v === "true") config[k] = true;
      else if (v === "false") config[k] = false;
      else config[k] = v;
    }
    onUpdateNodeConfig(path, config);
  }

  function handleRewire(portName: string, direction: "inputs" | "outputs") {
    const key = direction === "inputs" ? `in:${portName}` : `out:${portName}`;
    const target = wireEdits[key]?.trim();
    if (!target) return;
    onRewirePort(path, portName, direction, target.split("/"));
  }

  function handleDelete() {
    if (!confirm(`Delete "${data!.label}" and all its children?`)) return;
    onDeleteNode(path);
  }

  function handleMove() {
    if (!nestTarget) return;
    onNestNode(path, nestTarget.split("/"));
    setNestTarget("");
  }

  const inputPorts: string[] = (data as any).inputPorts ?? [];
  const outputPorts: string[] = (data as any).outputPorts ?? [];

  return (
    <div className="inspector-panel">
      <div className="inspector-header">
        <h3>
          {data.label}
          <span className="inspector-badge">
            {data.nodeType === "process" ? (data as any).processType : "store"}
          </span>
        </h3>
        <div className="inspector-header-actions">
          <button className="hide-btn" onClick={() => onHide(node.id)}>Hide</button>
          <button className="delete-btn" onClick={handleDelete}>Delete</button>
        </div>
      </div>

      <div className="inspector-field">
        <label>Path</label>
        <code>{path.join(" / ")}</code>
      </div>

      {(data as any)?.isGroup && (
        <div className="inspector-hint">
          Double-click to {(data as any).isCollapsed ? "expand" : "collapse"}
        </div>
      )}

      {data.nodeType === "store" && "value" in data && data.value !== undefined && (
        <div className="inspector-section">
          <div className="inspector-field">
            <label>Type</label>
            <code>{(data as any).valueType}</code>
          </div>
          <div className="inspector-field">
            <label>Value</label>
            <input
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleValueSave()}
            />
            <button onClick={handleValueSave}>Save</button>
          </div>
        </div>
      )}

      {data.nodeType === "process" && (
        <div className="inspector-section">
          <div className="inspector-field">
            <label>Address</label>
            <code>{(data as any).address || "\u2014"}</code>
          </div>

          {/* Input Ports */}
          <h4>Input Ports</h4>
          {inputPorts.map((p) => {
            const key = `in:${p}`;
            const currentWire = wireEdits[key] ?? "";
            return (
              <div className="wire-field" key={key}>
                <div className="wire-port-name">{p}</div>
                <div className="wire-edit-row">
                  <input
                    className="wire-input"
                    value={currentWire}
                    onChange={(e) => setWireEdits({ ...wireEdits, [key]: e.target.value })}
                    placeholder="target/path"
                    onKeyDown={(e) => e.key === "Enter" && handleRewire(p, "inputs")}
                  />
                  <button className="wire-btn" onClick={() => handleRewire(p, "inputs")}>Wire</button>
                </div>
              </div>
            );
          })}

          {/* Output Ports */}
          <h4>Output Ports</h4>
          {outputPorts.map((p) => {
            const key = `out:${p}`;
            const currentWire = wireEdits[key] ?? "";
            return (
              <div className="wire-field" key={key}>
                <div className="wire-port-name">{p}</div>
                <div className="wire-edit-row">
                  <input
                    className="wire-input"
                    value={currentWire}
                    onChange={(e) => setWireEdits({ ...wireEdits, [key]: e.target.value })}
                    placeholder="target/path"
                    onKeyDown={(e) => e.key === "Enter" && handleRewire(p, "outputs")}
                  />
                  <button className="wire-btn" onClick={() => handleRewire(p, "outputs")}>Wire</button>
                </div>
              </div>
            );
          })}

          {/* Config */}
          {Object.keys(configEdits).length > 0 && (
            <>
              <h4>Config</h4>
              {Object.entries(configEdits).map(([k, v]) => (
                <div className="inspector-field" key={k}>
                  <label>{k}</label>
                  <input
                    value={v}
                    onChange={(e) => setConfigEdits({ ...configEdits, [k]: e.target.value })}
                  />
                </div>
              ))}
              <button onClick={handleConfigSave}>Save Config</button>
            </>
          )}
        </div>
      )}

      {/* Move Into */}
      {groupNodes.length > 0 && (
        <div className="inspector-section">
          <h4>Move Into</h4>
          <div className="wire-edit-row">
            <select
              className="wire-input"
              value={nestTarget}
              onChange={(e) => setNestTarget(e.target.value)}
            >
              <option value="">— select parent —</option>
              {groupNodes
                .filter((g) => {
                  const gPath = ((g.data as any).path as string[]).join("/");
                  const selfPath = path.join("/");
                  return gPath !== selfPath && !gPath.startsWith(selfPath + "/");
                })
                .map((g) => {
                  const gPath = ((g.data as any).path as string[]).join("/");
                  return <option key={g.id} value={gPath}>{gPath}</option>;
                })}
            </select>
            <button
              className="wire-btn"
              disabled={!nestTarget}
              onClick={handleMove}
            >Move</button>
          </div>
        </div>
      )}
    </div>
  );
}
