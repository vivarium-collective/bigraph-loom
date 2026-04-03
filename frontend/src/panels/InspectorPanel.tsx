import { useState, useEffect } from "react";
import type { Node } from "@xyflow/react";
import type { BigraphNodeData } from "../types";
import { updateNodeValue, updateNodeConfig, deleteNode, fetchProcessSource, type ProcessInfo } from "../api";

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
          <button className="hide-btn" onClick={() => onHide(node.id)} title="Hide from view">Hide</button>
          <button className="delete-btn" onClick={handleDelete} title="Delete permanently">Delete</button>
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

          <h4>Input Ports</h4>
          <ul className="port-list">
            {((data as any).inputPorts ?? []).map((p: string) => (
              <li key={p}>
                {p}
                {inputTypes[p] != null && <code className="port-type">{String(inputTypes[p])}</code>}
              </li>
            ))}
          </ul>

          <h4>Output Ports</h4>
          <ul className="port-list">
            {((data as any).outputPorts ?? []).map((p: string) => (
              <li key={p}>
                {p}
                {outputTypes[p] != null && <code className="port-type">{String(outputTypes[p])}</code>}
              </li>
            ))}
          </ul>

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
    </div>
  );
}
