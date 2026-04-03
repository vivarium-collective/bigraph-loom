import { useState, useEffect } from "react";
import { fetchRegistry, addProcess, addStore } from "../api";

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

export default function AddPanel({ storePaths, onUpdate }: Props) {
  const [mode, setMode] = useState<"process" | "store">("process");
  const [registry, setRegistry] = useState<RegistryEntry[]>([]);
  const [selectedProcess, setSelectedProcess] = useState<RegistryEntry | null>(null);

  // Process form
  const [processName, setProcessName] = useState("");
  const [parentPath, setParentPath] = useState("");
  const [wireInputs, setWireInputs] = useState<Record<string, string>>({});
  const [wireOutputs, setWireOutputs] = useState<Record<string, string>>({});

  // Store form
  const [storeName, setStoreName] = useState("");
  const [storeParent, setStoreParent] = useState("");
  const [storeValue, setStoreValue] = useState("");
  const [storeIsGroup, setStoreIsGroup] = useState(false);

  useEffect(() => {
    fetchRegistry().then(setRegistry);
  }, []);

  function selectProcess(entry: RegistryEntry) {
    setSelectedProcess(entry);
    setProcessName(entry.name.toLowerCase().replace(/\s+/g, "_"));
    const wi: Record<string, string> = {};
    for (const port of Object.keys(entry.inputs)) wi[port] = "";
    setWireInputs(wi);
    const wo: Record<string, string> = {};
    for (const port of Object.keys(entry.outputs)) wo[port] = "";
    setWireOutputs(wo);
  }

  async function handleAddProcess() {
    if (!selectedProcess || !processName) return;
    const path = parentPath
      ? [...parentPath.split("/"), processName]
      : [processName];
    const inputs: Record<string, string[]> = {};
    for (const [port, wire] of Object.entries(wireInputs)) {
      if (wire) inputs[port] = wire.split("/");
    }
    const outputs: Record<string, string[]> = {};
    for (const [port, wire] of Object.entries(wireOutputs)) {
      if (wire) outputs[port] = wire.split("/");
    }
    await addProcess({
      path,
      process_type: "process",
      address: selectedProcess.address,
      inputs,
      outputs,
    });
    onUpdate();
    setSelectedProcess(null);
    setProcessName("");
  }

  async function handleAddStore() {
    if (!storeName) return;
    const path = storeParent
      ? [...storeParent.split("/"), storeName]
      : [storeName];
    let value: unknown = storeIsGroup ? {} : storeValue;
    if (!storeIsGroup) {
      const num = Number(storeValue);
      if (!isNaN(num) && storeValue.trim() !== "") value = num;
      else if (storeValue === "true") value = true;
      else if (storeValue === "false") value = false;
    }
    await addStore({ path, value });
    onUpdate();
    setStoreName("");
    setStoreValue("");
  }

  const pathOptions = storePaths.map((p) => p.join("/"));

  return (
    <div className="add-panel">
      <div className="add-panel-tabs">
        <button
          className={mode === "process" ? "tab-active" : ""}
          onClick={() => setMode("process")}
        >
          + Process
        </button>
        <button
          className={mode === "store" ? "tab-active" : ""}
          onClick={() => setMode("store")}
        >
          + Store
        </button>
      </div>

      {mode === "process" && (
        <div className="add-panel-body">
          <h4>Select Process Type</h4>
          <div className="registry-list">
            {registry.map((entry) => (
              <div
                key={entry.name}
                className={`registry-item ${selectedProcess?.name === entry.name ? "selected" : ""}`}
                onClick={() => selectProcess(entry)}
              >
                <div className="registry-item-name">{entry.name}</div>
                <div className="registry-item-ports">
                  {Object.keys(entry.inputs).length}in / {Object.keys(entry.outputs).length}out
                </div>
              </div>
            ))}
            {registry.length === 0 && (
              <div className="registry-empty">No processes registered in Core</div>
            )}
          </div>

          {selectedProcess && (
            <div className="wire-form">
              <div className="inspector-field">
                <label>Name</label>
                <input
                  value={processName}
                  onChange={(e) => setProcessName(e.target.value)}
                />
              </div>
              <div className="inspector-field">
                <label>Parent path (empty = root)</label>
                <select
                  value={parentPath}
                  onChange={(e) => setParentPath(e.target.value)}
                >
                  <option value="">— root —</option>
                  {pathOptions.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              {Object.keys(selectedProcess.inputs).length > 0 && (
                <>
                  <h4>Wire Inputs</h4>
                  {Object.entries(selectedProcess.inputs).map(([port, type]) => (
                    <div className="inspector-field" key={port}>
                      <label>{port} <code>{String(type)}</code></label>
                      <input
                        placeholder="target/path"
                        value={wireInputs[port] || ""}
                        onChange={(e) =>
                          setWireInputs({ ...wireInputs, [port]: e.target.value })
                        }
                      />
                    </div>
                  ))}
                </>
              )}

              {Object.keys(selectedProcess.outputs).length > 0 && (
                <>
                  <h4>Wire Outputs</h4>
                  {Object.entries(selectedProcess.outputs).map(([port, type]) => (
                    <div className="inspector-field" key={port}>
                      <label>{port} <code>{String(type)}</code></label>
                      <input
                        placeholder="target/path"
                        value={wireOutputs[port] || ""}
                        onChange={(e) =>
                          setWireOutputs({ ...wireOutputs, [port]: e.target.value })
                        }
                      />
                    </div>
                  ))}
                </>
              )}

              <button onClick={handleAddProcess}>Add Process</button>
            </div>
          )}
        </div>
      )}

      {mode === "store" && (
        <div className="add-panel-body">
          <div className="inspector-field">
            <label>Name</label>
            <input
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              placeholder="store_name"
            />
          </div>
          <div className="inspector-field">
            <label>Parent path (empty = root)</label>
            <select
              value={storeParent}
              onChange={(e) => setStoreParent(e.target.value)}
            >
              <option value="">— root —</option>
              {pathOptions.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="inspector-field">
            <label>
              <input
                type="checkbox"
                checked={storeIsGroup}
                onChange={(e) => setStoreIsGroup(e.target.checked)}
              />{" "}
              Group (container for nested nodes)
            </label>
          </div>
          {!storeIsGroup && (
            <div className="inspector-field">
              <label>Value</label>
              <input
                value={storeValue}
                onChange={(e) => setStoreValue(e.target.value)}
                placeholder="0.0"
              />
            </div>
          )}
          <button onClick={handleAddStore}>Add Store</button>
        </div>
      )}
    </div>
  );
}
