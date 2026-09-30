/**
 * The tokenomics simulation is deterministic and docs/protocol/TOKENOMICS-SIMULATION.md carries its current output
 * (regenerate with `node tools/tokenomics-sim/run.ts --write`).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { report, spliceInto } from "../tools/tokenomics-sim/sim.js";

describe("tokenomics simulation (DRAFT protocol)", () => {
  it("is deterministic and the published tables are current", () => {
    const a = report();
    expect(report()).toBe(a);
    const doc = readFileSync(fileURLToPath(new URL("../docs/protocol/TOKENOMICS-SIMULATION.md", import.meta.url)), "utf8");
    expect(spliceInto(doc, a)).toBe(doc);
  }, 60_000);
});
