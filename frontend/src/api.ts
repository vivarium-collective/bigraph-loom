import type { AnyDict } from "./convert";
export type { AnyDict };

// ── Types ────────────────────────────────────────────────────────────────────

export interface LibraryEntry {
  name: string;
  source: "example" | "saved";
  saved_at?: number;
  has_view?: boolean;
}

export interface ImportWarning {
  path: string[];
  address: string;
  message: string;
}

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

export interface GraphResponse {
  nodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    data: Record<string, unknown>;
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
    data?: Record<string, unknown>;
    style?: Record<string, unknown>;
  }>;
}

// ── State helpers ────────────────────────────────────────────────────────────

export function getInState(state: AnyDict, path: string[]): unknown {
  let current: unknown = state;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as AnyDict)[key];
  }
  return current;
}

export function setInState(state: AnyDict, path: string[], value: unknown): AnyDict {
  if (path.length === 0) return { ...state, ...(typeof value === "object" && value !== null ? value as AnyDict : {}) };
  const [head, ...rest] = path;
  if (rest.length === 0) {
    return { ...state, [head]: value };
  }
  const child = typeof state[head] === "object" && state[head] !== null
    ? (state[head] as AnyDict)
    : {};
  return { ...state, [head]: setInState(child, rest, value) };
}

export function deleteInState(state: AnyDict, path: string[]): AnyDict {
  if (path.length === 0) return state;
  const [head, ...rest] = path;
  if (!(head in state)) return state;
  if (rest.length === 0) {
    const next = { ...state };
    delete next[head];
    return next;
  }
  const child = state[head];
  if (typeof child !== "object" || child === null) return state;
  return { ...state, [head]: deleteInState(child as AnyDict, rest) };
}

// ── Library (localStorage) ───────────────────────────────────────────────────

const LIBRARY_KEY = "bgloom_library";
const EXAMPLE_KEY_PREFIX = "bgloom_example_";
const SAVED_KEY_PREFIX = "bgloom_saved_";

interface LibraryStorageEntry {
  state: AnyDict;
  schema?: AnyDict | null;
  view_state?: ViewState | null;
}

function loadLibraryIndex(): Record<string, { source: "example" | "saved"; saved_at?: number }> {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveLibraryIndex(index: Record<string, { source: "example" | "saved"; saved_at?: number }>): void {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(index));
}

export function fetchLibrary(): LibraryEntry[] {
  const index = loadLibraryIndex();
  return Object.entries(index)
    .map(([name, meta]) => ({
      name,
      source: meta.source,
      saved_at: meta.saved_at,
      has_view: true,
    }))
    .sort((a, b) => {
      if (a.source !== b.source) return a.source === "example" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export function loadFromLibrary(
  name: string,
): { ok: boolean; warnings?: ImportWarning[]; view_state?: ViewState | null } {
  const key = `${SAVED_KEY_PREFIX}${name}`;
  const exampleKey = `${EXAMPLE_KEY_PREFIX}${name}`;
  try {
    const raw = localStorage.getItem(key) || localStorage.getItem(exampleKey);
    if (!raw) throw new Error(`Not found: ${name}`);
    const entry: LibraryStorageEntry = JSON.parse(raw);
    return { ok: true, warnings: [], view_state: entry.view_state ?? null };
  } catch (e: any) {
    return { ok: false, warnings: [], view_state: null };
  }
}

export function saveToLibrary(
  name: string,
  state: AnyDict,
  viewState?: ViewState,
  schema?: AnyDict | null,
): void {
  const entry: LibraryStorageEntry = { state, schema, view_state: viewState ?? null };
  localStorage.setItem(`${SAVED_KEY_PREFIX}${name}`, JSON.stringify(entry));
  const index = loadLibraryIndex();
  index[name] = { source: "saved", saved_at: Date.now() };
  saveLibraryIndex(index);
}

export function deleteFromLibrary(name: string): void {
  localStorage.removeItem(`${SAVED_KEY_PREFIX}${name}`);
  localStorage.removeItem(`${EXAMPLE_KEY_PREFIX}${name}`);
  const index = loadLibraryIndex();
  delete index[name];
  saveLibraryIndex(index);
}

export function loadLibraryEntryState(name: string): AnyDict | null {
  const key = `${SAVED_KEY_PREFIX}${name}`;
  const exampleKey = `${EXAMPLE_KEY_PREFIX}${name}`;
  try {
    const raw = localStorage.getItem(key) || localStorage.getItem(exampleKey);
    if (!raw) return null;
    const entry: LibraryStorageEntry = JSON.parse(raw);
    return entry.state ?? null;
  } catch {
    return null;
  }
}

// ── Export ───────────────────────────────────────────────────────────────────

export function exportPbg(state: AnyDict, schema?: AnyDict | null, viewState?: ViewState): void {
  const payload: Record<string, unknown> = { state };
  if (schema) payload.schema = schema;
  if (viewState) payload.view_state = viewState;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "bigraph.pbg";
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Import ───────────────────────────────────────────────────────────────────

export interface ParsedPbgFile {
  state: AnyDict;
  schema?: AnyDict | null;
  view_state?: ViewState | null;
}

export function parsePbgFile(file: File): Promise<ParsedPbgFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        const state = parsed.state ?? parsed;
        const schema = parsed.schema ?? null;
        const view_state = parsed.view_state ?? null;
        resolve({ state, schema, view_state });
      } catch (e: any) {
        reject(new Error(`Invalid JSON: ${e.message}`));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

// Deprecated — kept for type compatibility.
export async function importPbgFile(
  _file: File
): Promise<{ ok: boolean; warnings: ImportWarning[] }> {
  return { ok: true, warnings: [] };
}

// Deprecated — kept for type compatibility.
export async function fetchProcessSource(_address: string): Promise<ProcessInfo> {
  return { name: "", address: _address, registered: false, inputs: {}, outputs: {} };
}

// Deprecated — kept for type compatibility.
export async function updateNodeValue(_path: string[], _value: unknown): Promise<void> {}

// Deprecated — kept for type compatibility.
export async function updateNodeConfig(_path: string[], _config: Record<string, unknown>): Promise<void> {}

// Deprecated — kept for type compatibility.
export async function deleteNode(_path: string[]): Promise<void> {}

// Deprecated — kept for type compatibility.
export async function rewirePort(_params: {
  process_path: string[];
  port_name: string;
  direction: "inputs" | "outputs";
  new_target: string[];
}): Promise<void> {}

// Deprecated — kept for type compatibility.
export async function fetchGraph(): Promise<GraphResponse> {
  return { nodes: [], edges: [] };
}
