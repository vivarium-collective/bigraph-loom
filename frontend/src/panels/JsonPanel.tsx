import { useState, useEffect, useCallback } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLang } from "@codemirror/lang-json";

const BASE = "/api";

interface Props {
  onUpdate: () => void;
}

export default function JsonPanel({ onUpdate }: Props) {
  const [code, setCode] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [status, setStatus] = useState<{
    type: "success" | "error" | "warning";
    message: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  // Load current state on mount
  useEffect(() => {
    loadState();
  }, []);

  async function loadState() {
    try {
      const res = await fetch(`${BASE}/state`);
      const data = await res.json();
      const formatted = JSON.stringify(data, null, 2);
      setCode(formatted);
      setParseError(null);
    } catch (e: any) {
      setStatus({ type: "error", message: `Failed to load: ${e.message}` });
    }
  }

  const handleChange = useCallback((value: string) => {
    setCode(value);
    setStatus(null);
    // Live parse check
    try {
      JSON.parse(value);
      setParseError(null);
    } catch (e: any) {
      setParseError(e.message);
    }
  }, []);

  async function handleValidate() {
    if (parseError) {
      setStatus({ type: "error", message: `Invalid JSON: ${parseError}` });
      return;
    }
    setLoading(true);
    try {
      const parsed = JSON.parse(code);
      const state = parsed.state ?? parsed;
      const schema = parsed.schema ?? null;

      const res = await fetch(`${BASE}/state`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, schema_: schema, run_check: true }),
      });
      const data = await res.json();

      if (data.errors?.length) {
        setStatus({ type: "error", message: data.errors.join("; ") });
      } else if (data.warnings?.length) {
        setStatus({
          type: "warning",
          message: `Valid (${data.warnings.length} unregistered processes)`,
        });
      } else {
        setStatus({ type: "success", message: "Valid" });
      }
    } catch (e: any) {
      setStatus({ type: "error", message: e.message });
    }
    setLoading(false);
  }

  async function handleApply() {
    if (parseError) {
      setStatus({ type: "error", message: `Invalid JSON: ${parseError}` });
      return;
    }
    setLoading(true);
    try {
      const parsed = JSON.parse(code);
      const state = parsed.state ?? parsed;
      const schema = parsed.schema ?? null;

      const res = await fetch(`${BASE}/state`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, schema_: schema, run_check: false }),
      });
      const data = await res.json();

      if (data.ok) {
        const warnCount = data.warnings?.length ?? 0;
        setStatus({
          type: warnCount > 0 ? "warning" : "success",
          message: warnCount > 0
            ? `Applied (${warnCount} unregistered processes)`
            : "Applied",
        });
        onUpdate();
      } else {
        setStatus({ type: "error", message: data.errors?.join("; ") ?? "Failed" });
      }
    } catch (e: any) {
      setStatus({ type: "error", message: e.message });
    }
    setLoading(false);
  }

  return (
    <div className="json-panel">
      <div className="json-panel-header">
        <h4>JSON Editor</h4>
        <div className="json-panel-actions">
          <button onClick={loadState} className="json-btn json-btn-reload" title="Reload from server">
            Reload
          </button>
          <button
            onClick={handleValidate}
            className="json-btn json-btn-validate"
            disabled={!!parseError || loading}
            title="Validate against schema"
          >
            Validate
          </button>
          <button
            onClick={handleApply}
            className="json-btn json-btn-apply"
            disabled={!!parseError || loading}
            title="Apply changes to graph"
          >
            Apply
          </button>
        </div>
      </div>

      {/* Status bar */}
      {(parseError || status) && (
        <div
          className={`json-status ${
            parseError
              ? "json-status-error"
              : status?.type === "error"
                ? "json-status-error"
                : status?.type === "warning"
                  ? "json-status-warning"
                  : "json-status-success"
          }`}
        >
          {parseError ? `Parse error: ${parseError}` : status?.message}
        </div>
      )}

      {/* Editor */}
      <div className="json-editor-container">
        <CodeMirror
          value={code}
          onChange={handleChange}
          extensions={[jsonLang()]}
          theme="dark"
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: false,
          }}
          style={{ height: "100%", fontSize: "12px" }}
        />
      </div>
    </div>
  );
}
