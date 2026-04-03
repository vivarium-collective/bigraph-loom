import { useState, useEffect, useCallback } from "react";
import {
  fetchLibrary,
  loadFromLibrary,
  saveToLibrary,
  deleteFromLibrary,
  type LibraryEntry,
  type ImportWarning,
  type ViewState,
} from "../api";

interface Props {
  onUpdate: () => void;
  onWarnings: (warnings: ImportWarning[]) => void;
  getViewState: () => ViewState;
  restoreViewState: (vs: ViewState) => void;
}

export default function LibraryPanel({ onUpdate, onWarnings, getViewState, restoreViewState }: Props) {
  const [files, setFiles] = useState<LibraryEntry[]>([]);
  const [saveName, setSaveName] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const entries = await fetchLibrary();
    setFiles(entries);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleLoad(name: string) {
    try {
      const result = await loadFromLibrary(name);
      if (result.warnings?.length) {
        onWarnings(result.warnings);
      }
      // Restore view state if available
      if (result.view_state) {
        restoreViewState(result.view_state);
      }
      setStatus(`Loaded "${name}"`);
      setTimeout(() => setStatus(null), 3000);
      onUpdate();
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
  }

  async function handleSave() {
    if (!saveName.trim()) return;
    try {
      const viewState = getViewState();
      await saveToLibrary(saveName.trim(), viewState);
      setSaveName("");
      setStatus(`Saved "${saveName.trim()}" with view`);
      setTimeout(() => setStatus(null), 3000);
      refresh();
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
  }

  async function handleDelete(name: string) {
    if (!confirm(`Delete saved bigraph "${name}"?`)) return;
    try {
      await deleteFromLibrary(name);
      refresh();
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    }
  }

  const examples = files.filter((f) => f.source === "example");
  const saved = files.filter((f) => f.source === "saved");

  return (
    <div className="library-panel">
      <div className="library-header">
        <h4>Bigraph Library</h4>
      </div>

      {status && <div className="library-status">{status}</div>}

      {/* Save current with view state */}
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

      {/* Examples */}
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

      {/* Saved */}
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
