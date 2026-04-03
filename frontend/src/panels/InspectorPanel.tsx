import { useState, useEffect } from "react";
import type { Node } from "@xyflow/react";
import type { BigraphNodeData } from "../types";
import { updateNodeValue, updateNodeConfig, deleteNode, fetchProcessSource, rewirePort, type ProcessInfo } from "../api";

interface Props {
  node: Node | null;
  onUpdate: () => void;
  onHide: (nodeId: string) => void;
  groupNodes: Node[];
  allStoreNodes?: Node[];
}

export default function InspectorPanel({ node, onUpdate, onHide, groupNodes }: Props) {
  const [editValue, setEditValue] = useState("");
  const [configEdits, setConfigEdits] = useState<Record<string, string>>({});
  const [processInfo, setProcessInfo] = useState<ProcessInfo | null>(null);
  const [showUpdateSource, setShowUpdateSource] = useState(false);
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

      // Initialize wire edits from current wires
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

      const address = (data as any).address;
      if (address) {
        fetchProcessSource(address).then(setProcessInfo).catch(() => setProcessInfo(null));
      } else {
        setProcessInfo(null);
      }
    } else {
      setProcessInfo(null);
    }
    setShowUpdateSource(false);
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

  async function handleValueSave() {
    let parsed: unknown = editValue;
    const num = Number(editValue);
    if (!isNaN(num) && editValue.trim() !== "") parsed = num;
    else if (editValue === "true") parsed = true;
    else if (editValue === "false") parsed = false;
    await updateNodeValue(path, parsed);
    onUpdate();
  }

  async function handleConfigSave() {
    const config: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(configEdits)) {
      const num = Number(v);
      if (!isNaN(num) && v.trim() !== "") config[k] = num;
      else if (v === "true") config[k] = true;
      else if (v === "false") config[k] = false;
      else config[k] = v;
    }
    await updateNodeConfig(path, config);
    onUpdate();
  }

  async function handleRewire(portName: string, direction: "inputs" | "outputs") {
    const key = direction === "inputs" ? `in:${portName}` : `out:${portName}`;
    const target = wireEdits[key]?.trim();
    if (!target) return;
    await rewirePort({
      process_path: path,
      port_name: portName,
      direction,
      new_target: target.split("/"),
    });
    onUpdate();
  }

  async function handleDelete() {
    if (!confirm(`Delete "${data!.label}" and all its children?`)) return;
    await deleteNode(path);
    onUpdate();
  }

  const inputTypes = processInfo?.inputs ?? {};
  const outputTypes = processInfo?.outputs ?? {};

  return (
    <div className="inspector-panel">
      <div className="inspector-header">
        <h3>
          {data.label}
          <span className="inspector-badge">
            {data.nodeType === "process" ? (data as any).processType : "store"}
          </span>
          {data.nodeType === "process" && processInfo && !processInfo.registered && (
            <span className="inspector-badge badge-warning">not registered</span>
          )}
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
          {(data as any).interval != null && (
            <div className="inspector-field">
              <label>Interval</label>
              <code>{(data as any).interval}</code>
            </div>
          )}

          {processInfo?.registered && (
            <div className="source-info">
              <h4>Source</h4>
              {processInfo.class && (
                <div className="inspector-field">
                  <label>Class</label>
                  <code>{processInfo.class}</code>
                </div>
              )}
              {processInfo.source_file && (
                <div className="inspector-field">
                  <label>File</label>
                  <code className="source-path" title={processInfo.source_file}>
                    {processInfo.source_file}{processInfo.source_line ? `:${processInfo.source_line}` : ""}
                  </code>
                </div>
              )}
            </div>
          )}

          {/* Input Ports with wiring */}
          <h4>Input Ports</h4>
          {((data as any).inputPorts ?? []).map((p: string) => {
            const key = `in:${p}`;
            const currentWire = wireEdits[key] ?? "";
            const typeStr = inputTypes[p] != null ? String(inputTypes[p]) : null;
            return (
              <div className="wire-field" key={key}>
                <div className="wire-port-name">
                  {p}
                  {typeStr && <code className="port-type">{typeStr}</code>}
                </div>
                <div className="wire-edit-row">
                  <input
                    className="wire-input"
                    value={currentWire}
                    onChange={(e) => setWireEdits({ ...wireEdits, [key]: e.target.value })}
                    placeholder="target/path"
                    onKeyDown={(e) => e.key === "Enter" && handleRewire(p, "inputs")}
                  />
                  <button className="wire-btn" onClick={() => handleRewire(p, "inputs")} title="Update wire">Wire</button>
                </div>
              </div>
            );
          })}

          {/* Output Ports with wiring */}
          <h4>Output Ports</h4>
          {((data as any).outputPorts ?? []).map((p: string) => {
            const key = `out:${p}`;
            const currentWire = wireEdits[key] ?? "";
            const typeStr = outputTypes[p] != null ? String(outputTypes[p]) : null;
            return (
              <div className="wire-field" key={key}>
                <div className="wire-port-name">
                  {p}
                  {typeStr && <code className="port-type">{typeStr}</code>}
                </div>
                <div className="wire-edit-row">
                  <input
                    className="wire-input"
                    value={currentWire}
                    onChange={(e) => setWireEdits({ ...wireEdits, [key]: e.target.value })}
                    placeholder="target/path"
                    onKeyDown={(e) => e.key === "Enter" && handleRewire(p, "outputs")}
                  />
                  <button className="wire-btn" onClick={() => handleRewire(p, "outputs")} title="Update wire">Wire</button>
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

          {/* Update function */}
          {processInfo?.update_signature && (
            <div className="inspector-section">
              <h4>
                Update Function
                {processInfo.update_source && (
                  <button className="toggle-source-btn" onClick={() => setShowUpdateSource(!showUpdateSource)}>
                    {showUpdateSource ? "Hide" : "Show"}
                  </button>
                )}
              </h4>
              <div className="inspector-field">
                <label>Signature</label>
                <code className="update-sig">{processInfo.update_signature}</code>
              </div>
              {processInfo.update_docstring && (
                <p className="update-doc">{processInfo.update_docstring}</p>
              )}
              {showUpdateSource && processInfo.update_source && (
                <pre className="update-source">{processInfo.update_source}</pre>
              )}
            </div>
          )}
        </div>
      )}

      {/* Move Into (nest under another store) */}
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
              onClick={async () => {
                if (!nestTarget) return;
                try {
                  await fetch("/api/nest", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      source_path: path,
                      target_parent: nestTarget.split("/"),
                    }),
                  });
                  setNestTarget("");
                  onUpdate();
                } catch (err: any) {
                  console.error("Nest failed:", err.message);
                }
              }}
            >
              Move
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
