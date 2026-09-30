# Reference runs of the white paper's evaluation brief

`run-reference.ts` evaluates the live white paper with one of the founder's own agents and records the result in
`docs/assessments/`. It spends the founder's Claude or ChatGPT subscription, so only two callers run it:

- **CI, once per paper version (since v0.9):** `.github/workflows/self-assessment.yml` runs
  `run-reference.ts --cli claude --commit` on the founder's `CLAUDE_CODE_OAUTH_TOKEN` after a paper change reaches the
  site (`wait-for-version.ts` polls https://waronsaas.com/whitepaper.md until it serves the repo's version), then pushes
  the recorded run to main. It fails at once if the secret is missing. Run it by hand from the Actions tab
  (workflow_dispatch) to assess the current version again.
- **The founder, by hand:** everything else, and every Codex run. Codex CLI signs in with a ChatGPT login, which
  cannot be automated in CI, so Astra runs stay manual.

Coding agents never run it. Tests exercise it with fake `claude` and `codex` binaries (`tests/assessments.test.ts`)
and the wait with a local fake site (`tests/self-assessment.test.ts`).

Every paper version must have at least one recorded run before the next version can ship (the website build enforces
it; see `docs/whitepaper/README.md`, "Self-assessment and gaps").

## Before a run

1. The prompt you are about to test must be live: deploy first. The script refuses when the prompt in
   `apps/web/lib/handoff-prompt.ts` differs from the prompt box on https://waronsaas.com/whitepaper.
2. Be signed in: `claude` (Claude Code with your Claude subscription), `codex` (Codex CLI signed in with ChatGPT).
3. `nvm use 22`, from the repository root, on a branch you can commit to.

## Run

```
node tools/assessments/run-reference.ts --cli claude            # Claude Code, --model opus
node tools/assessments/run-reference.ts --cli codex             # Codex CLI, --model gpt-6-astra, live web search
node tools/assessments/run-reference.ts --cli codex --commit    # also commit the three files (never pushes)
```

Options: `--model <name>` (the CLI's own model name), `--timeout-min 60`, `--commit`,
`--no-live-check` (records `matchedLiveSite: false`), `--accept-version-mismatch` (records a block that names a
different paper version than the site served), `--no-sync` (skip refreshing `apps/web/generated/assessments.json`).

Each run happens in an empty temporary directory, so the agent cannot read this repository or earlier runs before it
scores. Claude runs with `WebFetch` and `WebSearch` only, no MCP servers; Codex runs read-only with live search.
Your user-level CLI settings still apply (for Claude Code: your global instructions and memory); keep nothing about
earlier scores there.

## What gets recorded

On success, three files change: `docs/assessments/<day>-v<version>-<cli>-<model>.json` (the validated record),
the sibling `.md` (the full report, verbatim) and `apps/web/generated/assessments.json` (the site's copy). Push and
merge as usual; the site shows the run at https://waronsaas.com/assessments after the deploy.

Since v0.9 the paper's template declares `wos-assessment/v2` (with gaps and improvements); the script refuses a block in
any other schema than the one the served paper declares. `apps/web/generated/gap-register.json` is refreshed and
committed with the run.

Nothing is recorded when the CLI fails, the report has no valid `wos-assessment` block, or the block names another
paper version; the report is kept in a temporary file and the path is printed. Never write or edit a run by hand.

GLM (through Claude Code on Z.ai's endpoint) can be added later as a third runner once it is qualified.
