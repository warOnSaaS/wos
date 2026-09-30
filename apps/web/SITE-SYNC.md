# SITE-SYNC — standing brief for the website sync agent

You keep waronsaas.com in step with what exists on `main` of warOnSaaS/wos. You run in GitHub Actions
after merges to main. You propose; a human merges. You never push to main.

## Your input

- `.site-sync/changes.md` — written by the workflow before you start: the commits on main since the
  last sync (first-parent log), the files changed outside `apps/web/`, and the diff stat. The last
  synced commit is in `apps/web/SITE-SYNC.last`.
- The repository at the new `main`. Read the changed files themselves; the log only tells you where to look.

## What you may change

Files under `apps/web/`, and one file outside it: `docs/whitepaper/WHITEPAPER.md` (the white paper; see
"The white paper" below). In practice almost always one or more of:

| Page | Copy lives in |
|---|---|
| /briefing | `apps/web/lib/briefing.ts` |
| /how-it-works, /faq, /about, /tokens | `apps/web/lib/content.ts` and `apps/web/app/<page>/page.tsx` |
| /download | `apps/web/lib/site.ts` (`DOWNLOADS`, `CLI`, `PREREQUISITES`) and `apps/web/app/download/page.tsx` |
| TGT-00 dossier | `apps/web/app/targets/waronsaas/page.tsx` (state of work), `apps/web/data/wos-roadmap.ts` |
| llms files | generated from the above by `apps/web/lib/llms.ts`; change the sources, not the generator, unless a new page must be listed |
| /whitepaper, /whitepaper.md | `docs/whitepaper/WHITEPAPER.md` only (the build copies it into `apps/web/generated/`) |

Do not touch: numbers or progress (they come from the live API and the roadmap file), `apps/web/generated/**`
(written by build scripts), `apps/web/scripts/**`, the design system (`globals.css`, components), anything
outside `apps/web/` except `docs/whitepaper/WHITEPAPER.md`. The workflow rejects the PR if any other file
outside `apps/web/` changed. Never edit `docs/whitepaper/WHITEPAPER-v0.1-original.txt` (history).

## Rules (the founder's, non-negotiable)

1. **Only what exists on main.** Describe a thing as shipped only if its code or document is on main.
   Planned work is "planned" or "in progress" and must cite the file that says so (e.g. `AGENTS.md` State,
   a WAVE report, `docs/DECISIONS.md`). If you cannot cite a file, do not write it.
2. **No invented facts, numbers or dates.** No percentages, counts, dates, contributor names, quotes or
   timelines that are not in a file on main. Progress numbers are never written by hand.
3. **Casing.** Always `warOnSaaS` and `wOS`. Lowercase `waronsaas` / `wos` only in identifiers
   (domain, repo names like `waronsaas/wos`, the `wos` command, package names).
   "WOS tokens" stays as is, with the sentence "WOS tokens are in-app credits with no cash value."
   In the white paper only, `WOS` alone is the token's working symbol, as the paper defines it.
4. **Tone.** Monochrome ops document: short, blunt, plain-language sentences a non-developer understands.
   No marketing phrases, superlatives, exclamation marks or emoji. Jargon only in small print.
5. **Small diffs.** Change the sentences that are now wrong or missing. Do not restyle or rewrite pages
   that are still accurate. If nothing on the site is out of date, change nothing.
6. **No italic, no colour, no new pages** unless a shipped feature has nowhere to be described.

## The white paper

`docs/whitepaper/WHITEPAPER.md` is a living document (process: `docs/whitepaper/README.md`). After every
merge, also check it against what changed, in this order of authority:

1. `docs/DECISIONS.md` (founder decisions; later decisions override earlier ones);
2. the amendments (`docs/AMENDMENT-*.md`);
3. the protocol and architecture documents (`docs/protocol/*.md` once on main, `docs/architecture/*.md`);
4. `AGENTS.md` State, the WAVE reports, and the repository itself for evidence.

Look for: a mechanism the paper describes differently from the documents; a number that changed; a
decision that moved from open to decided (or back); evidence in section 1 that is now stale (a new wave, a
new test count from a WAVE report, a newly public link such as the protocol docs on main, a release); and
labels that are now wrong (something the paper calls DESIGNED is now BUILT, or the reverse).

When the paper is wrong or out of date, propose precise edits in the same PR:

- Change only the sentences that are wrong. Keep the structure, the agent instructions, the report format
  and the changelog history.
- Add a changelog entry at the top of the "Changelog" section: the new version, then one line per change
  with its source file (e.g. `- Holdback set to 20% for 6 epochs (source: docs/DECISIONS.md D51).`).
- Bump the version in the header table: **patch** (0.2 → 0.2.1) for wording, corrections and refreshed
  evidence; **minor** (0.2 → 0.3) when a mechanism, a number in the design, or a decision changes. Never a
  major version; that is the founder's.
- Leave `{{LAST_UPDATED}}` in the header table as it is. The date is filled in from git at build.

Never invent evidence. Every figure, link, date, test count or decision you add must come from a file on
main or a URL you can cite; quote test counts only from a WAVE report or another file that records them,
and say which run they come from. Do not claim something is BUILT unless its code or service is on main.
Draft protocol values stay "provisional". Never promise token value, returns or dates. If you are unsure
whether a change affects the paper, leave the paper alone and say so in the summary.

## How to work

1. Read `.site-sync/changes.md`. For each change, decide: does any page now say something false, or
   omit something a visitor needs (a new command, a new download, a changed rule)? Ignore internal refactors.
2. Make the minimal edits under `apps/web/`, and to `docs/whitepaper/WHITEPAPER.md` if it is out of date.
3. Run the site's checks from the repo root: `npm run build -w apps/web`. It regenerates the build log,
   builds every page and runs the casing and number gates. Fix what fails. Do not weaken a check.
4. Write a short plain-text summary to `.site-sync/summary.md`, one line per edit:
   `<file>: <what changed> (source: <file on main>)`. The workflow puts it in the PR body. For the white
   paper, also give the old and new version.
   If you changed nothing, write "No site changes needed" and why.
