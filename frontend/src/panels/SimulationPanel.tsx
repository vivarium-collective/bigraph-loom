import { useState, useEffect, useRef } from "react";
import { SmsApiComposeClient } from "../smsApi";
import { isProcess, type AnyDict } from "../convert";
import { DEFAULT_SMS_API_BASE_URL, getSmsApiBaseUrl } from "../config";
import type { ComposeHpcRun, ComposeJobStatus } from "../types";
import ResultsViewer from "./ResultsViewer";

// ── History persistence ──────────────────────────────────────────────────────

interface HistoryEntry {
  simId: number;
  experimentId: number;
  status: ComposeJobStatus | null;
  timestamp: number;
  label: string;
}

const HISTORY_KEY = "bgloom_sim_history";

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
}

// ── Modal ────────────────────────────────────────────────────────────────────

interface SubmissionModalProps {
  open: boolean;
  baseUrl: string;
  intervalTime: number;
  summary: { processes: number; stores: number; wires: number } | null;
  onBaseUrlChange: (url: string) => void;
  onIntervalChange: (t: number) => void;
  onSubmit: () => void;
  onClose: () => void;
}

function SubmissionModal({
  open,
  baseUrl,
  intervalTime,
  summary,
  onBaseUrlChange,
  onIntervalChange,
  onSubmit,
  onClose,
}: SubmissionModalProps) {
  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>Run Simulation</h3>

        <div className="edit-field">
          <label>sms-api Base URL</label>
          <input
            value={baseUrl}
            onChange={(e) => onBaseUrlChange(e.target.value)}
            placeholder="https://sms.cam.uchc.edu"
          />
        </div>

        <div className="edit-field">
          <label>Interval Time: {intervalTime.toFixed(1)}s</label>
          <input
            type="range"
            min={0.1}
            max={100}
            step={0.1}
            value={intervalTime}
            onChange={(e) => onIntervalChange(Number(e.target.value))}
          />
        </div>

        {summary && (
          <div className="sim-summary">
            <strong>PBG Summary</strong>
            <span>{summary.processes} processes</span>
            <span>{summary.stores} stores</span>
            <span>{summary.wires} wires</span>
          </div>
        )}

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={onSubmit}>
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Simulation Panel ─────────────────────────────────────────────────────────

interface Props {
  pbgState: AnyDict;
}

export default function SimulationPanel({ pbgState }: Props) {
  const [baseUrl, setBaseUrl] = useState(() => getSmsApiBaseUrl());
  const [intervalTime, setIntervalTime] = useState(1.0);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [currentRun, setCurrentRun] = useState<ComposeHpcRun | null>(null);
  const [simId, setSimId] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  const [viewResultId, setViewResultId] = useState<number | null>(null);

  const clientRef = useRef(new SmsApiComposeClient(baseUrl));
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  // Keep client base URL in sync
  useEffect(() => {
    localStorage.setItem("smsApiBaseUrl", baseUrl);
    clientRef.current = new SmsApiComposeClient(baseUrl);
  }, [baseUrl]);

  // Summary from current PBG state
  const summary = (() => {
    const flow = bigraphToFlowSummary(pbgState);
    return flow;
  })();

  // Elapsed timer
  useEffect(() => {
    if (!startTimeRef.current) return;
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [simId, currentRun?.status]);

  // Polling
  useEffect(() => {
    if (!simId) return;

    const poll = async () => {
      try {
        const run = await clientRef.current.getSimulationStatus(simId);
        setCurrentRun(run);

        if (run.status === "completed" || run.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          addToHistory(simId, run);
        }
      } catch {
        // Keep polling
      }
    };

    poll();
    pollRef.current = setInterval(poll, 5000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [simId]);

  function addToHistory(id: number, run: ComposeHpcRun) {
    const entry: HistoryEntry = {
      simId: id,
      experimentId: run.database_id,
      status: run.status,
      timestamp: Date.now(),
      label: `Sim #${id}`,
    };
    setHistory((prev) => {
      const next = [entry, ...prev.filter((h) => h.simId !== id)].slice(0, 50);
      saveHistory(next);
      return next;
    });
  }

  async function handleSubmit() {
    setSubmitting(true);
    startTimeRef.current = Date.now();
    setElapsed(0);

    try {
      const blob = new Blob([JSON.stringify(pbgState, null, 2)], {
        type: "application/json",
      });
      const exp = await clientRef.current.submitSimulation(blob, intervalTime);
      setSimId(exp.simulation_database_id);
      setShowModal(false);
    } catch (err: any) {
      setCurrentRun({
        database_id: 0,
        slurmjobid: 0,
        correlation_id: "",
        job_type: "simulation",
        sim_id: null,
        simulator_id: null,
        status: "failed",
        start_time: null,
        end_time: null,
        error_message: err.message,
      });
    } finally {
      setSubmitting(false);
    }
  }

  function resetRun() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setSimId(null);
    setCurrentRun(null);
    setElapsed(0);
    startTimeRef.current = 0;
  }

  function formatElapsed(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  const status = currentRun?.status;

  return (
    <div className="sim-panel">
      {viewResultId && (
        <ResultsViewer simId={viewResultId} onClose={() => setViewResultId(null)} />
      )}
      <SubmissionModal
        open={showModal}
        baseUrl={baseUrl}
        intervalTime={intervalTime}
        summary={summary}
        onBaseUrlChange={setBaseUrl}
        onIntervalChange={setIntervalTime}
        onSubmit={handleSubmit}
        onClose={() => setShowModal(false)}
      />

      <div className="panel-header-row">
        <h4>Simulation</h4>
        <button
          className="header-btn"
          onClick={() => setShowModal(true)}
          disabled={submitting}
        >
          {submitting ? "Submitting..." : "Run New"}
        </button>
      </div>

      {/* Status display */}
      <div className="sim-status-area">
        {submitting && (
          <div className="sim-status sim-status-submitting">
            <span className="sim-spinner" />
            Submitting simulation...
          </div>
        )}

        {status === "queued" && (
          <div className="sim-status sim-status-queued">
            <span className="sim-badge sim-badge-yellow">Queued</span>
            <span className="sim-id">ID: {simId}</span>
            <span className="sim-elapsed">{formatElapsed(elapsed)}</span>
          </div>
        )}

        {status === "running" && (
          <div className="sim-status sim-status-running">
            <span className="sim-badge sim-badge-blue">Running</span>
            <span className="sim-id">ID: {simId}</span>
            <span className="sim-elapsed">{formatElapsed(elapsed)}</span>
          </div>
        )}

        {status === "completed" && (
          <div className="sim-status sim-status-completed">
            <span className="sim-badge sim-badge-green">Completed</span>
            <span className="sim-id">ID: {simId}</span>
            <div className="sim-actions">
              <button className="btn-sm">Download Results</button>
              <button
                className="btn-sm"
                onClick={() => setViewResultId(simId!)}
              >
                View Results
              </button>
            </div>
          </div>
        )}

        {status === "failed" && (
          <div className="sim-status sim-status-failed">
            <span className="sim-badge sim-badge-red">Failed</span>
            <span className="sim-id">ID: {simId}</span>
            {currentRun?.error_message && (
              <div className="sim-error">{currentRun.error_message}</div>
            )}
          </div>
        )}

        {(status === "completed" || status === "failed") && (
          <button className="btn-xs" onClick={resetRun}>Clear</button>
        )}

        {!simId && !submitting && (
          <div className="sim-empty">
            Click "Run New" to submit a simulation
          </div>
        )}
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="sim-history">
          <h4>History</h4>
          {history.slice(0, 20).map((entry) => (
            <div className="sim-history-item" key={`${entry.simId}-${entry.timestamp}`}>
              <span className="sim-history-label">{entry.label}</span>
              <span className={`sim-badge sim-badge-${statusColor(entry.status)}`}>
                {entry.status ?? "unknown"}
              </span>
              <span className="sim-history-time">
                {new Date(entry.timestamp).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(status: ComposeJobStatus | null): string {
  switch (status) {
    case "completed": return "green";
    case "running": return "blue";
    case "queued":
    case "waiting":
    case "pending": return "yellow";
    case "failed":
    case "cancelled":
    case "out_of_memory":
    case "timeout": return "red";
    default: return "gray";
  }
}

function bigraphToFlowSummary(state: AnyDict): {
  processes: number;
  stores: number;
  wires: number;
} | null {
  try {
    let processes = 0;
    let stores = 0;
    let wires = 0;

    function walk(obj: AnyDict): void {
      for (const [key, value] of Object.entries(obj)) {
        if (key.startsWith("_")) continue;
        if (isProcess(value)) {
          processes++;
          const p = value as AnyDict;
          if (p.inputs) wires += Object.keys(p.inputs as AnyDict).length;
          if (p.outputs) wires += Object.keys(p.outputs as AnyDict).length;
        } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          stores++;
          walk(value as AnyDict);
        } else {
          stores++;
        }
      }
    }

    walk(state);
    return { processes, stores, wires };
  } catch {
    return null;
  }
}
