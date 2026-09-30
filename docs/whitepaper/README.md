# The warOnSaaS white paper

`WHITEPAPER.md` is the source of truth. It is a living document: it changes when the design changes, and every change is a commit with a changelog entry at the end of the file.

| File | What it is |
|---|---|
| `WHITEPAPER.md` | The current version (Markdown). Rendered at https://waronsaas.com/whitepaper and served raw for agents at https://waronsaas.com/whitepaper.md |
| `WHITEPAPER-v0.1-original.txt` | The founder's v0.1, verbatim. Never edited; kept for history. |

## How the website gets it

- `apps/web/scripts/sync-shared.mjs` copies `WHITEPAPER.md` byte-for-byte to `apps/web/generated/WHITEPAPER.md` (Vercel builds from `apps/web`, so the copy is committed). `npm run check:shared -w apps/web` fails if the copy is stale.
- `apps/web/scripts/gen-log.mjs` records the date and commit of the last change to `docs/whitepaper/WHITEPAPER.md` in `apps/web/generated/whitepaper-meta.json`, from git, at every build.
- The page and the raw download replace the `{{LAST_UPDATED}}` placeholder in the header table with that date. Do not type a date there by hand.
- The page renders a small, fixed Markdown subset (`apps/web/lib/markdown.tsx`): `#`, `##`, `###` headings, paragraphs, `-` and `1.` lists (one level), tables, fenced code blocks, `**bold**`, `` `code` `` and links. Write bare `https://` URLs rather than domain names without a scheme, so the casing gate can tell identifiers from prose.

## How it is kept current

After merges to main, the site-sync agent (`apps/web/SITE-SYNC.md`, run by `.github/workflows/site-sync.yml`) checks `WHITEPAPER.md` against `docs/DECISIONS.md`, the amendments and the protocol documents. When the paper is wrong or out of date it proposes precise edits in its pull request, with:

- a changelog entry at the end of the file saying what changed and why, citing the source file;
- a version bump in the header table: **patch** (0.2 to 0.2.1) for wording, corrections and updated evidence; **minor** (0.2 to 0.3) when a mechanism, a number in the design, or a decision changes. A major version is for the founder.

A human merges the pull request. The agent never invents evidence: every figure in the paper (test counts, links, dates, decisions) must come from a file or a URL it can cite, and unverifiable items are labelled as such.

## Rules for any editor

- Label claims BUILT (inspectable today, with a link), DESIGNED (draft, not running) or PROPOSED.
- Numbers from the draft protocol are provisional policy values; say so.
- `warOnSaaS` and `wOS` always; `WOS` only for the token; lowercase only inside URLs and identifiers.
- Never promise token value, returns or dates.
- Keep the agent instructions and the report format framed as requests, not commands.
