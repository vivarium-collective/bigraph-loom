import type { GraphResponse } from "./types";
export type { GraphResponse };

const BASE = "/api";

export async function fetchGraph(): Promise<GraphResponse> {
  const res = await fetch(`${BASE}/graph`);
  if (!res.ok) throw new Error(`Failed to fetch graph: ${res.status}`);
  return res.json();
}

export async function importPbgFile(
  file: File
): Promise<{ ok: boolean; warnings: ImportWarning[] }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/import`, { method: "POST", body: form });
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

export async function updateNodeValue(path: string[], value: unknown): Promise<void> {
  const res = await fetch(`${BASE}/node/${path.join("/")}/value`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error(`Failed to update: ${res.status}`);
}

export async function updateNodeConfig(path: string[], config: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${BASE}/node/${path.join("/")}/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: config }),
  });
  if (!res.ok) throw new Error(`Failed to update config: ${res.status}`);
}

export async function deleteNode(path: string[]): Promise<void> {
  const res = await fetch(`${BASE}/node/${path.join("/")}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete: ${res.status}`);
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

// ── View state ──────────────────────────────────────────────────────────────

export interface ViewState {
  positions: Record<string, { x: number; y: number }>;
  styles?: Record<string, Record<string, unknown>>;
  collapsed: string[];
  hidden: string[];
  viewMode: string;
  zoom?: number;
  panX?: number;
  panY?: number;
}

// ── Library ─────────────────────────────────────────────────────────────────

export interface LibraryEntry {
  name: string;
  source: "example" | "saved";
  saved_at?: number;
  has_view?: boolean;
}

export async function fetchLibrary(): Promise<LibraryEntry[]> {
  const res = await fetch(`${BASE}/library`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.files ?? [];
}

export async function loadFromLibrary(
  name: string
): Promise<{ ok: boolean; warnings?: ImportWarning[]; view_state?: ViewState | null }> {
  const res = await fetch(`${BASE}/library/load/${encodeURIComponent(name)}`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
  return res.json();
}

export async function saveToLibrary(name: string, viewState?: ViewState): Promise<void> {
  const res = await fetch(`${BASE}/library/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, view_state: viewState ?? null }),
  });
  if (!res.ok) throw new Error(`Failed to save: ${res.status}`);
}

export async function deleteFromLibrary(name: string): Promise<void> {
  const res = await fetch(`${BASE}/library/${encodeURIComponent(name)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to delete: ${res.status}`);
}
