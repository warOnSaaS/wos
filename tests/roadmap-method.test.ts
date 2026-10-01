/** D72: agent-policy.v3's roadmap method data is generated from the scans (scripts/gen-roadmap-method.mjs) and current. */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("roadmap method data (D72)", () => {
  it("is current with docs/scans (node scripts/gen-roadmap-method.mjs)", () => {
    const script = join(import.meta.dirname, "..", "scripts", "gen-roadmap-method.mjs");
    expect(() => execFileSync(process.execPath, [script, "--check"], { stdio: "pipe" })).not.toThrow();
  });
});
