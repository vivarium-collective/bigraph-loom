import { useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLang } from "@codemirror/lang-json";
import JSZip from "jszip";
import { SmsApiComposeClient } from "../smsApi";
import { getSmsApiBaseUrl } from "../config";

// ── Types ────────────────────────────────────────────────────────────────────

interface ResultsFile {
  name: string;
  content: string | Blob;
  isText: boolean;
}

type ResultsTab = "summary" | "json" | "data" | "plots" | "files";

interface Props {
  simId: number;
  onClose: () => void;
}

// ── Results Viewer ───────────────────────────────────────────────────────────

export default function ResultsViewer({ simId, onClose }: Props) {
  const [tab, setTab] = useState<ResultsTab>("summary");
  const [files, setFiles] = useState<ResultsFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load on mount
  useState(() => {
    loadResults(simId).then(setFiles).catch((e) => setError(e.message)).finally(() => setLoading(false));
  });

  // Derived data
  const jsonFiles = files.filter((f) => f.isText && f.name.endsWith(".json"));
  const dataFiles = files.filter((f) => f.isText && (f.name.endsWith(".tsv") || f.name.endsWith(".csv")));
  const plotFiles = files.filter((f) => f.name.endsWith(".html") || f.name.endsWith(".png") || f.name.endsWith(".svg"));
  const otherFiles = files.filter((f) => !jsonFiles.includes(f) && !dataFiles.includes(f) && !plotFiles.includes(f));

  const finalStateFile = jsonFiles.find((f) => f.name.includes("final_state"));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="results-modal" onClick={(e) => e.stopPropagation()}>
        <div className="results-header">
          <h3>Results: Simulation #{simId}</h3>
          <button className="modal-close" onClick={onClose}>Close</button>
        </div>

        {loading && <div className="results-loading">Loading results...</div>}
        {error && <div className="results-error">{error}</div>}

        {!loading && !error && (
          <>
            <div className="results-tabs">
              <button className={tab === "summary" ? "tab-active" : ""} onClick={() => setTab("summary")}>
                Summary
              </button>
              <button className={tab === "json" ? "tab-active" : ""} onClick={() => setTab("json")}>
                JSON ({jsonFiles.length})
              </button>
              <button className={tab === "data" ? "tab-active" : ""} onClick={() => setTab("data")}>
                Data ({dataFiles.length})
              </button>
              <button className={tab === "plots" ? "tab-active" : ""} onClick={() => setTab("plots")}>
                Plots ({plotFiles.length})
              </button>
              <button className={tab === "files" ? "tab-active" : ""} onClick={() => setTab("files")}>
                Files ({files.length})
              </button>
            </div>

            <div className="results-body">
              {tab === "summary" && (
                <div className="results-summary">
                  <h4>Simulation #{simId}</h4>
                  <div className="summary-field">
                    <label>Files extracted</label>
                    <span>{files.length}</span>
                  </div>
                  <div className="summary-field">
                    <label>JSON files</label>
                    <span>{jsonFiles.length}</span>
                  </div>
                  <div className="summary-field">
                    <label>Data files (TSV/CSV)</label>
                    <span>{dataFiles.length}</span>
                  </div>
                  <div className="summary-field">
                    <label>Plot files</label>
                    <span>{plotFiles.length}</span>
                  </div>
                  {finalStateFile && (
                    <div className="summary-field">
                      <label>Final state</label>
                      <span>{finalStateFile.name}</span>
                    </div>
                  )}
                </div>
              )}

              {tab === "json" && (
                <div className="results-json-list">
                  {jsonFiles.length === 0 && <p>No JSON files found.</p>}
                  {jsonFiles.map((f) => (
                    <div className="results-json-entry" key={f.name}>
                      <h4>{f.name}</h4>
                      <div className="results-json-editor">
                        <CodeMirror
                          value={typeof f.content === "string" ? f.content : ""}
                          extensions={[jsonLang()]}
                          theme="dark"
                          basicSetup={{ lineNumbers: true, foldGutter: true }}
                          readOnly={true}
                          style={{ height: "300px", fontSize: "12px" }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {tab === "data" && (
                <div className="results-data">
                  {dataFiles.length === 0 && <p>No data files found.</p>}
                  {dataFiles.map((f) => (
                    <div className="results-data-entry" key={f.name}>
                      <h4>{f.name}</h4>
                      <div className="results-data-table-wrapper">
                        <DataTable content={typeof f.content === "string" ? f.content : ""} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {tab === "plots" && (
                <div className="results-plots">
                  {plotFiles.length === 0 && <p>No plot files found.</p>}
                  <div className="results-plots-grid">
                    {plotFiles.map((f) => (
                      <div className="results-plot-card" key={f.name}>
                        <h5>{f.name}</h5>
                        {f.name.endsWith(".html") && typeof f.content === "string" ? (
                          <iframe
                            className="results-plot-iframe"
                            srcDoc={f.content}
                            title={f.name}
                            sandbox="allow-scripts"
                          />
                        ) : (
                          <img
                            className="results-plot-img"
                            src={URL.createObjectURL(f.content instanceof Blob ? f.content : new Blob([f.content]))}
                            alt={f.name}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {tab === "files" && (
                <div className="results-files-list">
                  {files.map((f) => (
                    <div className="results-file-item" key={f.name}>
                      <span className="results-file-name">{f.name}</span>
                      <a
                        className="results-file-download"
                        href={URL.createObjectURL(
                          f.content instanceof Blob ? f.content : new Blob([f.content], { type: "text/plain" }),
                        )}
                        download={f.name.split("/").pop()}
                      >
                        Download
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Data Table (sortable, paginated) ─────────────────────────────────────────

function DataTable({ content }: { content: string }) {
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(0);
  const pageSize = 1000;

  if (!content.trim()) return <p>Empty file</p>;

  const lines = content.trim().split("\n");
  if (lines.length < 1) return <p>Empty file</p>;

  const header = lines[0].split("\t");
  const isCsv = header.length === 1 && content.includes(",");
  const sep = isCsv ? "," : "\t";

  const headers = lines[0].split(sep).map((h) => h.trim());
  const dataRows = lines.slice(1).map((line) => line.split(sep).map((c) => c.trim()));

  // Sort
  let sorted = dataRows;
  if (sortCol !== null) {
    sorted = [...dataRows].sort((a, b) => {
      const av = a[sortCol] ?? "";
      const bv = b[sortCol] ?? "";
      const numA = Number(av);
      const numB = Number(bv);
      if (!isNaN(numA) && !isNaN(numB)) {
        return sortAsc ? numA - numB : numB - numA;
      }
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }

  const totalPages = Math.ceil(sorted.length / pageSize);
  const paged = sorted.slice(page * pageSize, (page + 1) * pageSize);

  function toggleSort(col: number) {
    if (sortCol === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(col);
      setSortAsc(true);
    }
  }

  return (
    <div>
      <table className="data-table">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} onClick={() => toggleSort(i)} className="sortable-th">
                {h} {sortCol === i ? (sortAsc ? "▲" : "▼") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {paged.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {totalPages > 1 && (
        <div className="pagination">
          <button disabled={page <= 0} onClick={() => setPage(page - 1)}>Prev</button>
          <span>Page {page + 1} of {totalPages} ({sorted.length} rows)</span>
          <button disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}

// ── Results loader ───────────────────────────────────────────────────────────

async function loadResults(simId: number): Promise<ResultsFile[]> {
  const baseUrl = getSmsApiBaseUrl();
  const client = new SmsApiComposeClient(baseUrl);
  const blob = await client.getSimulationResults(simId);
  const zip = await JSZip.loadAsync(blob);
  const files: ResultsFile[] = [];

  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const isText = name.endsWith(".json") || name.endsWith(".tsv") || name.endsWith(".csv")
      || name.endsWith(".html") || name.endsWith(".txt");
    const content = isText
      ? await entry.async("string")
      : await entry.async("blob");
    files.push({ name, content, isText });
  }

  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}
