import type {
  BiGraphProcess,
  ComposeSimulationExperiment,
  ComposeHpcRun,
} from "./types";

const DEFAULT_POLL_MS = 5000;
const DEFAULT_TIMEOUT_MS = 3_600_000; // 1 hour

/**
 * Client for the sms-api compose endpoints.
 *
 * All methods are HTTP calls to a configurable base URL.
 * The default base URL comes from VITE_SMS_API_BASE_URL or a runtime override.
 */
export class SmsApiComposeClient {
  constructor(public baseUrl: string) {}

  private async _fetch<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, options);
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`sms-api error ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  // ── Compute registry ─────────────────────────────────────────────────────

  /** List registered process-bigraph processes. */
  async listProcesses(): Promise<BiGraphProcess[]> {
    return this._fetch<BiGraphProcess[]>("/compose/v1/processes");
  }

  /** List registered process-bigraph steps. */
  async listSteps(): Promise<BiGraphProcess[]> {
    return this._fetch<BiGraphProcess[]>("/compose/v1/steps");
  }

  // ── Simulation lifecycle ─────────────────────────────────────────────────

  /**
   * Submit a PBG document as a simulation to the HPC cluster.
   *
   * @param pbgBlob - The process-bigraph state document as a JSON Blob.
   * @param intervalTime - Simulation interval time in seconds (default 1.0).
   */
  async submitSimulation(
    pbgBlob: Blob,
    intervalTime: number = 1.0,
  ): Promise<ComposeSimulationExperiment> {
    const form = new FormData();
    form.append("uploaded_file", pbgBlob, "document.pbg");
    const params = new URLSearchParams({ interval_time: String(intervalTime) });
    return this._fetch<ComposeSimulationExperiment>(
      `/compose/v1/simulation/run?${params}`,
      { method: "POST", body: form },
    );
  }

  /** Get the current status of a submitted simulation. */
  async getSimulationStatus(simId: number): Promise<ComposeHpcRun> {
    return this._fetch<ComposeHpcRun>(
      `/compose/v1/simulation/${simId}/status`,
    );
  }

  /** Download simulation results as a zip blob. */
  async getSimulationResults(simId: number): Promise<Blob> {
    const url = `${this.baseUrl}/compose/v1/simulation/${simId}/results`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`sms-api error ${res.status}: ${res.statusText}`);
    }
    return res.blob();
  }

  /** Retrieve the process-bigraph document used for a simulation. */
  async getSimulationDocument(simId: number): Promise<Record<string, unknown>> {
    return this._fetch<Record<string, unknown>>(
      `/compose/v1/simulation/${simId}/document`,
    );
  }

  // ── Convenience ──────────────────────────────────────────────────────────

  /**
   * Poll simulation status until it completes or fails.
   *
   * @param simId - Simulation database ID.
   * @param pollMs - Polling interval in milliseconds (default 5000).
   * @param timeoutMs - Timeout in milliseconds (default 1 hour).
   */
  async waitForCompletion(
    simId: number,
    pollMs: number = DEFAULT_POLL_MS,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<ComposeHpcRun> {
    const deadline = Date.now() + timeoutMs;

    const poll = async (): Promise<ComposeHpcRun> => {
      const run = await this.getSimulationStatus(simId);
      const status = run.status;

      if (status === "completed" || status === "failed") {
        return run;
      }

      if (Date.now() > deadline) {
        throw new Error(`Simulation ${simId} timed out after ${timeoutMs}ms`);
      }

      await new Promise((resolve) => setTimeout(resolve, pollMs));
      return poll();
    };

    return poll();
  }
}
