import { useState } from "react";

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

export default function EditPanel({ storePaths, onAddStore, onAddProcess }: Props) {
  const [mode, setMode] = useState<"store" | "registry" | "custom">("store");

  // Store form
  const [storeName, setStoreName] = useState("");
  const [storeParent, setStoreParent] = useState("");
  const [storeValue, setStoreValue] = useState("");
  const [storeIsGroup, setStoreIsGroup] = useState(false);

  // Registry process form (placeholder — WP4 adds registry palette)
  const [regName, setRegName] = useState("");
  const [regParent, setRegParent] = useState("");
  const [regInputs, setRegInputs] = useState<Record<string, string>>({});
  const [regOutputs, setRegOutputs] = useState<Record<string, string>>({});

  // Custom process form
  const [customName, setCustomName] = useState("");
  const [customParent, setCustomParent] = useState("");
  const [customAddress, setCustomAddress] = useState("");
  const [customType, setCustomType] = useState("process");
  const [customInputPorts, setCustomInputPorts] = useState("");
  const [customOutputPorts, setCustomOutputPorts] = useState("");
  const [customConfig, setCustomConfig] = useState("{}");

  const pathOptions = storePaths.map((p) => p.join("/"));

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
    if (!regName) return;
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
      address: "local:custom",
      inputs,
      outputs,
    });
    setRegName("");
    setRegInputs({});
    setRegOutputs({});
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
          <div className="registry-list">
            <div className="registry-empty">
              Registry palette will be available in a future update (WP4)
            </div>
          </div>
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
