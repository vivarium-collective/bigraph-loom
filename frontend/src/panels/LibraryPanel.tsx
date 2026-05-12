import { useState, useEffect, useCallback } from "react";
import {
  fetchLibrary,
  loadFromLibrary,
  saveToLibrary,
  deleteFromLibrary,
  loadLibraryEntryState,
  type LibraryEntry,
  type ImportWarning,
  type ViewState,
  type AnyDict,
} from "../api";

interface Props {
  onWarnings: (warnings: ImportWarning[]) => void;
  getViewState: () => ViewState;
  restoreViewState: (vs: ViewState) => void;
  pbgState: AnyDict;
  onLibraryLoad: (name: string) => { ok: boolean; warnings?: ImportWarning[]; view_state?: ViewState | null };
}

export default function LibraryPanel({ onWarnings, getViewState, restoreViewState, pbgState, onLibraryLoad }: Props) {
  const [files, setFiles] = useState<LibraryEntry[]>([]);
  const [saveName, setSaveName] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(() => {
    const entries = fetchLibrary();
    setFiles(entries);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function handleLoad(name: string) {
    const result = loadFromLibrary(name);
    if (result.ok) {
      const state = loadLibraryEntryState(name);
      if (state) {
        onLibraryLoad(name);
        if (result.view_state) {
          restoreViewState(result.view_state);
        }
        setStatus(`Loaded "${name}"`);
        setTimeout(() => setStatus(null), 3000);
      }
    } else {
      setStatus(`Error: Not found "${name}"`);
    }
  }

  function handleSave() {
    if (!saveName.trim()) return;
    const viewState = getViewState();
    saveToLibrary(saveName.trim(), pbgState, viewState);
    setSaveName("");
    setStatus(`Saved "${saveName.trim()}" with view`);
    setTimeout(() => setStatus(null), 3000);
    refresh();
  }

  function handleDelete(name: string) {
    if (!confirm(`Delete saved bigraph "${name}"?`)) return;
    deleteFromLibrary(name);
    refresh();
  }

  const examples = files.filter((f) => f.source === "example");
  const saved = files.filter((f) => f.source === "saved");

  return (
    <div className="library-panel">
      <div className="library-header">
        <h4>Bigraph Library</h4>
      </div>

      {status && <div className="library-status">{status}</div>}

      <div className="library-save">
        <input
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          placeholder="Save current view as..."
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
        />
        <button onClick={handleSave} disabled={!saveName.trim()}>
          Save
        </button>
      </div>

      <div className="library-section">
        <h4>Examples</h4>
        {examples.length === 0 && (
          <div className="library-empty">No examples available</div>
        )}
        {examples.map((f) => (
          <div className="library-item" key={f.name}>
            <span className="library-item-name" title={f.name}>
              {f.name}
              {f.has_view && <span className="view-badge" title="Has saved view">view</span>}
            </span>
            <div className="library-item-actions">
              <button className="library-load-btn" onClick={() => handleLoad(f.name)}>
                Load
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="library-section">
        <h4>Saved</h4>
        {saved.length === 0 && (
          <div className="library-empty">No saved bigraphs yet</div>
        )}
        {saved.map((f) => (
          <div className="library-item" key={f.name}>
            <span className="library-item-name" title={f.name}>
              {f.name}
              {f.has_view && <span className="view-badge" title="Has saved view">view</span>}
            </span>
            <div className="library-item-actions">
              <button className="library-load-btn" onClick={() => handleLoad(f.name)}>
                Load
              </button>
              <button className="library-delete-btn" onClick={() => handleDelete(f.name)}>
                Del
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
