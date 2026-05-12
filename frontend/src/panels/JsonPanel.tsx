import { useState, useCallback, useEffect } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLang } from "@codemirror/lang-json";
import type { AnyDict } from "../api";

interface Props {
  pbgState: AnyDict;
  onApplyState: (state: AnyDict) => void;
}

export default function JsonPanel({ pbgState, onApplyState }: Props) {
  const [code, setCode] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [status, setStatus] = useState<{
    type: "success" | "error" | "warning";
    message: string;
  } | null>(null);

  useEffect(() => {
    const formatted = JSON.stringify(pbgState, null, 2);
    setCode(formatted);
    setParseError(null);
    setStatus(null);
  }, [pbgState]);

  const handleChange = useCallback((value: string) => {
    setCode(value);
    setStatus(null);
    try {
      JSON.parse(value);
      setParseError(null);
    } catch (e: any) {
      setParseError(e.message);
    }
  }, []);

  function handleReload() {
    const formatted = JSON.stringify(pbgState, null, 2);
    setCode(formatted);
    setParseError(null);
    setStatus({ type: "success", message: "Reloaded from current state" });
    setTimeout(() => setStatus(null), 2000);
  }

  function handleValidate() {
    if (parseError) {
      setStatus({ type: "error", message: `Invalid JSON: ${parseError}` });
      return;
    }
    try {
      JSON.parse(code);
      setStatus({ type: "success", message: "Valid JSON" });
    } catch (e: any) {
      setStatus({ type: "error", message: e.message });
    }
  }

  function handleApply() {
    if (parseError) {
      setStatus({ type: "error", message: `Invalid JSON: ${parseError}` });
      return;
    }
    try {
      const parsed = JSON.parse(code);
      const state = parsed.state ?? parsed;
      onApplyState(state);
      setStatus({ type: "success", message: "Applied" });
      setTimeout(() => setStatus(null), 2000);
    } catch (e: any) {
      setStatus({ type: "error", message: e.message });
    }
  }

  return (
    <div className="json-panel">
      <div className="json-panel-header">
        <h4>JSON Editor</h4>
        <div className="json-panel-actions">
          <button onClick={handleReload} className="json-btn json-btn-reload" title="Reload from current state">
            Reload
          </button>
          <button
            onClick={handleValidate}
            className="json-btn json-btn-validate"
            disabled={!!parseError}
            title="Validate JSON syntax"
          >
            Validate
          </button>
          <button
            onClick={handleApply}
            className="json-btn json-btn-apply"
            disabled={!!parseError}
            title="Apply changes to graph"
          >
            Apply
          </button>
        </div>
      </div>

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
