import { describe, it, expect } from "vitest";
import { getInState, setInState, deleteInState } from "../api";

describe("getInState", () => {
  it("gets a nested value by path", () => {
    const state = { a: { b: { c: 42 } } };
    expect(getInState(state, ["a", "b", "c"])).toBe(42);
  });

  it("returns undefined for missing path", () => {
    const state = { a: {} };
    expect(getInState(state, ["a", "b", "c"])).toBeUndefined();
  });

  it("handles empty path", () => {
    const state = { x: 1 };
    expect(getInState(state, [])).toBe(state);
  });
});

describe("setInState", () => {
  it("sets a nested value immutably", () => {
    const state = { a: { b: 1 } };
    const next = setInState(state, ["a", "b"], 2);
    expect(next).toEqual({ a: { b: 2 } });
    expect(state).toEqual({ a: { b: 1 } }); // unchanged
  });

  it("creates intermediate objects", () => {
    const state = {} as Record<string, unknown>;
    const next = setInState(state, ["a", "b"], 42);
    expect(next).toEqual({ a: { b: 42 } });
  });

  it("sets at root path", () => {
    const state = { x: 1 };
    const next = setInState(state, [], { y: 2 });
    expect(next).toEqual({ x: 1, y: 2 });
  });
});

describe("deleteInState", () => {
  it("deletes a nested value immutably", () => {
    const state = { a: { b: 1, c: 2 } };
    const next = deleteInState(state, ["a", "b"]);
    expect(next).toEqual({ a: { c: 2 } });
    expect(state).toEqual({ a: { b: 1, c: 2 } }); // unchanged
  });

  it("returns state unchanged if path missing", () => {
    const state = { a: 1 };
    const next = deleteInState(state, ["b"]);
    expect(next).toBe(state); // same reference
  });

  it("handles empty path", () => {
    const state = { a: 1 };
    expect(deleteInState(state, [])).toBe(state);
  });
});
