import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SmsApiComposeClient } from "../smsApi";

const BASE = "https://sms.cam.uchc.edu";

function mockFetch(data: unknown, status = 200) {
  return vi.mocked(fetch).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    blob: () => Promise.resolve(new Blob()),
  } as Response);
}

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SmsApiComposeClient", () => {
  const client = new SmsApiComposeClient(BASE);

  it("listProcesses calls correct endpoint", async () => {
    const processes = [{ name: "test", module: "m", compute_type: "process", inputs: "", outputs: "", database_id: 1 }];
    mockFetch(processes);
    const result = await client.listProcesses();
    expect(fetch).toHaveBeenCalledWith(`${BASE}/compose/v1/processes`, expect.any(Object));
    expect(result).toEqual(processes);
  });

  it("listSteps calls correct endpoint", async () => {
    const steps = [{ name: "step1", module: "m", compute_type: "step", inputs: "", outputs: "", database_id: 2 }];
    mockFetch(steps);
    const result = await client.listSteps();
    expect(fetch).toHaveBeenCalledWith(`${BASE}/compose/v1/steps`, expect.any(Object));
    expect(result).toEqual(steps);
  });

  it("submitSimulation sends multipart form with blob", async () => {
    const experiment = { simulation_database_id: 42, simulator_database_id: 1 };
    mockFetch(experiment);

    const blob = new Blob(['{"test":true}'], { type: "application/json" });
    const result = await client.submitSimulation(blob, 2.0);

    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/compose/v1/simulation/run?interval_time=2`,
      expect.objectContaining({ method: "POST" }),
    );

    const call = vi.mocked(fetch).mock.calls[0];
    const body = call[1]?.body as FormData;
    expect(body.get("uploaded_file")).toBeDefined();

    expect(result).toEqual(experiment);
  });

  it("getSimulationStatus calls correct endpoint", async () => {
    const status = {
      database_id: 1,
      slurmjobid: 123,
      correlation_id: "abc",
      job_type: "simulation" as const,
      sim_id: 42,
      simulator_id: 1,
      status: "running",
      start_time: null,
      end_time: null,
      error_message: null,
    };
    mockFetch(status);
    const result = await client.getSimulationStatus(42);
    expect(fetch).toHaveBeenCalledWith(`${BASE}/compose/v1/simulation/42/status`, expect.any(Object));
    expect(result).toEqual(status);
  });

  it("getSimulationResults returns a blob", async () => {
    const blob = new Blob(["zip content"], { type: "application/zip" });
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      blob: () => Promise.resolve(blob),
    } as Response);

    const result = await client.getSimulationResults(42);
    expect(fetch).toHaveBeenCalledWith(`${BASE}/compose/v1/simulation/42/results`);
    expect(result).toBe(blob);
  });

  it("getSimulationDocument calls correct endpoint", async () => {
    const doc = { state: {} };
    mockFetch(doc);
    const result = await client.getSimulationDocument(42);
    expect(fetch).toHaveBeenCalledWith(`${BASE}/compose/v1/simulation/42/document`, expect.any(Object));
    expect(result).toEqual(doc);
  });

  it("waitForCompletion polls until completed", async () => {
    const running = {
      database_id: 1, slurmjobid: 1, correlation_id: "a",
      job_type: "simulation" as const, sim_id: 1, simulator_id: 1,
      status: "running" as const, start_time: null, end_time: null, error_message: null,
    };
    const completed = {
      database_id: 1, slurmjobid: 1, correlation_id: "a",
      job_type: "simulation" as const, sim_id: 1, simulator_id: 1,
      status: "completed" as const, start_time: null, end_time: null, error_message: null,
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(running) } as Response)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(completed) } as Response);

    const result = await client.waitForCompletion(42, 10, 5000);
    expect(result.status).toBe("completed");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("waitForCompletion rejects on timeout", async () => {
    const running = {
      database_id: 1, slurmjobid: 1, correlation_id: "a",
      job_type: "simulation" as const, sim_id: 1, simulator_id: 1,
      status: "running" as const, start_time: null, end_time: null, error_message: null,
    };
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: () => Promise.resolve(running) } as Response);

    await expect(client.waitForCompletion(42, 10, 50)).rejects.toThrow(/timed out/);
  });
});
