import { execFile, execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AssessmentBlock, AssessmentRecord, extractAssessmentBlock } from "../packages/contracts/src/assessment.js";

const root = join(import.meta.dirname, "..");
const dir = join(root, "docs/assessments");
const run = promisify(execFile);
// The prompt exactly as the site and the script load it (apps/web is not an ES module package, so tsc cannot import it here).
const HANDOFF_PROMPT = execFileSync(
  process.execPath,
  [
    "--no-warnings",
    "--input-type=module",
    "-e",
    'import { HANDOFF_PROMPT } from "./apps/web/lib/handoff-prompt.ts"; process.stdout.write(HANDOFF_PROMPT);',
  ],
  { cwd: root, encoding: "utf8" },
);

// ------------------------------------------------------------------ the recorded runs themselves
describe("docs/assessments: every recorded run", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

  it.each(files.length ? files : ["(none recorded yet)"])("%s is a valid reference run with its report", (f) => {
    if (!f.endsWith(".json")) return;
    const r = AssessmentRecord.parse(JSON.parse(readFileSync(join(dir, f), "utf8")));
    expect(`${r.id}.json`).toBe(f);
    expect(r.reportFile).toBe(`${r.id}.md`);
    const report = readFileSync(join(dir, r.reportFile), "utf8");
    // The stored block is exactly what the report contains: nothing typed or adjusted by hand.
    const found = extractAssessmentBlock(report);
    expect(found.ok).toBe(true);
    if (found.ok) {
      expect(found.raw).toBe(r.rawBlock);
      expect(found.block).toEqual(r.block);
    }
  });

  it("has no orphan report", () => {
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".md") && x !== "README.md")) {
      expect(existsSync(join(dir, f.replace(/\.md$/, ".json")))).toBe(true);
    }
  });

  it("the site's copy (apps/web/generated) is in step", () => {
    execFileSync(process.execPath, [join(root, "apps/web/scripts/sync-shared.mjs"), "--check"], {
      cwd: join(root, "apps/web"),
      stdio: "pipe",
    });
  });
});

// ------------------------------------------------------------------ the paper's spec and the anti-anchoring rule
describe("the white paper's score block spec", () => {
  const core = readFileSync(join(root, "docs/whitepaper/WHITEPAPER.md"), "utf8");

  it("its template, filled in, is a valid wos-assessment/v1 block (the paper and the contract agree)", () => {
    const m = core.match(/```wos-assessment\n([\s\S]*?)\n```/);
    expect(m).not.toBeNull();
    const filled = m![1]!
      .replace(/"total": <0-100>/, '"total": 50')
      .replace(/<0-20>/g, "10")
      .replace(/<0-10>/g, "5")
      .replace(/<0-100>/g, "50")
      .replace(/"<([a-z_]+) \|[^>]*>"/g, '"$1"')
      .replace(/"<the Version[^>]*>"/, '"0.7"')
      .replace(/"<today, YYYY-MM-DD>"/, '"2026-10-01"')
      .replace(/"<[^>]*>"/g, '"x"');
    expect(AssessmentBlock.parse(JSON.parse(filled)).schema).toBe("wos-assessment/v1");
  });

  it("asks for the trend only after scoring, and keeps it out of the paper, the companions and the pack", () => {
    expect(core).toMatch(/Open either only after you have written your score block/);
    const lib = readFileSync(join(root, "apps/web/lib/whitepaper.ts"), "utf8");
    const companions = lib.slice(lib.indexOf("export const COMPANIONS"), lib.indexOf("export function companionMarkdown"));
    expect(companions).not.toMatch(/assessment/i);
    expect(readFileSync(join(root, "apps/web/app/whitepaper/full-pack.zip/route.ts"), "utf8")).not.toMatch(/assessment/i);
    expect(readFileSync(join(root, "apps/web/scripts/sync-shared.mjs"), "utf8")).toMatch(
      /"MATERIALITY", "EDGE-CASES", "DESIGN", "APPENDICES", "SOURCES"\]/,
    );
  });

  it("the prompt asks for the block and for the trend only after it", () => {
    expect(HANDOFF_PROMPT).toMatch(/score block/);
    expect(HANDOFF_PROMPT).toMatch(/Only after writing it, open https:\/\/waronsaas\.com\/whitepaper\/assessments\.md/);
  });
});

// ------------------------------------------------------------------ run-reference.ts with fake CLIs (never a real model)
describe("tools/assessments/run-reference.ts (fake claude and codex)", () => {
  let server: Server;
  let site = "";
  let livePrompt = HANDOFF_PROMPT;
  const liveVersion = "0.7";
  const tmp = mkdtempSync(join(tmpdir(), "wos-ref-test-"));
  const script = join(root, "tools/assessments/run-reference.ts");

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
  const thesis = { importance: 6, compelling: 5, confidence: "medium" };
  const block = (paperVersion = "0.7", total = 50) => ({
    schema: "wos-assessment/v1",
    paperVersion,
    evaluator: { model: "fake-model", product: "fake-cli" },
    date: "2026-10-01",
    stage1: {
      problemReal: "partly",
      importance: { total, impact: 10, breadth: 10, urgency: 10, evidence: 10, tractability: 10 },
      theses: { control: thesis, efficiency: thesis, softwareEngineering: thesis, apoc: thesis },
      confidence: "medium",
    },
    stage2: { effectiveness: 40, credibility: 30, readiness: "prototype", verdict: "watch", confidence: "low" },
  });
  const reportWith = (b: unknown) =>
    `# Fake report\n\nStage 1 ...\n\n\`\`\`wos-assessment\n${JSON.stringify(b, null, 2)}\n\`\`\`\n\n## Against the recorded trend\n\nNo runs yet.\n`;

  /** A fake CLI: records its argv and stdin, answers --version, prints (claude) or writes to -o (codex) the report. */
  function fakeCli(name: string, report: string): string {
    const d = join(tmp, `bin-${name}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(d);
    writeFileSync(join(d, "report.md"), report);
    const bin = join(d, name);
    writeFileSync(
      bin,
      `#!/bin/sh
if [ "$1" = "--version" ]; then echo "${name} fake 0.0.0"; exit 0; fi
echo "$@" > "${d}/argv.txt"
cat > "${d}/stdin.txt"
pwd > "${d}/cwd.txt"
out=""; prev=""
for a in "$@"; do if [ "$prev" = "-o" ]; then out="$a"; fi; prev="$a"; done
if [ -n "$out" ]; then cp "${d}/report.md" "$out"; else cat "${d}/report.md"; fi
`,
    );
    chmodSync(bin, 0o755);
    return bin;
  }

  const newRoot = () => {
    const r = mkdtempSync(join(tmp, "root-"));
    mkdirSync(join(r, "docs/assessments"), { recursive: true });
    return r;
  };
  const exec = (args: string[]) =>
    run(process.execPath, [script, ...args, "--site", site, "--no-sync"], { cwd: root }).then(
      (r) => ({ code: 0, ...r }),
      (e: { code: number; stdout: string; stderr: string }) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }),
    );

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/whitepaper") {
        res.end(`<html><textarea id="wp-prompt" class="prompt" readonly="" rows="16">${esc(livePrompt)}</textarea></html>`);
      } else if (req.url === "/whitepaper.md") {
        res.end(`# warOnSaaS\n\n| Field | Value |\n|---|---|\n| Version | ${liveVersion} |\n`);
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    site = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("claude: sends exactly the public prompt on stdin, web tools only, from an empty directory, and records a valid run", async () => {
    const bin = fakeCli("claude", reportWith(block()));
    const r = newRoot();
    const out = await exec(["--cli", "claude", "--bin", bin, "--root", r]);
    expect(out.code, out.stderr).toBe(0);
    const d = join(bin, "..");
    expect(readFileSync(join(d, "stdin.txt"), "utf8")).toBe(HANDOFF_PROMPT);
    expect(readFileSync(join(d, "argv.txt"), "utf8")).toContain("-p --model opus --output-format text --allowedTools WebFetch WebSearch");
    expect(readFileSync(join(d, "cwd.txt"), "utf8")).toContain("wos-assessment-");
    const files = readdirSync(join(r, "docs/assessments"));
    expect(files).toHaveLength(2);
    const rec = AssessmentRecord.parse(
      JSON.parse(readFileSync(join(r, "docs/assessments", files.find((f) => f.endsWith(".json"))!), "utf8")),
    );
    expect(rec).toMatchObject({
      source: "reference run by warOnSaaS",
      servedPaperVersion: "0.7",
      runner: { cli: "claude", cliVersion: "claude fake 0.0.0", requestedModel: "opus" },
      prompt: { matchedLiveSite: true },
    });
    expect(rec.id).toMatch(/^\d{4}-\d{2}-\d{2}-v0\.7-claude-opus$/);
    expect(readFileSync(join(r, "docs/assessments", rec.reportFile), "utf8")).toBe(reportWith(block()));
  });

  it("codex: read-only, live search, the report from -o; a second run on the same day gets its own id", async () => {
    const bin = fakeCli("codex", reportWith(block()));
    const r = newRoot();
    expect((await exec(["--cli", "codex", "--bin", bin, "--root", r])).code).toBe(0);
    expect((await exec(["--cli", "codex", "--bin", bin, "--root", r])).code).toBe(0);
    expect(readFileSync(join(bin, "..", "argv.txt"), "utf8")).toMatch(/^--search exec -m gpt-6-astra -s read-only /);
    const ids = readdirSync(join(r, "docs/assessments")).filter((f) => f.endsWith(".json"));
    expect(ids.map((f) => f.replace(/^\d{4}-\d{2}-\d{2}-/, "")).sort()).toEqual([
      "v0.7-codex-gpt-6-astra-2.json",
      "v0.7-codex-gpt-6-astra.json",
    ]);
  });

  it.each([
    ["an invalid block (total is not the sum)", () => reportWith(block("0.7", 51)), /sum of the five dimensions/],
    ["no block at all", () => "# A report without scores\n", /no ```wos-assessment block/],
    ["a block for another paper version", () => reportWith(block("0.6")), /site served v0\.7/],
  ])("records nothing for %s and keeps the report", async (_n, report, err) => {
    const r = newRoot();
    const out = await exec(["--cli", "claude", "--bin", fakeCli("claude", report()), "--root", r]);
    expect(out.code).toBe(1);
    expect(out.stderr).toMatch(err);
    expect(out.stderr).toMatch(/the report is kept at/);
    expect(readdirSync(join(r, "docs/assessments"))).toHaveLength(0);
  });

  it("refuses to run when the live site shows a different prompt, and never starts the CLI", async () => {
    livePrompt = `${HANDOFF_PROMPT} (older)`;
    try {
      const bin = fakeCli("claude", reportWith(block()));
      const r = newRoot();
      const out = await exec(["--cli", "claude", "--bin", bin, "--root", r]);
      expect(out.code).toBe(1);
      expect(out.stderr).toMatch(/not the one the live \/whitepaper shows/);
      expect(existsSync(join(bin, "..", "stdin.txt"))).toBe(false);
      // --no-live-check runs it and records that the prompt was not matched.
      const ok = await exec(["--cli", "claude", "--bin", bin, "--root", r, "--no-live-check"]);
      expect(ok.code, ok.stderr).toBe(0);
      const f = readdirSync(join(r, "docs/assessments")).find((x) => x.endsWith(".json"))!;
      expect(JSON.parse(readFileSync(join(r, "docs/assessments", f), "utf8")).prompt.matchedLiveSite).toBe(false);
    } finally {
      livePrompt = HANDOFF_PROMPT;
    }
  });

  it("records nothing when the CLI fails", async () => {
    const d = join(tmp, "bin-broken");
    mkdirSync(d);
    const bin = join(d, "claude");
    writeFileSync(
      bin,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo x; exit 0; fi\ncat > /dev/null; echo "usage limit reached" >&2; exit 3\n',
    );
    chmodSync(bin, 0o755);
    const r = newRoot();
    const out = await exec(["--cli", "claude", "--bin", bin, "--root", r]);
    expect(out.code).toBe(1);
    expect(out.stderr).toMatch(/exited with code 3/);
    expect(readdirSync(join(r, "docs/assessments"))).toHaveLength(0);
  });
});
