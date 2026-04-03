import { useState, useEffect } from "react";

const BASE = "/api";

interface Props {
  storePaths: string[][];
  onUpdate: () => void;
}

interface RegistryEntry {
  name: string;
  address: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
}

export default function EditPanel({ storePaths, onUpdate }: Props) {
  const [mode, setMode] = useState<"store" | "registry" | "custom">("store");
  const [registry, setRegistry] = useState<RegistryEntry[]>([]);
  const [selectedProcess, setSelectedProcess] = useState<RegistryEntry | null>(null);

  // Store form
  const [storeName, setStoreName] = useState("");
  const [storeParent, setStoreParent] = useState("");
  const [storeValue, setStoreValue] = useState("");
  const [storeIsGroup, setStoreIsGroup] = useState(false);

  // Registry process form
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

  useEffect(() => {
    fetch(`${BASE}/registry`)
      .then((r) => r.json())
      .then((d) => setRegistry(d.processes ?? []))
      .catch(() => {});
  }, []);

  const pathOptions = storePaths.map((p) => p.join("/"));

  function selectProcess(entry: RegistryEntry) {
    setSelectedProcess(entry);
    setRegName(entry.name.toLowerCase().replace(/\s+/g, "_"));
    const wi: Record<string, string> = {};
    for (const port of Object.keys(entry.inputs)) wi[port] = "";
    setRegInputs(wi);
    const wo: Record<string, string> = {};
    for (const port of Object.keys(entry.outputs)) wo[port] = "";
    setRegOutputs(wo);
  }

  async function handleAddStore() {
    if (!storeName) return;
    const path = storeParent ? [...storeParent.split("/"), storeName] : [storeName];
    let value: unknown = storeIsGroup ? {} : storeValue;
    if (!storeIsGroup) {
      const num = Number(storeValue);
      if (!isNaN(num) && storeValue.trim() !== "") value = num;
      else if (storeValue === "true") value = true;
      else if (storeValue === "false") value = false;
    }
    await fetch(`${BASE}/store`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, value }),
    });
    onUpdate();
    setStoreName("");
    setStoreValue("");
  }

  async function handleAddRegistryProcess() {
    if (!selectedProcess || !regName) return;
    const path = regParent ? [...regParent.split("/"), regName] : [regName];
    const inputs: Record<string, string[]> = {};
    for (const [port, wire] of Object.entries(regInputs)) {
      inputs[port] = wire ? wire.split("/") : [];
    }
    const outputs: Record<string, string[]> = {};
    for (const [port, wire] of Object.entries(regOutputs)) {
      outputs[port] = wire ? wire.split("/") : [];
    }
    await fetch(`${BASE}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path,
        process_type: "process",
        address: selectedProcess.address,
        inputs,
        outputs,
      }),
    });
    onUpdate();
    setSelectedProcess(null);
    setRegName("");
  }

  async function handleAddCustomProcess() {
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
    await fetch(`${BASE}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path,
        process_type: customType,
        address: customAddress || `local:${customName}`,
        config,
        inputs,
        outputs,
      }),
    });
    onUpdate();
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
          <>
            <div className="registry-list">
              {registry.map((entry) => (
                <div
                  key={entry.name}
                  className={`registry-item ${selectedProcess?.name === entry.name ? "selected" : ""}`}
                  onClick={() => selectProcess(entry)}
                >
                  <span className="registry-item-name">{entry.name}</span>
                  <span className="registry-item-ports">
                    {Object.keys(entry.inputs).length}in/{Object.keys(entry.outputs).length}out
                  </span>
                </div>
              ))}
              {registry.length === 0 && <div className="registry-empty">No processes in Core</div>}
            </div>
            {selectedProcess && (
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
                {Object.keys(selectedProcess.inputs).length > 0 && (
                  <>
                    <h4>Wire Inputs</h4>
                    {Object.entries(selectedProcess.inputs).map(([port, type]) => (
                      <div className="edit-field" key={port}>
                        <label>{port} <code>{String(type)}</code></label>
                        <input
                          placeholder="target/path"
                          value={regInputs[port] || ""}
                          onChange={(e) => setRegInputs({ ...regInputs, [port]: e.target.value })}
                        />
                      </div>
                    ))}
                  </>
                )}
                {Object.keys(selectedProcess.outputs).length > 0 && (
                  <>
                    <h4>Wire Outputs</h4>
                    {Object.entries(selectedProcess.outputs).map(([port, type]) => (
                      <div className="edit-field" key={port}>
                        <label>{port} <code>{String(type)}</code></label>
                        <input
                          placeholder="target/path"
                          value={regOutputs[port] || ""}
                          onChange={(e) => setRegOutputs({ ...regOutputs, [port]: e.target.value })}
                        />
                      </div>
                    ))}
                  </>
                )}
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
