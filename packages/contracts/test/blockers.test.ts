import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ArchitectureBlocker } from "../src/index.js";

const dir = fileURLToPath(new URL("../../../blockers/", import.meta.url));
const files = readdirSync(dir).filter((f) => /^B-\d{4}-[a-z-]+\.md$/.test(f));

describe("blockers/ files parse as ArchitectureBlocker", () => {
  it.each(files)("%s", (f) => {
    const m = /```json\n([\s\S]*?)\n```/.exec(readFileSync(dir + f, "utf8"));
    expect(m).not.toBeNull();
    const b = ArchitectureBlocker.parse(JSON.parse(m![1]!));
    expect(`${b.id}.md`).toBe(f);
  });
});
