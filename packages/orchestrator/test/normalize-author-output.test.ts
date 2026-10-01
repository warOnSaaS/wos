import { describe, expect, it } from "vitest";
import { AuthorSummary } from "@waronsaas/contracts";
import { normalizeAuthorOutput } from "../src/orchestrator.js";

describe("normalizeAuthorOutput (opencode authors write the summary by hand)", () => {
  it("repairs only mechanical gaps: schema tag, empty lists, an over-long summary", () => {
    const out = normalizeAuthorOutput({ summary: "x".repeat(5000) });
    const parsed = AuthorSummary.safeParse(out);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.summary.length).toBe(4000);
  });
  it("still fails closed on anything else", () => {
    expect(AuthorSummary.safeParse(normalizeAuthorOutput(null)).success).toBe(false);
    expect(AuthorSummary.safeParse(normalizeAuthorOutput({ summary: "" })).success).toBe(false);
    expect(AuthorSummary.safeParse(normalizeAuthorOutput({ unparsedOutput: "not json" })).success).toBe(false);
  });
});
