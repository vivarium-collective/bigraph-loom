import { describe, it, expect } from "vitest";
import {
  bigraphToFlow,
  isProcess,
  normalizeAddress,
  resolveWire,
  parsePortSchema,
  pathToId,
} from "../convert";

describe("isProcess", () => {
  it("detects process with _type", () => {
    expect(isProcess({ _type: "process", address: "local:X" })).toBe(true);
    expect(isProcess({ _type: "step", address: "local:X" })).toBe(true);
    expect(isProcess({ _type: "composite", address: "local:X" })).toBe(true);
  });

  it("detects process by structural fields", () => {
    expect(isProcess({ address: "local:X", inputs: {}, outputs: {} })).toBe(true);
    expect(isProcess({ address: { protocol: "local", data: "X" }, inputs: {} })).toBe(true);
  });

  it("rejects non-process values", () => {
    expect(isProcess({ value: 1.0 })).toBe(false);
    expect(isProcess({ nested: { store: 1 } })).toBe(false);
    expect(isProcess("not a dict")).toBe(false);
    expect(isProcess(42)).toBe(false);
  });
});

describe("normalizeAddress", () => {
  it("passes through string addresses", () => {
    expect(normalizeAddress("local:Foo")).toBe("local:Foo");
  });

  it("normalizes dict addresses", () => {
    expect(normalizeAddress({ protocol: "local", data: "Foo" })).toBe("local:Foo");
  });
});

describe("resolveWire", () => {
  it("resolves simple child paths", () => {
    expect(resolveWire(["a", "b"], ["c"])).toEqual(["a", "b", "c"]);
  });

  it("resolves parent traversal", () => {
    expect(resolveWire(["a", "b"], ["..", "c"])).toEqual(["a", "c"]);
  });

  it("resolves to root", () => {
    expect(resolveWire(["a"], ["..", "x"])).toEqual(["x"]);
  });
});

describe("parsePortSchema", () => {
  it("parses pipe-separated schema strings", () => {
    const result = parsePortSchema("biomass:mass|substrates:map[concentration]");
    expect(result).toEqual({ biomass: "mass", substrates: "map[concentration]" });
  });

  it("handles nested brackets", () => {
    const result = parsePortSchema("particles:map[id:string|position:tuple[float,float]]");
    expect(result).toEqual({ particles: "map[id:string|position:tuple[float,float]]" });
  });

  it("passes through dict schemas", () => {
    expect(parsePortSchema({ a: "float" })).toEqual({ a: "float" });
  });

  it("handles empty inputs", () => {
    expect(parsePortSchema("")).toEqual({});
    expect(parsePortSchema({})).toEqual({});
    expect(parsePortSchema(null)).toEqual({});
  });
});

describe("pathToId", () => {
  it("joins paths with slash", () => {
    expect(pathToId(["a", "b", "c"])).toBe("a/b/c");
  });

  it("returns __root__ for empty path", () => {
    expect(pathToId([])).toBe("__root__");
  });
});

describe("bigraphToFlow", () => {
  it("converts a simple bigraph with process and stores", () => {
    const state = {
      A: 1.0,
      B: 0.0,
      reaction: {
        _type: "process",
        address: "local:Reaction",
        inputs: { substrate: ["A"] },
        outputs: { product: ["B"] },
      },
    };
    const result = bigraphToFlow(state);
    expect(result.nodes).toHaveLength(3);
    expect(result.nodes.filter((n) => n.type === "process")).toHaveLength(1);
    expect(result.nodes.filter((n) => n.type === "store")).toHaveLength(2);
    expect(result.edges.length).toBeGreaterThanOrEqual(2);
  });

  it("creates nested store nodes", () => {
    const state = {
      cell: {
        mass: 1.0,
        volume: 2.0,
      },
    };
    const result = bigraphToFlow(state);
    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain("cell");
    expect(ids).toContain("cell/mass");
    expect(ids).toContain("cell/volume");

    const placeEdges = result.edges.filter((e) => (e.data as any)?.edgeType === "place");
    expect(placeEdges).toHaveLength(2);
  });

  it("creates implicit stores for wire targets", () => {
    const state = {
      my_process: {
        _type: "process",
        address: "local:P",
        inputs: { x: ["store_a"] },
        outputs: { y: ["store_b"] },
      },
    };
    const result = bigraphToFlow(state);
    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain("store_a");
    expect(ids).toContain("store_b");
  });

  it("creates nested implicit stores", () => {
    const state = {
      proc: {
        _type: "process",
        address: "local:P",
        inputs: { rna: ["unique", "RNA"] },
        outputs: {},
      },
    };
    const result = bigraphToFlow(state);
    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain("unique");
    expect(ids).toContain("unique/RNA");
  });

  it("normalizes dict addresses in nodes", () => {
    const state = {
      proc: {
        address: { protocol: "local", data: "MyProc" },
        inputs: { x: ["a"] },
        outputs: { y: ["b"] },
      },
    };
    const result = bigraphToFlow(state);
    const proc = result.nodes.find((n) => n.type === "process")!;
    expect((proc.data as any).address).toBe("local:MyProc");
  });

  it("includes wire data in process nodes", () => {
    const state = {
      A: 1.0,
      proc: {
        _type: "process",
        address: "local:P",
        inputs: { x: ["A"] },
        outputs: { y: ["A"] },
      },
    };
    const result = bigraphToFlow(state);
    const proc = result.nodes.find((n) => n.type === "process")!;
    expect((proc.data as any).inputWires).toEqual({ x: "A" });
    expect((proc.data as any).outputWires).toEqual({ y: "A" });
  });

  it("shows all ports from wires and schema", () => {
    const state = {
      proc: {
        _type: "process",
        address: "local:P",
        _inputs: "wired_port:float|unwired_port:int",
        inputs: { wired_port: ["a"] },
        outputs: {},
      },
    };
    const result = bigraphToFlow(state);
    const proc = result.nodes.find((n) => n.type === "process")!;
    const ports = (proc.data as any).inputPorts as string[];
    expect(ports).toContain("wired_port");
    expect(ports).toContain("unwired_port");
  });
});
