# The warOnSaaS white paper

`WHITEPAPER.md` is the source of truth. It is a living document: it changes when the design changes, and every change is a commit with a changelog entry at the end of the file.

| File | What it is |
|---|---|
| `WHITEPAPER.md` | The current version (Markdown), written for AI agents. https://waronsaas.com/whitepaper is a handoff page (download, prompt, open in an agent) with the full text collapsed below; https://waronsaas.com/whitepaper.md serves it inline for browsing agents; https://waronsaas.com/whitepaper/download serves it as `warOnSaaS-white-paper-v<version>.md`. |
| `MATERIALITY.md` | Companion file (since v0.6): the sources and the estimation model behind Part I, section 3 (how big the problem is). Its figures are dated and come from `tools/materiality/model.ts`; `tests/materiality.test.ts` fails if the model's committed output (`tools/materiality/OUTPUT.md`) or the verbatim copy in this file drifts. |
| `EDGE-CASES.md`, `DESIGN.md`, `APPENDICES.md`, `SOURCES.md` | Companion files (since v0.5): optional depth the core links to. Served at https://waronsaas.com/whitepaper/<name>.md (lowercase) and together with the core in https://waronsaas.com/whitepaper/full-pack.zip. Anything cut from the core must live in one of these; the core stays under 12,000 words. |
| `WHITEPAPER-v0.1-original.txt` | The founder's v0.1, verbatim. Never edited; kept for history. |

## How the website gets it

- `apps/web/scripts/sync-shared.mjs` copies `WHITEPAPER.md` byte-for-byte to `apps/web/generated/WHITEPAPER.md`, and the companions (including `MATERIALITY.md`) to `apps/web/generated/whitepaper/` (Vercel builds from `apps/web`, so the copy is committed). `npm run check:shared -w apps/web` fails if the copy is stale.
- `apps/web/scripts/gen-log.mjs` records the date and commit of the last change to `docs/whitepaper/WHITEPAPER.md` in `apps/web/generated/whitepaper-meta.json`, from git, at every build.
- The page and the raw download replace the `{{LAST_UPDATED}}` placeholder in the header table with that date. Do not type a date there by hand.
- The page renders a small, fixed Markdown subset (`apps/web/lib/markdown.tsx`): `#`, `##`, `###` headings, paragraphs, `-` and `1.` lists (one level), tables, fenced code blocks, `**bold**`, `` `code` `` and links. Write bare `https://` URLs rather than domain names without a scheme, so the casing gate can tell identifiers from prose.

## How it is kept current

After merges to main, the site-sync agent (`apps/web/SITE-SYNC.md`, run by `.github/workflows/site-sync.yml`) checks `WHITEPAPER.md` against `docs/DECISIONS.md`, the amendments and the protocol documents. When the paper is wrong or out of date it proposes precise edits in its pull request, with:

- a changelog entry at the end of the file saying what changed and why, citing the source file;
- a version bump in the header table: **patch** (0.2 to 0.2.1) for wording, corrections and updated evidence; **minor** (0.2 to 0.3) when a mechanism, a number in the design, or a decision changes. A major version is for the founder.

**Never edit the paper without a version bump and a changelog entry.** The website build enforces it (`apps/web/scripts/check-whitepaper-version.mjs`): if `WHITEPAPER.md` differs from the previous commit's, its Version must be higher and "## Changelog" must have an entry for that version; a changelog entry newer than the header's version also fails.

A human merges the pull request. The agent never invents evidence: every figure in the paper (test counts, links, dates, decisions) must come from a file or a URL it can cite, and unverifiable items are labelled as such.

## Version history (since v0.8)

https://waronsaas.com/whitepaper/changes (for agents: https://waronsaas.com/whitepaper/changes.md, without scores) lists every version newest first: its changelog entry verbatim, the GitHub compare diff from the previous version, the companion files it changed, a "PART I CHANGED" flag when the diff touches Part I (decided from the section headings) or `MATERIALITY.md` / `tools/materiality/model.ts` changed, and the reference runs recorded against it. Every version is readable in full at https://waronsaas.com/whitepaper/v/<version>.

- `apps/web/scripts/gen-whitepaper-history.mjs` derives it from git: the Version row of the header table at each commit that changed the paper, its companions or the materiality model. It writes `apps/web/generated/whitepaper-history.json` and one snapshot per version in `apps/web/generated/whitepaper-history/` (v0.1 is `WHITEPAPER-v0.1-original.txt`, which never had a commit of its own). The rules are in `apps/web/scripts/wp-history-lib.mts`, tested in `tests/wp-history.test.ts`.
- **The files are committed, because Vercel builds from a shallow clone** (depth 10; `git fetch --unshallow` does not work there). A build with full history (local, the site-sync workflow) regenerates them; a shallow build only verifies that the committed files match the working tree (the current version, its text, every tracked file's hash, every changelog entry) and fails if they are stale. After changing the paper, run `npm run build -w apps/web` (or `npm run gen:wp-history -w apps/web`) and commit `apps/web/generated` with the change. The output is a pure function of the committed history and the working tree, so committing it in the same commit as the paper is correct.
- The current version is recorded without its commits (the commit that introduces a version cannot contain its own hash); its diff link runs to main and its date is the last-updated date. The next version bump records them.

## Rules for any editor

- Label claims BUILT (inspectable today, with a link), DESIGNED (draft, not running) or PROPOSED.
- Numbers from the draft protocol are provisional policy values; say so.
- `warOnSaaS` and `wOS` always; `WOS` only for the token; lowercase only inside URLs and identifiers.
- Never promise token value, returns or dates.
- Keep the agent instructions and the report format framed as requests, not commands.

## The handoff prompt

The prompt on /whitepaper lives in `apps/web/lib/handoff-prompt.ts` (`HANDOFF_PROMPT`, and a one-line `HANDOFF_PROMPT_SHORT` for the llms files; re-exported by `apps/web/lib/whitepaper.ts`). It has no imports because `tools/assessments/run-reference.ts` sends exactly that text to the founder's agents. Keep its two stages and eleven points in step with the paper's instructions to the evaluating agent. After the score block and the trend comparison it asks the agent whether its human wants to take part and, only if so, to fetch https://waronsaas.com/contribute.md (the steps on /contribute, generated from `apps/web/lib/contribute.ts`) and walk them through it; contribute.md is not part of the paper, so changing it needs no version bump. Only chat links whose pre-fill was verified in a browser may carry the prompt (today: ChatGPT `?q=`); others open the chat and the user pastes.

## Assessments (since v0.7)

The brief asks the evaluating agent to end its report with a `wos-assessment` score block (spec in the core, "The score block"; machine schema `packages/contracts/src/assessment.ts`). warOnSaaS records only its own reference runs (`tools/assessments/run-reference.ts`, files in `docs/assessments/`), shown at https://waronsaas.com/assessments and https://waronsaas.com/whitepaper/assessments.md.

**Anti-anchoring rule:** no recorded score may appear in the core, a companion file or the full pack, and the assessments file is never a companion. The paper and the prompt tell the agent to open the record only after writing its own block. `tests/assessments.test.ts` checks the template in the core parses against the schema and that the record stays out of the companions and the pack. `scripts/check-numbers.mjs` fails the build if /whitepaper/read, /whitepaper.md, the download, /whitepaper/changes.md or a companion carries a score figure, a score ring or a link to a recorded run. The human handoff page /whitepaper shows the current version's self-assessment as score rings, after the handoff buttons and the prompt, under "Evaluating as an agent? Score first; these are our own runs." When the score block changes, bump the schema (next: `wos-assessment/v3`) and the paper together.

## Self-assessment and gaps (since v0.9)

Founder directive (2026-09-30): "The white paper should always ship with a self-assessment, as well as rooms for improvement, gaps, etc."

- **Every version gets a self-assessment.** After a push to main that changes `WHITEPAPER.md`, `.github/workflows/self-assessment.yml` waits until https://waronsaas.com/whitepaper.md serves the new version, runs `tools/assessments/run-reference.ts --cli claude --commit` on the founder's `CLAUDE_CODE_OAUTH_TOKEN`, and pushes the recorded run (`docs/assessments/*` and the site's derived copies) to main. Codex (Astra) runs stay manual, on the founder's machine: Codex signs in with a ChatGPT login that cannot be automated.
- **No version is superseded unassessed.** `apps/web/scripts/check-whitepaper-version.mjs` fails the build of a new version while any older version has no recorded run (`servedPaperVersion` match). v0.1 to v0.8 predate the rule and are exempt by a frozen list (`GRANDFATHERED_UNASSESSED` in `apps/web/scripts/wp-history-lib.mts`); never add to it. So v0.10 cannot ship until v0.9 has a run. Until the current version's run lands, /whitepaper, /whitepaper/changes and /assessments show SELF-ASSESSMENT PENDING.
- **Gaps and improvements.** Since v0.9 the score block is `wos-assessment/v2` (contracts 5.2.0): at most 10 gaps (id slug, title, the section or thesis, Part I or II, severity) and at most 10 improvements (the change, the gap it answers, the scores it would raise). `wos-assessment/v1` records stay valid. The runner refuses a block in another schema than the one the served paper's template declares.
- **The gap register** (https://waronsaas.com/assessments/gaps, `.md` for agents after scoring) lists every gap from the latest run of each version with its status. It is generated at build (`apps/web/scripts/sync-shared.mjs` into `apps/web/generated/gap-register.json`, rules in `buildGapRegister`).
- **Changelog convention.** A version's changelog entry may cite gap ids it addresses or declines, one line each:

  ```
  - Gaps addressed: `duplication-share-unsourced`, `no-pilot-data`
  - Gap declined: `token-needed`: the reason, in one sentence
  ```

  A gap from version N is addressed (or declined) by the newest later version whose entry cites its exact id; otherwise it is open. **Matching is by exact id only**, never by similar wording or a model's judgment: two runs that name the same problem with different ids stay two gaps. The build warns (it does not fail) when a new version's entry leaves a high-severity gap of the previous version's latest run unmentioned.
