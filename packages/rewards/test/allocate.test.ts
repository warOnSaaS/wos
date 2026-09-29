import { describe, expect, it } from "vitest";
import { allocatePool, PoolAllocationError } from "../src/index.js";

const sum = (m: Map<string, number>) => [...m.values()].reduce((s, n) => s + n, 0);

describe("allocatePool (largest remainder, DONE 3)", () => {
  it("splits pro rata and gives leftovers to the largest remainders", () => {
    // 100 over 1:1:1 -> 33.33 each; one leftover token goes to the smallest key (all remainders equal).
    const m = allocatePool(100, [
      { key: "c", weight: 1 },
      { key: "a", weight: 1 },
      { key: "b", weight: 1 },
    ]);
    expect(Object.fromEntries(m)).toEqual({ a: 34, b: 33, c: 33 });
  });

  it("prefers the larger remainder over key order", () => {
    // 10 over 1:2 -> 3.33 / 6.67: the 0.67 remainder wins the leftover token even though its key is larger.
    const m = allocatePool(10, [
      { key: "a", weight: 1 },
      { key: "z", weight: 2 },
    ]);
    expect(Object.fromEntries(m)).toEqual({ a: 3, z: 7 });
  });

  it("breaks ties by key ascending in code-unit order, not locale order", () => {
    const m = allocatePool(1, [
      { key: "b", weight: 1 },
      { key: "B", weight: 1 },
    ]);
    expect(m.get("B")).toBe(1);
    expect(m.get("b")).toBe(0);
  });

  it("is deterministic and independent of input order", () => {
    const w = [
      { key: "k1", weight: 7 },
      { key: "k2", weight: 3 },
      { key: "k3", weight: 11 },
      { key: "k4", weight: 3 },
    ];
    const a = allocatePool(1000, w);
    const b = allocatePool(1000, [...w].reverse());
    expect([...a]).toEqual([...b]);
    expect(sum(a)).toBe(1000);
  });

  it("always sums exactly to the pool (seeded random vectors)", () => {
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let i = 0; i < 500; i++) {
      const count = 1 + rnd(20);
      const weights = Array.from({ length: count }, (_, j) => ({ key: `acct-${j}`, weight: rnd(5) === 0 ? 0 : 1 + rnd(10_000) }));
      if (weights.every((w) => w.weight === 0)) weights[0]!.weight = 1;
      const total = rnd(100_000);
      const m = allocatePool(total, weights);
      expect(sum(m)).toBe(total);
      for (const w of weights) {
        const exact = (total * w.weight) / weights.reduce((s, x) => s + x.weight, 0);
        expect(Math.abs(m.get(w.key)! - exact)).toBeLessThan(1);
        if (w.weight === 0) expect(m.get(w.key)).toBe(0);
      }
    }
  });

  it("is exact for large safe integers (BigInt arithmetic)", () => {
    const m = allocatePool(Number.MAX_SAFE_INTEGER, [
      { key: "a", weight: Number.MAX_SAFE_INTEGER - 1 },
      { key: "b", weight: 1 },
    ]);
    expect(sum(m)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("returns zeros for an empty pool and refuses invalid input", () => {
    expect(Object.fromEntries(allocatePool(0, [{ key: "a", weight: 0 }]))).toEqual({ a: 0 });
    expect(() => allocatePool(5, [{ key: "a", weight: 0 }])).toThrow(PoolAllocationError);
    expect(() => allocatePool(5, [])).toThrow(PoolAllocationError);
    expect(() => allocatePool(-1, [{ key: "a", weight: 1 }])).toThrow(PoolAllocationError);
    expect(() => allocatePool(1.5, [{ key: "a", weight: 1 }])).toThrow(PoolAllocationError);
    expect(() => allocatePool(5, [{ key: "a", weight: -1 }])).toThrow(PoolAllocationError);
    expect(() =>
      allocatePool(5, [
        { key: "a", weight: 1 },
        { key: "a", weight: 2 },
      ]),
    ).toThrow(PoolAllocationError);
  });
});
