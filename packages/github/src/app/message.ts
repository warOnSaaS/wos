/** Commit message, PR body and provenance rendering for App-authored objects. Internal to ./app. */
import { COMMIT_TRAILERS, ProvenanceRecord } from "@waronsaas/contracts";
import { canonicalJson, provenanceSha256 } from "@waronsaas/contracts/canonical";
import { GithubAppError } from "./client.js";
import type { CommitIdentity } from "./index.js";

const CO_AUTHORED_BY = "Co-authored-by";
const TRAILER_KEY = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;
/** Trailer lines the caller's free-text message must not smuggle in (they would forge provenance). */
const RESERVED_LINE = /^\s*(co-authored-by|wos-[a-z-]+|signed-off-by)\s*:/i;
const NOREPLY_COAUTHOR = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])? <\d+\+[A-Za-z0-9-]+@users\.noreply\.github\.com>$/;

const KNOWN_ORDER: string[] = [
  COMMIT_TRAILERS.task,
  COMMIT_TRAILERS.attempt,
  COMMIT_TRAILERS.abu,
  COMMIT_TRAILERS.manifest,
  COMMIT_TRAILERS.contributor,
];

function reject(message: string): never {
  throw new GithubAppError("INVALID_INPUT", message);
}

/**
 * Message = the caller's subject/body, a blank line, then trailers in BUILD-PROTOCOL order:
 * wOS-Task, wOS-Attempt, wOS-Abu, wOS-Manifest, wOS-Contributor, any other trailers sorted by key,
 * and Co-authored-by last. A Co-authored-by trailer with the contributor's noreply address is
 * mandatory (D9). Newlines inside trailers and trailer-shaped lines in the message are refused.
 */
export function buildCommitMessage(identity: CommitIdentity): string {
  const text = identity.message.replace(/\s+$/, "");
  if (text.trim() === "") reject("commit message is empty");
  if (text.includes("\r") || text.includes("\u0000")) reject("commit message contains CR or NUL");
  for (const line of text.split("\n")) {
    if (RESERVED_LINE.test(line)) reject(`commit message contains a reserved trailer line: ${JSON.stringify(line)}`);
  }
  const entries = Object.entries(identity.trailers);
  for (const [k, v] of entries) {
    if (!TRAILER_KEY.test(k)) reject(`invalid trailer key ${JSON.stringify(k)}`);
    if (v.trim() === "" || /[\r\n]/.test(v) || v.includes("\u0000")) reject(`invalid value for trailer ${k}`);
  }
  const coAuthor = identity.trailers[CO_AUTHORED_BY];
  if (coAuthor === undefined) reject("Co-authored-by trailer is required (D9)");
  if (!NOREPLY_COAUTHOR.test(coAuthor)) reject("Co-authored-by must be `<login> <<id>+<login>@users.noreply.github.com>`");

  const rank = (k: string) => {
    if (k === CO_AUTHORED_BY) return 1_000;
    const i = KNOWN_ORDER.indexOf(k);
    return i === -1 ? 100 : i;
  };
  const sorted = entries.sort(([a], [b]) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
  return `${text}\n\n${sorted.map(([k, v]) => `${k}: ${v}`).join("\n")}\n`;
}

export function validateAuthor(author: { name: string; email: string }): void {
  if (!author.name.trim() || /[<>\r\n]/.test(author.name) || author.name.includes("\u0000")) reject("invalid commit author name");
  if (!/^[^\s<>@]+@[^\s<>@]+$/.test(author.email)) reject("invalid commit author email");
}

/** Marker the App uses to find and replace its provenance section in a PR body. */
export const PROVENANCE_MARKER = "<!-- wos-provenance -->";

/** GitHub's PR and issue body limit, in characters. */
export const GITHUB_BODY_LIMIT = 65_536;

/**
 * The provenance section appended to an official PR body: the record's JCS sha256 and the record
 * itself. The record must carry the PR's own number, which only exists after the PR is opened, so
 * `openPullRequest` fills `prNumber` and then writes this section (contracts 2.0.0 rule, B-0002-github-build).
 */
export function renderProvenanceSection(record: ProvenanceRecord): { section: string; sha256: string } {
  const parsed = ProvenanceRecord.parse(record);
  const sha256 = provenanceSha256(parsed);
  const section = [
    PROVENANCE_MARKER,
    "### wOS provenance",
    "",
    `Provenance record \`${sha256}\` (RFC 8785 canonical JSON, contracts ${record.contractsVersion}).`,
    "",
    "<details><summary>Record</summary>",
    "",
    "```json",
    canonicalJson(parsed),
    "```",
    "",
    "</details>",
  ].join("\n");
  return { section, sha256 };
}

export interface QualificationRow {
  /** 1..9, BUILD-PROTOCOL.md section 9. */
  check: number;
  title: string;
  passed: boolean;
  evidence: string;
}

export interface ReviewRow {
  slot: string;
  reviewerLogin: string;
  model: string;
  reasoning: string;
  verdict: string;
  independence: string;
}

/** Renders the standard official PR body (objective, qualification table, reviews). Helper for the control plane. */
export function renderPullRequestBody(input: {
  objective: string;
  qualification: QualificationRow[];
  reviews: ReviewRow[];
  footer?: string;
}): string {
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const lines = [
    "Opened by the warOnSaaS wOS GitHub App after machine-checked qualification. Contributors never open PRs (D9).",
    "",
    "### Objective",
    "",
    input.objective.trim(),
    "",
    "### Qualification",
    "",
    "| # | Check | Result | Evidence |",
    "|---|---|---|---|",
    ...input.qualification.map((q) => `| ${q.check} | ${cell(q.title)} | ${q.passed ? "pass" : "FAIL"} | ${cell(q.evidence)} |`),
    "",
    "### Reviews",
    "",
    "| Slot | Reviewer | Model | Reasoning | Verdict | Independence |",
    "|---|---|---|---|---|---|",
    ...input.reviews.map(
      (r) =>
        `| ${cell(r.slot)} | ${cell(r.reviewerLogin)} | ${cell(r.model)} | ${cell(r.reasoning)} | ${cell(r.verdict)} | ${cell(r.independence)} |`,
    ),
  ];
  if (input.footer) lines.push("", input.footer.trim());
  return lines.join("\n");
}
