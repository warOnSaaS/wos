import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The white paper's materiality figures (docs/whitepaper/MATERIALITY.md) cite tools/materiality/OUTPUT.md.
// This fails if the committed output is not exactly what the model prints, so the cited numbers stay reproducible.
describe("materiality model", () => {
  const root = join(import.meta.dirname, "..");
  const run = () => execFileSync(process.execPath, [join(root, "tools/materiality/model.ts")], { cwd: root, encoding: "utf8" });

  it("is deterministic", () => {
    expect(run()).toBe(run());
  });

  it("matches the committed OUTPUT.md", () => {
    expect(run()).toBe(readFileSync(join(root, "tools/materiality/OUTPUT.md"), "utf8"));
  });
});
