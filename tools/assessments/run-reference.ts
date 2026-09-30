/**
 * warOnSaaS reference run of the white paper's evaluation brief. RUN BY THE FOUNDER ONLY, on his own machine:
 * it spends his Claude or ChatGPT subscription. Never run it in CI, in tests (they use fake CLIs) or from an agent.
 *
 *   node tools/assessments/run-reference.ts --cli claude            # Claude Code, Opus
 *   node tools/assessments/run-reference.ts --cli codex             # Codex CLI, GPT-6-Astra
 *   node tools/assessments/run-reference.ts --cli codex --commit    # also commits the run (founder as author)
 *
 * What it does, in order (it stops at the first failure and records nothing):
 *   1. Takes the prompt from apps/web/lib/handoff-prompt.ts (HANDOFF_PROMPT, what /whitepaper shows) and checks it
 *      is exactly the prompt the live site serves in its prompt box (--no-live-check skips this and records that).
 *   2. Reads the paper version the live site serves from /whitepaper.md.
 *   3. Runs the CLI once, non-interactively, in an empty temporary directory (so the agent cannot see this
 *      repository or earlier runs before it scores), with web access, the prompt on stdin.
 *   4. Finds the report's `wos-assessment` block and validates it (packages/contracts/src/assessment.ts). A missing
 *      or invalid block, or a block naming another paper version than the site served, is not recorded; the report
 *      is kept in a temporary file for you to read.
 *   5. Writes docs/assessments/<day>-v<version>-<cli>-<model>.json (validated AssessmentRecord) and the verbatim
 *      report as the sibling .md, then refreshes apps/web/generated/assessments.json via scripts/sync-shared.mjs.
 *   6. With --commit, commits exactly those files as adventurini <anthonydventurini@gmail.com>. It never pushes.
 *
 * It never edits, fills or adjusts a score.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AssessmentRecord, extractAssessmentBlock, REFERENCE_SOURCE } from "../../packages/contracts/src/assessment.ts";
import { HANDOFF_PROMPT } from "../../apps/web/lib/handoff-prompt.ts";

export type Cli = "claude" | "codex";
export const DEFAULT_MODEL: Record<Cli, string> = { claude: "opus", codex: "gpt-6-astra" };
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export type Options = {
  cli: Cli;
  model: string;
  /** The site to check the prompt and the served version against. Tests point it at a local fake. */
  site: string;
  liveCheck: boolean;
  acceptVersionMismatch: boolean;
  commit: boolean;
  syncSite: boolean;
  timeoutMinutes: number;
  /** The CLI binary (default: the name on PATH). */
  bin: string;
  root: string;
};

export function parseArgs(argv: string[]): Options {
  const get = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const cli = get("--cli");
  if (cli !== "claude" && cli !== "codex") throw new Error("--cli claude|codex is required");
  return {
    cli,
    model: get("--model") ?? DEFAULT_MODEL[cli],
    site: (get("--site") ?? "https://waronsaas.com").replace(/\/$/, ""),
    liveCheck: !argv.includes("--no-live-check"),
    acceptVersionMismatch: argv.includes("--accept-version-mismatch"),
    commit: argv.includes("--commit"),
    syncSite: !argv.includes("--no-sync"),
    timeoutMinutes: Number(get("--timeout-min") ?? 60),
    bin: get("--bin") ?? cli,
    root: get("--root") ?? ROOT,
  };
}

/** The exact command line for one non-interactive run. The prompt always goes on stdin. */
export function cliCommand(o: Options, workdir: string, outFile: string): { cmd: string; args: string[]; fromFile: boolean } {
  if (o.cli === "claude") {
    return {
      cmd: o.bin,
      // Web access only: the agent may fetch and search, never edit files or run commands. No MCP servers, no saved session.
      args: [
        "-p",
        "--model",
        o.model,
        "--output-format",
        "text",
        "--allowedTools",
        "WebFetch",
        "WebSearch",
        "--strict-mcp-config",
        "--no-session-persistence",
        // No CLAUDE.md, skills, plugins, hooks or other personal customizations, so the founder's own
        // instructions and memory cannot colour the assessment.
        "--safe-mode",
      ],
      fromFile: false,
    };
  }
  return {
    cmd: o.bin,
    // --search is a top-level flag (live web search); read-only sandbox; the last message is the report.
    args: ["--search", "exec", "-m", o.model, "-s", "read-only", "--skip-git-repo-check", "--ephemeral", "-C", workdir, "-o", outFile, "-"],
    fromFile: true,
  };
}

export const sha256 = (s: string) => `sha256:${createHash("sha256").update(s, "utf8").digest("hex")}`;

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** The prompt in the live /whitepaper prompt box, or null if the page has none. */
export function livePrompt(html: string): string | null {
  const m = html.match(/<textarea[^>]*id="wp-prompt"[^>]*>([\s\S]*?)<\/textarea>/);
  return m ? decode(m[1]!).replace(/^\n/, "") : null;
}

/** The Version row of the paper's header table. */
export function servedVersion(md: string): string | null {
  return md.match(/^\|\s*Version\s*\|\s*([0-9]+\.[0-9]+(?:\.[0-9]+)?)\s*\|/m)?.[1] ?? null;
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return res.text();
}

function run(
  cmd: string,
  args: string[],
  cwd: string,
  stdin: string,
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(stdin);
  });
}

function cliVersion(bin: string): string | null {
  try {
    return execFileSync(bin, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim().slice(0, 200) || null;
  } catch {
    return null;
  }
}

export type Outcome = { ok: true; id: string; json: string; md: string } | { ok: false; error: string; keptReport: string | null };

export async function runReference(o: Options, log: (s: string) => void = console.log): Promise<Outcome> {
  const prompt = HANDOFF_PROMPT;

  // 1. The prompt must be the one the public page shows.
  let matchedLiveSite = false;
  if (o.liveCheck) {
    const live = livePrompt(await getText(`${o.site}/whitepaper`));
    if (live !== prompt) {
      return {
        ok: false,
        error:
          "the prompt in apps/web/lib/handoff-prompt.ts is not the one the live /whitepaper shows (deploy first, or pass --no-live-check to record an unmatched run)",
        keptReport: null,
      };
    }
    matchedLiveSite = true;
  }

  // 2. The version the site serves.
  const served = servedVersion(await getText(`${o.site}/whitepaper.md`));
  if (!served) return { ok: false, error: `${o.site}/whitepaper.md has no Version row`, keptReport: null };
  log(`paper served: v${served}; running ${o.cli} (${o.model}); this spends your subscription and can take a while`);

  // 3. One run in an empty directory.
  const work = mkdtempSync(join(tmpdir(), "wos-assessment-"));
  const outFile = join(work, "report.md");
  const { cmd, args, fromFile } = cliCommand(o, work, outFile);
  const version = cliVersion(o.bin);
  const res = await run(cmd, args, work, prompt, o.timeoutMinutes * 60_000);
  const report = fromFile ? (existsSync(outFile) ? readFileSync(outFile, "utf8") : "") : res.stdout;
  const keep = () => {
    const p = join(tmpdir(), `wos-assessment-unrecorded-${Date.now()}.md`);
    writeFileSync(p, `${report}\n\n<!-- stderr:\n${res.stderr.slice(-4000)}\n-->\n`);
    return p;
  };
  rmSync(work, { recursive: true, force: true });
  if (res.code !== 0) return { ok: false, error: `${o.cli} exited with code ${res.code}`, keptReport: keep() };
  if (!report.trim()) return { ok: false, error: `${o.cli} produced no report`, keptReport: keep() };

  // 4. The block, validated. Nothing is repaired.
  const found = extractAssessmentBlock(report);
  if (!found.ok) return { ok: false, error: found.error, keptReport: keep() };
  if (found.block.paperVersion !== served && !o.acceptVersionMismatch) {
    return {
      ok: false,
      error: `the block says paper v${found.block.paperVersion} but the site served v${served} (pass --accept-version-mismatch to record it anyway)`,
      keptReport: keep(),
    };
  }

  // 5. The record and the report.
  const recordedAt = new Date().toISOString();
  const dir = join(o.root, "docs", "assessments");
  mkdirSync(dir, { recursive: true });
  const stem = `${recordedAt.slice(0, 10)}-v${served}-${slug(`${o.cli}-${o.model}`)}`;
  let id = stem;
  for (let n = 2; existsSync(join(dir, `${id}.json`)); n++) id = `${stem}-${n}`;
  const record = AssessmentRecord.parse({
    record: "wos-assessment-record/v1",
    id,
    source: REFERENCE_SOURCE,
    recordedAt,
    runner: { cli: o.cli, cliVersion: version, requestedModel: o.model },
    prompt: { sha256: sha256(prompt), matchedLiveSite },
    servedPaperVersion: served,
    reportFile: `${id}.md`,
    rawBlock: found.raw,
    block: found.block,
  });
  const json = join(dir, `${id}.json`);
  const md = join(dir, `${id}.md`);
  writeFileSync(json, `${JSON.stringify(record, null, 2)}\n`);
  writeFileSync(md, report.endsWith("\n") ? report : `${report}\n`);
  log(`recorded ${json}`);

  const web = join(o.root, "apps", "web");
  if (o.syncSite) execFileSync(process.execPath, [join(web, "scripts", "sync-shared.mjs")], { cwd: web, stdio: "inherit" });

  // 6. Optional commit of exactly these files.
  const files = [json, md, ...(o.syncSite ? [join(web, "generated", "assessments.json")] : [])];
  if (o.commit) {
    execFileSync("git", ["add", "--", ...files], { cwd: o.root });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=adventurini",
        "-c",
        "user.email=anthonydventurini@gmail.com",
        "commit",
        "-m",
        `Assessment: reference run ${id}`,
        "--",
        ...files,
      ],
      { cwd: o.root, stdio: "inherit" },
    );
  } else {
    log(`not committed. To commit: git add ${files.map((f) => f.replace(`${o.root}/`, "")).join(" ")} && git commit`);
  }
  return { ok: true, id, json, md };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const out = await runReference(parseArgs(process.argv.slice(2)));
    if (!out.ok) {
      console.error(`NOT RECORDED: ${out.error}`);
      if (out.keptReport) console.error(`the report is kept at ${out.keptReport}`);
      process.exit(1);
    }
  } catch (e) {
    console.error(`NOT RECORDED: ${(e as Error).message}`);
    process.exit(1);
  }
}
