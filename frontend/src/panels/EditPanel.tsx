import { useState, useEffect, useRef } from "react";
import { SmsApiComposeClient } from "../smsApi";
import type { BiGraphProcess } from "../types";

interface Props {
  storePaths: string[][];
  onAddStore: (path: string[], value: unknown) => void;
  onAddProcess: (path: string[], data: {
    address: string;
    process_type?: string;
    config?: Record<string, unknown>;
    inputs?: Record<string, string[]>;
    outputs?: Record<string, string[]>;
  }) => void;
}

/**
 * Parse a schema string like "mass:float|volume:int" into key-types.
 * Used for registry process input/output display.
 */
function parseSchemaString(s: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!s) return result;
  let depth = 0;
  let current = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[") { depth++; current += ch; }
    else if (ch === ")" || ch === "]") { depth--; current += ch; }
    else if (ch === "|" && depth === 0) {
      const parts = current.split(":");
      if (parts.length >= 2) result[parts[0].trim()] = parts[1].trim();
      current = "";
    } else { current += ch; }
  }
  if (current.trim()) {
    const parts = current.split(":");
    if (parts.length >= 2) result[parts[0].trim()] = parts[1].trim();
  }
  return result;
}

export default function EditPanel({ storePaths, onAddStore, onAddProcess }: Props) {
  const [mode, setMode] = useState<"store" | "registry" | "custom">("store");

  // Store form
  const [storeName, setStoreName] = useState("");
  const [storeParent, setStoreParent] = useState("");
  const [storeValue, setStoreValue] = useState("");
  const [storeIsGroup, setStoreIsGroup] = useState(false);

  // Registry
  const [registry, setRegistry] = useState<BiGraphProcess[]>([]);
  const [registrySearch, setRegistrySearch] = useState("");
  const [selectedReg, setSelectedReg] = useState<BiGraphProcess | null>(null);
  const [regName, setRegName] = useState("");
  const [regParent, setRegParent] = useState("");
  const [regInputs, setRegInputs] = useState<Record<string, string>>({});
  const [regOutputs, setRegOutputs] = useState<Record<string, string>>({});
  const clientRef = useRef(new SmsApiComposeClient(
    localStorage.getItem("smsApiBaseUrl") ?? "https://sms.cam.uchc.edu",
  ));

  // Custom process form
  const [customName, setCustomName] = useState("");
  const [customParent, setCustomParent] = useState("");
  const [customAddress, setCustomAddress] = useState("");
  const [customType, setCustomType] = useState("process");
  const [customInputPorts, setCustomInputPorts] = useState("");
  const [customOutputPorts, setCustomOutputPorts] = useState("");
  const [customConfig, setCustomConfig] = useState("{}");

  useEffect(() => {
    clientRef.current.listProcesses()
      .then(setRegistry)
      .catch(() => setRegistry([]));
  }, []);

  const pathOptions = storePaths.map((p) => p.join("/"));

  function selectRegistryProcess(entry: BiGraphProcess) {
    setSelectedReg(entry);
    setRegName(entry.name.toLowerCase().replace(/\s+/g, "_"));
    const inputs = parseSchemaString(entry.inputs);
    const outputs = parseSchemaString(entry.outputs);
    const wi: Record<string, string> = {};
    for (const port of Object.keys(inputs)) wi[port] = "";
    setRegInputs(wi);
    const wo: Record<string, string> = {};
    for (const port of Object.keys(outputs)) wo[port] = "";
    setRegOutputs(wo);
  }

  function handleAddStore() {
    if (!storeName) return;
    const path = storeParent ? [...storeParent.split("/"), storeName] : [storeName];
    let value: unknown = storeIsGroup ? {} : storeValue;
    if (!storeIsGroup) {
      const num = Number(storeValue);
      if (!isNaN(num) && storeValue.trim() !== "") value = num;
      else if (storeValue === "true") value = true;
      else if (storeValue === "false") value = false;
    }
    onAddStore(path, value);
    setStoreName("");
    setStoreValue("");
  }

  function handleAddRegistryProcess() {
    if (!selectedReg || !regName) return;
    const path = regParent ? [...regParent.split("/"), regName] : [regName];
    const inputs: Record<string, string[]> = {};
    for (const [port, wire] of Object.entries(regInputs)) {
      inputs[port] = wire ? wire.split("/") : [];
    }
    const outputs: Record<string, string[]> = {};
    for (const [port, wire] of Object.entries(regOutputs)) {
      outputs[port] = wire ? wire.split("/") : [];
    }
    onAddProcess(path, {
      process_type: "process",
      address: selectedReg.name.includes(".") ? `local:${selectedReg.name}` : selectedReg.name,
      inputs,
      outputs,
    });
    setSelectedReg(null);
    setRegName("");
  }

  function handleAddCustomProcess() {
    if (!customName) return;
    const path = customParent ? [...customParent.split("/"), customName] : [customName];
    const inputs: Record<string, string[]> = {};
    for (const port of customInputPorts.split(",").map((s) => s.trim()).filter(Boolean)) {
      inputs[port] = [];
    }
    const outputs: Record<string, string[]> = {};
    for (const port of customOutputPorts.split(",").map((s) => s.trim()).filter(Boolean)) {
      outputs[port] = [];
    }
    let config: Record<string, unknown> = {};
    try { config = JSON.parse(customConfig); } catch { /* keep empty */ }
    onAddProcess(path, {
      process_type: customType,
      address: customAddress || `local:${customName}`,
      config,
      inputs,
      outputs,
    });
    setCustomName("");
    setCustomAddress("");
    setCustomInputPorts("");
    setCustomOutputPorts("");
    setCustomConfig("{}");
  }

  const filteredRegistry = registrySearch
    ? registry.filter((p) =>
        p.name.toLowerCase().includes(registrySearch.toLowerCase()),
      )
    : registry;

  return (
    <div className="edit-panel">
      <div className="edit-tabs">
        <button className={mode === "store" ? "tab-active" : ""} onClick={() => setMode("store")}>Store</button>
        <button className={mode === "registry" ? "tab-active" : ""} onClick={() => setMode("registry")}>Registry</button>
        <button className={mode === "custom" ? "tab-active" : ""} onClick={() => setMode("custom")}>Custom</button>
      </div>

      <div className="edit-body">
        {mode === "store" && (
          <>
            <div className="edit-field">
              <label>Name</label>
              <input value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="store_name" />
            </div>
            <div className="edit-field">
              <label>Parent</label>
              <select value={storeParent} onChange={(e) => setStoreParent(e.target.value)}>
                <option value="">root</option>
                {pathOptions.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="edit-field">
              <label>
                <input type="checkbox" checked={storeIsGroup} onChange={(e) => setStoreIsGroup(e.target.checked)} />
                {" "}Group (container)
              </label>
            </div>
            {!storeIsGroup && (
              <div className="edit-field">
                <label>Value</label>
                <input value={storeValue} onChange={(e) => setStoreValue(e.target.value)} placeholder="0.0" />
              </div>
            )}
            <button className="edit-submit" onClick={handleAddStore} disabled={!storeName}>Add Store</button>
          </>
        )}

        {mode === "registry" && (
          <>
            <div className="edit-field">
              <input
                className="registry-search"
                placeholder="Search processes..."
                value={registrySearch}
                onChange={(e) => setRegistrySearch(e.target.value)}
              />
            </div>
            <div className="registry-list">
              {filteredRegistry.map((entry) => (
                <div
                  key={entry.database_id}
                  className={`registry-item ${selectedReg?.database_id === entry.database_id ? "selected" : ""}`}
                  onClick={() => selectRegistryProcess(entry)}
                >
                  <span className="registry-item-name">{entry.name}</span>
                  <span className="registry-item-ports">
                    {entry.inputs ? Object.keys(parseSchemaString(entry.inputs)).length : 0}in/
                    {entry.outputs ? Object.keys(parseSchemaString(entry.outputs)).length : 0}out
                  </span>
                </div>
              ))}
              {filteredRegistry.length === 0 && (
                <div className="registry-empty">
                  {registrySearch
                    ? "No matches"
                    : registry.length === 0
                      ? "No processes found. Check the sms-api base URL."
                      : "No processes found in registry"}
                </div>
              )}
            </div>
            {selectedReg && (
              <div className="edit-wire-form">
                <div className="edit-field">
                  <label>Name</label>
                  <input value={regName} onChange={(e) => setRegName(e.target.value)} />
                </div>
                <div className="edit-field">
                  <label>Parent</label>
                  <select value={regParent} onChange={(e) => setRegParent(e.target.value)}>
                    <option value="">root</option>
                    {pathOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="edit-field">
                  <label>Address</label>
                  <code className="registry-address">
                    {selectedReg.name.includes(".") ? `local:${selectedReg.name}` : selectedReg.name}
                  </code>
                </div>
                {(() => {
                  const inputs = parseSchemaString(selectedReg.inputs);
                  return Object.keys(inputs).length > 0 ? (
                    <>
                      <h4>Wire Inputs</h4>
                      {Object.entries(inputs).map(([port, type]) => (
                        <div className="edit-field" key={port}>
                          <label>{port} <code>{type}</code></label>
                          <input
                            placeholder="target/path"
                            value={regInputs[port] || ""}
                            onChange={(e) => setRegInputs({ ...regInputs, [port]: e.target.value })}
                          />
                        </div>
                      ))}
                    </>
                  ) : null;
                })()}
                {(() => {
                  const outputs = parseSchemaString(selectedReg.outputs);
                  return Object.keys(outputs).length > 0 ? (
                    <>
                      <h4>Wire Outputs</h4>
                      {Object.entries(outputs).map(([port, type]) => (
                        <div className="edit-field" key={port}>
                          <label>{port} <code>{type}</code></label>
                          <input
                            placeholder="target/path"
                            value={regOutputs[port] || ""}
                            onChange={(e) => setRegOutputs({ ...regOutputs, [port]: e.target.value })}
                          />
                        </div>
                      ))}
                    </>
                  ) : null;
                })()}
                <button className="edit-submit" onClick={handleAddRegistryProcess} disabled={!regName}>Add Process</button>
              </div>
            )}
          </>
        )}

        {mode === "custom" && (
          <>
            <div className="edit-field">
              <label>Name</label>
              <input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="my_process" />
            </div>
            <div className="edit-field">
              <label>Address</label>
              <input value={customAddress} onChange={(e) => setCustomAddress(e.target.value)} placeholder="local:MyProcess" />
            </div>
            <div className="edit-field">
              <label>Type</label>
              <select value={customType} onChange={(e) => setCustomType(e.target.value)}>
                <option value="process">process</option>
                <option value="step">step</option>
              </select>
            </div>
            <div className="edit-field">
              <label>Parent</label>
              <select value={customParent} onChange={(e) => setCustomParent(e.target.value)}>
                <option value="">root</option>
                {pathOptions.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="edit-field">
              <label>Input ports (comma-separated)</label>
              <input value={customInputPorts} onChange={(e) => setCustomInputPorts(e.target.value)} placeholder="substrate, enzymes" />
            </div>
            <div className="edit-field">
              <label>Output ports (comma-separated)</label>
              <input value={customOutputPorts} onChange={(e) => setCustomOutputPorts(e.target.value)} placeholder="product, biomass" />
            </div>
            <div className="edit-field">
              <label>Config (JSON)</label>
              <textarea
                className="edit-config"
                value={customConfig}
                onChange={(e) => setCustomConfig(e.target.value)}
                rows={3}
              />
            </div>
            <button className="edit-submit" onClick={handleAddCustomProcess} disabled={!customName}>Add Process</button>
          </>
        )}
      </div>
    </div>
  );
}
