import type { GraphResponse } from "./types";

const BASE = "/api";

export type ViewMode = "nested" | "hierarchical";

export async function fetchGraph(view: ViewMode = "nested"): Promise<GraphResponse> {
  const res = await fetch(`${BASE}/graph?view=${view}`);
  if (!res.ok) throw new Error(`Failed to fetch graph: ${res.status}`);
  return res.json();
}

export async function loadBigraph(
  state: Record<string, unknown>,
  schema?: Record<string, unknown>
): Promise<{ warnings?: ImportWarning[] }> {
  const res = await fetch(`${BASE}/load`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state, schema }),
  });
  if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
  return res.json();
}

export async function importPbgFile(
  file: File
): Promise<{ ok: boolean; warnings: ImportWarning[] }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/import`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Import failed: ${res.status}`);
  }
  return res.json();
}

export interface ImportWarning {
  path: string[];
  address: string;
  message: string;
}

export async function updateNodeValue(
  path: string[],
  value: unknown
): Promise<void> {
  const pathStr = path.join("/");
  const res = await fetch(`${BASE}/node/${pathStr}/value`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error(`Failed to update: ${res.status}`);
}

export async function updateNodeConfig(
  path: string[],
  config: Record<string, unknown>
): Promise<void> {
  const pathStr = path.join("/");
  const res = await fetch(`${BASE}/node/${pathStr}/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: config }),
  });
  if (!res.ok) throw new Error(`Failed to update config: ${res.status}`);
}

export async function addProcess(params: {
  path: string[];
  process_type?: string;
  address?: string;
  config?: Record<string, unknown>;
  inputs?: Record<string, string[]>;
  outputs?: Record<string, string[]>;
}): Promise<void> {
  const res = await fetch(`${BASE}/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Failed to add process: ${res.status}`);
}

export async function addStore(params: {
  path: string[];
  value?: unknown;
  store_type?: string;
}): Promise<void> {
  const res = await fetch(`${BASE}/store`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Failed to add store: ${res.status}`);
}

export async function nestNode(
  sourcePath: string[],
  targetParent: string[]
): Promise<void> {
  const res = await fetch(`${BASE}/nest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_path: sourcePath, target_parent: targetParent }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Failed to nest: ${res.status}`);
  }
}

export async function deleteNode(path: string[]): Promise<void> {
  const pathStr = path.join("/");
  const res = await fetch(`${BASE}/node/${pathStr}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete: ${res.status}`);
}

export async function rewirePort(params: {
  process_path: string[];
  port_name: string;
  direction: "inputs" | "outputs";
  new_target: string[];
}): Promise<void> {
  const res = await fetch(`${BASE}/rewire`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Failed to rewire: ${res.status}`);
  }
}

export async function fetchRegistry(): Promise<Array<ProcessInfo>> {
  const res = await fetch(`${BASE}/registry`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.processes ?? [];
}

export interface ProcessInfo {
  name: string;
  address: string;
  registered: boolean;
  class?: string;
  module?: string;
  source_file?: string | null;
  source_line?: number | null;
  config_schema?: Record<string, unknown>;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  update_signature?: string | null;
  update_source?: string | null;
  update_docstring?: string | null;
}

export async function fetchTypes(): Promise<
  Array<{ name: string; rendered: string }>
> {
  const res = await fetch(`${BASE}/types`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.types ?? [];
}

export async function runCheck(
  path?: string[]
): Promise<{ valid: boolean; error?: string }> {
  const res = await fetch(`${BASE}/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: path ?? null }),
  });
  return res.json();
}

export async function fetchCoreInfo(): Promise<{
  class: string;
  module: string;
  source_file: string | null;
  num_types: number;
  num_processes: number;
}> {
  const res = await fetch(`${BASE}/core-info`);
  return res.json();
}

export async function fetchProcessSource(address: string): Promise<ProcessInfo> {
  const res = await fetch(`${BASE}/process-source/${encodeURIComponent(address)}`);
  return res.json();
}

export function exportPbg(): void {
  const a = document.createElement("a");
  a.href = `${BASE}/export`;
  a.download = "bigraph.pbg";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
