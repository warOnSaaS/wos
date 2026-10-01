/**
 * `wos review --human` and `wos human-ruling` (contracts 5.15.0, D53) against a fake of the four maintainer routes.
 * No agent runs: the human seat is a person, and nothing here touches the orchestrator.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HumanReviewSubject, ReviewVerdict } from "@waronsaas/contracts";
import { describe, expect, it } from "vitest";
import { MemorySecrets } from "../../../packages/orchestrator/test/support/harness.js";
import { FIXED_DATE } from "../../../packages/orchestrator/test/support/fake-control-plane.js";
import { createAppsApi, SESSION_KEY } from "../src/apps.js";
import { wos } from "./support.js";

const ROUND = "0192ab3c-0000-7000-8000-0000000000a1";
const PRIOR = "0192ab3c-0000-7000-8000-0000000000f1";
const HEAD = "a".repeat(40);
const HASH = `sha256:${"b".repeat(64)}`;

function subject(eligible: boolean, prior = false): HumanReviewSubject {
  return {
    round: {
      roundId: ROUND,
      roundNumber: prior ? 2 : 1,
      subjectKind: "roadmap",
      subjectId: "0192ab3c-0000-7000-8000-0000000000d1",
      target: "salesforce",
      feature: null,
      headSha: HEAD,
      submissionSha256: HASH,
      openedAt: FIXED_DATE,
      agentVerdictSealed: true,
      label: "single_lab_review",
      eligibility: eligible
        ? { eligible: true, reasons: [] }
        : { eligible: false, reasons: ["you authored this subject: the human seat is never the author"] },
    },
    subject: {
      repo: "waronsaas/product",
      branch: "wos/roadmap/salesforce/v1",
      title: "salesforce Replacement Roadmap",
      prNumber: 3,
      prUrl: "https://github.com/waronsaas/product/pull/3",
      files: [
        {
          path: "roadmaps/salesforce/ROADMAP.yaml",
          url: `https://github.com/waronsaas/product/blob/${HEAD}/roadmaps/salesforce/ROADMAP.yaml`,
        },
      ],
      authorSummary: { schema: "author-summary.v1", summary: "Roadmap v1 from the scan.", responses: [], proposalsAddressed: [], ensemble: null },
    },
    agentReview: eligible
      ? {
          slot: "astra",
          reviewerHandle: "astra-rev",
          model: "gpt-6-astra",
          reasoning: "max",
          verdict: {
            schema: "review-verdict.v1",
            verdict: "NO_MATERIAL_GAPS",
            summary: "No material gaps.",
            findings: [],
            priorFindings: [],
            decisionRulings: [],
          },
        }
      : null,
    priorFindings: prior
      ? [
          {
            id: PRIOR,
            roundNumber: 1,
            source: "astra",
            severity: "material",
            category: "missing_scope",
            title: "Reports are missing",
            detail: "INV-0002 is not placed.",
            state: "disputed",
          },
        ]
      : [],
  };
}

function setup(s: HumanReviewSubject, queueEligible = s.round.eligibility.eligible) {
  const posts: Array<{ path: string; body: unknown; key: string | null }> = [];
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (method === "GET" && url.pathname === "/v1/human-reviews")
      return json(200, { items: [{ ...s.round, eligibility: queueEligible ? { eligible: true, reasons: [] } : s.round.eligibility }] });
    if (method === "GET" && url.pathname === `/v1/rounds/${ROUND}/human-review`) return json(200, s);
    if (method === "POST") {
      posts.push({
        path: url.pathname,
        body: JSON.parse(String(init?.body)),
        key: ((init?.headers ?? {}) as Record<string, string>)["idempotency-key"] ?? null,
      });
      if (url.pathname === `/v1/rounds/${ROUND}/human-review`)
        return json(200, { sealed: true, humanReviewId: "0192ab3c-0000-7000-8000-0000000000e1", revealed: true, outcome: "consensus" });
      if (url.pathname.endsWith("/human-ruling")) return json(200, { ok: true });
    }
    return json(404, { error: { code: "NOT_FOUND", message: "no route", requestId: "r" } });
  }) as typeof globalThis.fetch;
  const secrets = new MemorySecrets();
  secrets.map.set(
    SESSION_KEY,
    JSON.stringify({
      accessToken: "test-access",
      accessExpiresAt: "2026-09-29T13:00:00Z",
      refreshToken: "test-refresh",
      refreshExpiresAt: "2026-10-29T12:00:00Z",
      deviceId: "0192ab3c-0000-7000-8000-0000000000dd",
    }),
  );
  const apps = () =>
    createAppsApi({ baseUrl: "https://api.waronsaas.test", fetch, secrets, clientVersion: "0.0.0-test", now: () => new Date(FIXED_DATE) });
  const noOrchestrator = () => {
    throw new Error("the human seat never builds the orchestrator (no agent run)");
  };
  const run = (argv: string[], opts: { lines?: string[]; isTTY?: boolean } = {}) => wos(noOrchestrator, argv, { apps, ...opts });
  return { posts, run };
}

const tmp = (name: string, content: unknown) => {
  const dir = mkdtempSync(join(tmpdir(), "wos-human-"));
  const p = join(dir, name);
  writeFileSync(p, typeof content === "string" ? content : JSON.stringify(content));
  return p;
};

describe("wos review --human", () => {
  it("shows the round, the subject and the sealed Astra verdict; off a terminal it records nothing and says how", async () => {
    const t = setup(subject(true));
    const r = await t.run(["review", "--human"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`round    ${ROUND}: round 1 of roadmap salesforce (single_lab_review)`);
    expect(r.out).toContain(`head     ${HEAD}`);
    expect(r.out).toContain("astra    NO_MATERIAL_GAPS by @astra-rev (gpt-6-astra, max, attested)");
    expect(r.out).toContain("Roadmap v1 from the scan.");
    expect(r.out).toContain(`record it: wos review --human --round ${ROUND} --verdict-file <review-verdict.v1 JSON>`);
    expect(t.posts).toEqual([]);
  });

  it("records a verdict from a file, bound to the round's head sha and submission hash", async () => {
    const t = setup(subject(true));
    const v: ReviewVerdict = {
      schema: "review-verdict.v1",
      verdict: "NO_MATERIAL_GAPS",
      summary: "Read every file.",
      findings: [],
      priorFindings: [],
            decisionRulings: [],
    };
    const r = await t.run(["review", "--human", "--round", ROUND, "--verdict-file", tmp("v.json", v)]);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain(
      `sealed   human review 0192ab3c-0000-7000-8000-0000000000e1 (NO_MATERIAL_GAPS) on round ${ROUND}; the round is revealed: consensus`,
    );
    expect(t.posts).toHaveLength(1);
    expect(t.posts[0]!.path).toBe(`/v1/rounds/${ROUND}/human-review`);
    expect(t.posts[0]!.body).toEqual({ verdict: v, headSha: HEAD, submissionSha256: HASH });
    expect(t.posts[0]!.key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("a verdict file must answer every open prior material finding and be a consistent review-verdict.v1", async () => {
    const t = setup(subject(true, true));
    const bad = { schema: "review-verdict.v1", verdict: "NO_MATERIAL_GAPS", summary: "ok", findings: [], priorFindings: [], decisionRulings: [] };
    const r = await t.run(["review", "--human", "--round", ROUND, "--verdict-file", tmp("bad.json", bad)]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("VALIDATION_FAILED");
    expect(r.err).toContain(`priorFindings: answer ${PRIOR} (Reports are missing) resolved or still_open`);
    const inconsistent = { ...bad, priorFindings: [{ findingId: PRIOR, status: "still_open", note: "" }] };
    const r2 = await t.run(["review", "--human", "--round", ROUND, "--verdict-file", tmp("c.json", inconsistent)]);
    expect(r2.code).toBe(1);
    expect(r2.err).toContain("verdict must be NO_MATERIAL_GAPS iff");
    expect(t.posts).toEqual([]);
  });

  it("on a terminal it asks for the prior findings, new findings and a summary, then seals after a yes", async () => {
    const t = setup(subject(true, true));
    const lines = [
      "still_open",
      "INV-0002 is still unplaced.",
      "y",
      "material",
      "missing_scope",
      "Dashboards missing",
      "No capability covers dashboards.",
      "Add a capability.",
      "n",
      "Two gaps remain.",
      "y",
    ];
    const r = await t.run(["review", "--human", "--round", ROUND], { lines, isTTY: true });
    expect(r.code, r.err).toBe(0);
    const body = t.posts[0]!.body as { verdict: ReviewVerdict };
    expect(body.verdict.verdict).toBe("MATERIAL_GAPS");
    expect(body.verdict.priorFindings).toEqual([{ findingId: PRIOR, status: "still_open", note: "INV-0002 is still unplaced." }]);
    expect(body.verdict.findings).toEqual([
      {
        localId: "f1",
        severity: "material",
        category: "missing_scope",
        title: "Dashboards missing",
        detail: "No capability covers dashboards.",
        evidence: [],
        suggestedResolution: "Add a capability.",
      },
    ]);
  });

  it("the author (or anyone the seat refuses) gets the reasons and nothing is sent", async () => {
    const t = setup(subject(false));
    const r = await t.run(["review", "--human", "--round", ROUND, "--verdict-file", tmp("v.json", "{}")]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("NOT_ELIGIBLE: you may not hold the human seat of this round");
    expect(r.err).toContain("you authored this subject");
    expect(t.posts).toEqual([]);
    const listed = await t.run(["review", "--human"]);
    expect(listed.code).toBe(0);
    expect(listed.out).toContain("you authored this subject");
  });

  it("--human takes no --slot, and --round needs --human", async () => {
    const t = setup(subject(true));
    expect((await t.run(["review", "--human", "--slot", "astra"])).code).toBe(2);
    expect((await t.run(["review", "--round", ROUND])).code).toBe(2);
  });
});

describe("wos human-ruling", () => {
  it("sends a ruling.v1 with a public note; refuses a file that is not one", async () => {
    const t = setup(subject(true));
    const ruling = {
      schema: "ruling.v1",
      rulings: [{ findingId: PRIOR, decision: "overruled", rationale: "The journey covers the error path as written." }],
      proposedChange: null,
    };
    const doc = "0192ab3c-0000-7000-8000-0000000000d1";
    const r = await t.run(["human-ruling", doc, "--ruling-file", tmp("r.json", ruling), "--note", "Overruled under D53."]);
    expect(r.code, r.err).toBe(0);
    expect(t.posts).toEqual([
      { path: `/v1/admin/documents/${doc}/human-ruling`, body: { ruling, note: "Overruled under D53." }, key: expect.any(String) },
    ]);
    const bad = await t.run(["human-ruling", doc, "--ruling-file", tmp("b.json", { schema: "ruling.v1" }), "--note", "x"]);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("is not a ruling.v1");
  });
});
