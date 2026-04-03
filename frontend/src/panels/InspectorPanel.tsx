import { useState, useEffect } from "react";
import type { Node } from "@xyflow/react";
import type { BigraphNodeData } from "../types";
import {
  updateNodeValue,
  updateNodeConfig,
  deleteNode,
  fetchProcessSource,
  rewirePort,
  type ProcessInfo,
} from "../api";

interface Props {
  node: Node | null;
  onUpdate: () => void;
  onNest: (sourceId: string, targetId: string) => void;
  onHide: (nodeId: string) => void;
  groupNodes: Node[];
  allStoreNodes?: Node[];
}

export default function InspectorPanel({
  node, onUpdate, onNest, onHide, groupNodes, allStoreNodes = [],
}: Props) {
  const [editValue, setEditValue] = useState("");
  const [configEdits, setConfigEdits] = useState<Record<string, string>>({});
  const [nestTarget, setNestTarget] = useState("");
  const [processInfo, setProcessInfo] = useState<ProcessInfo | null>(null);
  const [rewireTarget, setRewireTarget] = useState<Record<string, string>>({});
  const [showUpdateSource, setShowUpdateSource] = useState(false);

  const data = node?.data as BigraphNodeData | undefined;

  useEffect(() => {
    if (!data) return;
    if (data.nodeType === "store" && "value" in data && data.value !== undefined) {
      setEditValue(String(data.value));
    }
    if (data.nodeType === "process") {
      const entries: Record<string, string> = {};
      for (const [k, v] of Object.entries(data.config)) {
        entries[k] = String(v);
      }
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
    setNestTarget("");
    setRewireTarget({});
    setShowUpdateSource(false);
  }, [node?.id]);

  if (!node || !data) {
    return (
      <div className="inspector-panel">
        <div className="inspector-empty">Click a node to inspect</div>
        <div className="inspector-hint">Double-click a group to collapse/expand</div>
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

  function handleNest() {
    if (!nestTarget || !node) return;
    onNest(node.id, nestTarget);
  }

  async function handleRewire(portName: string, direction: "inputs" | "outputs") {
    const target = rewireTarget[`${direction}:${portName}`];
    if (!target) return;
    await rewirePort({
      process_path: path,
      port_name: portName,
      direction,
      new_target: target.split("/"),
    });
    setRewireTarget((prev) => {
      const copy = { ...prev };
      delete copy[`${direction}:${portName}`];
      return copy;
    });
    onUpdate();
  }

  const nestOptions = groupNodes.filter((g) => {
    const gPath = ((g.data as any).path as string[]).join("/");
    const selfPath = path.join("/");
    return gPath !== selfPath && !gPath.startsWith(selfPath + "/");
  });

  const storePathOptions = allStoreNodes
    .filter((n) => n.type !== "process" && n.id !== node.id)
    .map((n) => (n.data as any).path as string[]);

  // Get port types from processInfo
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
          <button
            className="hide-btn"
            onClick={() => onHide(node.id)}
            title="Hide from view (not deleted)"
          >
            Hide
          </button>
          <button className="delete-btn" onClick={handleDelete} title="Delete node permanently">
            Delete
          </button>
        </div>
      </div>

      <div className="inspector-field">
        <label>Path</label>
        <code>{path.join(" / ")}</code>
      </div>

      {((data as any).isGroup || node.type === "group") && (
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

          {/* Source info */}
          {processInfo && processInfo.registered && (
            <div className="source-info">
              <h4>Source</h4>
              {processInfo.class && (
                <div className="inspector-field">
                  <label>Class</label>
                  <code>{processInfo.class}</code>
                </div>
              )}
              {processInfo.module && (
                <div className="inspector-field">
                  <label>Module</label>
                  <code>{processInfo.module}</code>
                </div>
              )}
              {processInfo.source_file && (
                <div className="inspector-field">
                  <label>File</label>
                  <code className="source-path" title={processInfo.source_file}>
                    {processInfo.source_file}
                    {processInfo.source_line ? `:${processInfo.source_line}` : ""}
                  </code>
                </div>
              )}
            </div>
          )}

          {/* Input Ports with types */}
          <h4>Input Ports</h4>
          <ul className="port-list">
            {((data as any).inputPorts ?? []).map((p: string) => {
              const portType = inputTypes[p];
              const key = `inputs:${p}`;
              return (
                <li key={p} className="port-item">
                  <div className="port-header">
                    <span className="port-name">{p}</span>
                    {portType !== undefined && (
                      <code className="port-type">{String(portType)}</code>
                    )}
                  </div>
                  <div className="port-rewire">
                    <select
                      value={rewireTarget[key] ?? ""}
                      onChange={(e) =>
                        setRewireTarget({ ...rewireTarget, [key]: e.target.value })
                      }
                    >
                      <option value="">rewire...</option>
                      {storePathOptions.map((sp) => {
                        const val = sp.join("/");
                        return <option key={val} value={val}>{val}</option>;
                      })}
                    </select>
                    {rewireTarget[key] && (
                      <button
                        className="rewire-btn"
                        onClick={() => handleRewire(p, "inputs")}
                      >
                        Wire
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Output Ports with types */}
          <h4>Output Ports</h4>
          <ul className="port-list">
            {((data as any).outputPorts ?? []).map((p: string) => {
              const portType = outputTypes[p];
              const key = `outputs:${p}`;
              return (
                <li key={p} className="port-item">
                  <div className="port-header">
                    <span className="port-name">{p}</span>
                    {portType !== undefined && (
                      <code className="port-type">{String(portType)}</code>
                    )}
                  </div>
                  <div className="port-rewire">
                    <select
                      value={rewireTarget[key] ?? ""}
                      onChange={(e) =>
                        setRewireTarget({ ...rewireTarget, [key]: e.target.value })
                      }
                    >
                      <option value="">rewire...</option>
                      {storePathOptions.map((sp) => {
                        const val = sp.join("/");
                        return <option key={val} value={val}>{val}</option>;
                      })}
                    </select>
                    {rewireTarget[key] && (
                      <button
                        className="rewire-btn"
                        onClick={() => handleRewire(p, "outputs")}
                      >
                        Wire
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Config schema */}
          {processInfo?.config_schema && Object.keys(processInfo.config_schema).length > 0 && (
            <div className="inspector-section">
              <h4>Config Schema</h4>
              <div className="config-schema">
                {Object.entries(processInfo.config_schema).map(([k, v]) => (
                  <div className="inspector-field" key={k}>
                    <label>{k}</label>
                    <code>{String(v)}</code>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Editable config values */}
          {Object.keys(configEdits).length > 0 && (
            <>
              <h4>Config</h4>
              {Object.entries(configEdits).map(([k, v]) => (
                <div className="inspector-field" key={k}>
                  <label>{k}</label>
                  <input
                    value={v}
                    onChange={(e) =>
                      setConfigEdits({ ...configEdits, [k]: e.target.value })
                    }
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
                  <button
                    className="toggle-source-btn"
                    onClick={() => setShowUpdateSource(!showUpdateSource)}
                  >
                    {showUpdateSource ? "Hide source" : "Show source"}
                  </button>
                )}
              </h4>
              <div className="inspector-field">
                <label>Signature</label>
                <code className="update-sig">{processInfo.update_signature}</code>
              </div>
              {processInfo.update_docstring && (
                <div className="inspector-field">
                  <label>Description</label>
                  <p className="update-doc">{processInfo.update_docstring}</p>
                </div>
              )}
              {showUpdateSource && processInfo.update_source && (
                <pre className="update-source">{processInfo.update_source}</pre>
              )}
            </div>
          )}
        </div>
      )}

      {/* Nest controls */}
      {nestOptions.length > 0 && (
        <div className="inspector-section">
          <h4>Move Into</h4>
          <div className="inspector-field">
            <select value={nestTarget} onChange={(e) => setNestTarget(e.target.value)}>
              <option value="">— select parent —</option>
              {nestOptions.map((g) => (
                <option key={g.id} value={g.id}>
                  {((g.data as any).path as string[]).join(" / ")}
                </option>
              ))}
            </select>
            <button onClick={handleNest} disabled={!nestTarget}>
              Nest
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
