import type { AnyDict } from "./api";

export type { AnyDict };

export interface StoreNodeData {
  label: string;
  nodeType: "store";
  value?: string | number | boolean | null;
  valueType?: string;
  isGroup?: boolean;
  implicit?: boolean;
  path: string[];
}

export interface ProcessNodeData {
  label: string;
  nodeType: "process";
  processType: string;
  address: string;
  config: Record<string, unknown>;
  interval?: number;
  path: string[];
  inputPorts: string[];
  outputPorts: string[];
  inputPortsSchema?: Record<string, string>;
  outputPortsSchema?: Record<string, string>;
  inputWires?: Record<string, string>;
  outputWires?: Record<string, string>;
}

export type BigraphNodeData = StoreNodeData | ProcessNodeData;

export interface EdgeData {
  edgeType: "input" | "output" | "bidirectional" | "place";
  port?: string;
}

export interface GraphResponse {
  nodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    data: BigraphNodeData;
    parentId?: string;
    extent?: string;
    style?: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
    label?: string;
    type?: string;
    animated?: boolean;
    data?: EdgeData;
    style?: Record<string, unknown>;
  }>;
}

// ── sms-api compose types ────────────────────────────────────────────────────

export interface BiGraphProcess {
  module: string;
  name: string;
  compute_type: "process" | "step";
  inputs: string;
  outputs: string;
  database_id: number;
}

export interface ComposeSimulationExperiment {
  simulation_database_id: number;
  simulator_database_id: number;
  last_updated?: string;
  metadata?: Record<string, string>;
}

export type ComposeJobStatus =
  | "waiting" | "queued" | "running" | "completed" | "failed"
  | "pending" | "cancelled" | "out_of_memory" | "suspended" | "timeout" | "unknown";

export interface ComposeHpcRun {
  database_id: number;
  slurmjobid: number;
  correlation_id: string;
  job_type: "simulation" | "build_container";
  sim_id: number | null;
  simulator_id: number | null;
  status: ComposeJobStatus | null;
  start_time: string | null;
  end_time: string | null;
  error_message: string | null;
}

export interface SimulationLogEntry {
  timestamp: string;
  message: string;
}

export interface SimulationLogResponse {
  entries: SimulationLogEntry[];
  truncated?: boolean;
}
