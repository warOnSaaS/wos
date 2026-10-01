# GLM: the candidate trial on the Salesforce roadmap (D69, D70)

The founder decided (2026-09-30) that GLM goes first on the real Salesforce roadmap, and Opus runs only if GLM falls short. GLM runs on the founder's **OpenCode Go** subscription through the **opencode CLI**. The work goes through the normal pipeline: validation, the Astra review plus the founder's human seat (D53, D67), and the PR. It may merge at consensus. Everything it produces is labelled `candidate_trial:glm`.

Nothing here was run against a model when this was written. The flags come from `opencode run --help`, `opencode models --verbose` and `opencode providers list` on opencode 1.18.31 (no model call), and from opencode.ai/docs.

## What is verified

| Fact | Value | Source |
|---|---|---|
| GLM model on OpenCode Go | `opencode-go/glm-5.3` (GLM-5.3), 1,000,000-token context, 131,072 output tokens, released 2026-08-14 | `opencode models opencode-go --verbose`, opencode 1.18.31 |
| Highest reasoning setting | `--variant max` (variants: `low`, `high`, `max`) | same listing; `opencode run --help` (`--variant`) |
| GLM-5.3 is GLM's flagship | "All plans support GLM-5.3, GLM-5.3-Flash"; efforts low, high, max, with max as the default and recommended for coding | https://docs.z.ai/devpack/overview, https://docs.z.ai/guides/llm/glm-5.3 |
| Z.ai's Anthropic-compatible endpoint (alternative path, not wired) | `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic`, model `glm-5.3` | https://docs.z.ai/devpack/tool/claude |
| opencode permissions | keys read, edit, glob, grep, bash, task, skill, lsp, question, webfetch, websearch, external_directory, doom_loop; values allow, ask or deny; the last matching rule wins; `agent.<name>.permission` overrides. wOS's run config is accepted by `opencode debug config` (1.18.31), which refuses a URL pattern map for webfetch | https://opencode.ai/docs/permissions/; `opencode debug config` |

## How wOS runs GLM

```
OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX=131072 opencode run -m opencode-go/glm-5.3 --format json --pure --dir <worktree> --title <session> --variant high "<instructions>"
```

- **Input.** The task and its context go on stdin. wOS never passes `--auto`.
- **Configuration.** A per-run configuration is passed in `OPENCODE_CONFIG_CONTENT`. Every permission is allow or deny, never ask:
  - read, glob, grep and list are allowed;
  - edit is allowed in the worktree only (`external_directory` is denied);
  - bash is denied;
  - `task` (sub-agents) is allowed;
  - `webfetch` and `websearch` are allowed (D70). opencode 1.18.31 cannot limit fetches to domains (it refuses a URL pattern map), so wOS checks every fetched URL against the Salesforce allowlist after the run and refuses the submission if one is off it;
  - everything else is denied.
- **Sub-agents.** opencode's `general` and `explore` agents are read-only, with no web and no nesting. The run's instructions cap them at 4 running at once, with the split from D69: sales and pipeline; service and cases; platform, customisation and automation; data, administration and security; the D59 migration.
- **Isolation.** `XDG_CONFIG_HOME` points at an empty per-run directory, so your own opencode agents, plugins and MCP servers are not loaded. Your OpenCode Go login is used as opencode stores it. wOS never reads `~/.local/share/opencode/auth.json`.
- **Output.** The agent writes its `author-summary.v1` to `.wos-agent-output.json` in the worktree. wOS reads it, validates it (fail closed) and removes it before capturing the changes.
- **What the run record keeps.** The signed agent run records:
  - `launch {provider: opencode-go, identity: self_reported}`;
  - the sub-agent count and the measured concurrency;
  - every fetch (URL, time, sha256) and every search;
  - the tokens as opencode reports them.
- **Refusals after the run.** A fetch off the allowlist refuses the submission.

## One-time setup (founder)

1. **opencode is logged in to OpenCode Go.**
   - Check it with `~/.nvm/versions/node/v20.19.2/bin/opencode providers list`. It should list "OpenCode Go api".
   - wOS finds opencode under any nvm Node version, so it does not need to be on the Node 22 PATH.
   - wOS never needs your key. Do not create `~/.waronsaas/zai.env`: that belonged to the Z.ai path, which is not used.
2. **The coordinator applies production migration 0015** before the first GLM claim. Use the runner and list with `--check` first:

   ```sh
   cd ~/waronsaas && git checkout main && git pull && nvm use 22 && npm ci --ignore-scripts && npm run build
   set -a; . ~/.waronsaas/neon.env; set +a      # DATABASE_URL_UNPOOLED (owner); never printed
   DATABASE_MIGRATION_URL="$DATABASE_URL_UNPOOLED" node packages/db/dist/cli.js --check --dir packages/db/migrations
   DATABASE_MIGRATION_URL="$DATABASE_URL_UNPOOLED" node packages/db/dist/cli.js --dir packages/db/migrations
   ```

   Expected: `0015_candidate_trials` pending, then applied, with 0007 and 0010 excluded by their marker. If `0014_bootstrap_founder_human_seat` is still pending, it is applied in the same run.
   - The API deploys from main before this and tolerates the gap.
   - Until 0015 is applied, no trial can be assigned, opencode attestations are not stored, and every GLM claim is refused.
3. **Rebuild the CLI from main** and attest opencode:

   ```sh
   cd ~/waronsaas && npm run build && npm run bundle -w @waronsaas/cli
   node apps/cli/dist/wos.mjs status
   ```

   Expect a line `opencode 1.18.31, signed in (opencode-go), models glm`.

## The trial

1. **Designate the Salesforce roadmap_author task for glm** (maintainer; public, forward-only). There is no `wos` command for maintainer actions; this uses the founder's CLI session exactly as FIRST-REAL-RUN.md 4.3 does, without printing the token:

   ```sh
   cd ~/waronsaas && nvm use 22 && node apps/cli/dist/wos.mjs status >/dev/null
   KEY=$(uuidgen | tr A-Z a-z); echo "idempotency key $KEY"   # reuse the same key if you retry
   WOS_KEY=$KEY node --input-type=module -e '
   import { createRequire } from "node:module";
   const require = createRequire(process.cwd() + "/package.json");
   const { AsyncEntry } = require("@napi-rs/keyring");
   const s = JSON.parse(await new AsyncEntry("com.waronsaas.wos", "wos.session.v1").getPassword());
   if (Date.parse(s.accessExpiresAt) - Date.now() < 120000) { console.error("access token expires within 2 min: run wos status, then retry"); process.exit(1); }
   const r = await fetch("https://api.waronsaas.com/v1/admin/actions", {
     method: "POST",
     headers: { authorization: `Bearer ${s.accessToken}`, "idempotency-key": process.env.WOS_KEY, "content-type": "application/json", accept: "application/json" },
     body: JSON.stringify({ action: "assign_candidate_trial", taskId: "01a0f47a-0b77-7043-9299-0b237bb8d59c", candidate: "glm",
                            reason: "D69: GLM first on the Salesforce roadmap v1 (founder, 2026-09-30); Opus only if GLM falls short" }),
   });
   console.log(r.status, await r.text());'
   ```

   The response is `200 {"ok":true}`. The public event `task.candidate_trial_assigned` records it. `wos tasks --kind roadmap_author --target salesforce` shows the task with `candidateTrial: glm`.

2. **Run GLM** (it spends the founder's OpenCode Go quota, not Claude credits):

   ```sh
   cd ~/waronsaas && nvm use 22
   caffeinate -i node apps/cli/dist/wos.mjs roadmap 01a0f47a-0b77-7043-9299-0b237bb8d59c --provider opencode --model glm-5.3
   ```

   - The CLI claims with `model: glm` and `launch {provider: opencode-go}`.
   - It builds the same roadmap_author context Opus would get: the scan, the three outline proposals, D59, and D70's Salesforce allowlist.
   - It runs opencode as above, validates locally and submits.
   - Validation failures come back as a new author task with the errors. The trial covers it, so run the same command with the new task id (`wos tasks --kind roadmap_author --target salesforce`).

3. **Reviews run as normal.**
   - Astra claims the roadmap review. Its plan has the same allowlist and the server document `wos:fetches/<document>`, which lists what GLM read.
   - Then comes the founder's human seat: `wos review --human` (D53, D67).
   - The PR is labelled `wos:roadmap` and `candidate_trial:glm`. The round comment and the commits (trailer `wOS-Candidate-Trial`) carry the label.
   - At consensus it may merge like any roadmap.

4. **If GLM falls short**, the maintainer takes one of two paths:
   - **Abandon the document** (`maintainerAction abandon_document`).
   - **Revoke the trial**, and the next author task goes to Opus:

     ```sh
     # same snippet as step 1 with this body:
     { "action": "revoke_candidate_trial", "taskId": "<the open author task>", "reason": "GLM fell short: <why>; reassigned to Opus" }
     node apps/cli/dist/wos.mjs roadmap <task> --model opus
     ```

5. **Compare later.** If an Opus version is ever produced, compare the two branches. The command and the caveats are in tools/experiments/roadmap-drift/README.md.

   ```sh
   node tools/experiments/roadmap-drift/compare.ts <glm checkout> <opus checkout> --target salesforce --out docs/experiments/roadmap-drift/salesforce/glm-vs-opus
   ```

## Alternative: Z.ai GLM Coding Plan (documented, not wired)

Z.ai documents running Claude Code against its Anthropic-compatible endpoint:
- `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic`;
- `ANTHROPIC_AUTH_TOKEN` set to your own key, in your environment or `~/.claude/settings.json`, never in wOS;
- `ANTHROPIC_MODEL=glm-5.3`;
- `API_TIMEOUT_MS=3000000`.

GLM-5.3 always reasons (efforts low, high and max; the default is max). How the claude CLI's `--effort` maps on that endpoint is not documented. capability-policy.v3 lists this as `alternativeProviders: [zai]`, but agent-policy.v2 has no model for it yet.

One safeguard already applies. If your claude settings point the CLI at another vendor's endpoint and the answers come from a non-Anthropic model, a claude run for an Anthropic model fails with `MODEL_MISMATCH`.


## Trial run 1 and the retry (agent-policy.v3, contracts 5.19.0)

**What happened in run 1.** The agent exited 0 after 16m34s, but the result was `AGENT_OUTPUT_INVALID`. Its last step ended with finish reason `length`: input 776, output 0, reasoning 32,000, cache read 97,673. opencode caps every step's output at 32,000 tokens by default, and reasoning counts against that cap. At `max`, GLM spent the whole cap thinking and wrote nothing.

**The fixes in agent-policy.v3.** v2 is unchanged: the API had issued v2 plans.
- **Output cap.** opencode's cap is raised to glm-5.3's 131,072-token output limit (`OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX`, read from opencode 1.18.34's source).
- **Reasoning and sampling.** glm authors run at `high` reasoning and temperature 0 (both policy data; see D72).
- **Writing order.** The agent writes its files step by step and its output last (the D72 method, for every author).
- **Failed runs.** A failed run archives its partial files under `~/.wos/failed/<task>/<run>/` and releases its lease.
- **Usage.** The run prints `usage total in …, out …, reasoning …, cache read …, cost $… (as reported), N step(s), last finish …`, and the signed run record keeps the same figures.

**Retry. Wait until main is green on GitHub and waronsaas-api has deployed it**: the server must issue agent-policy.v3 plans to a v3 CLI.

```sh
cd ~/waronsaas && git pull && nvm use 22 && npm ci --ignore-scripts && npm run build && npm run bundle -w @waronsaas/cli
# Run 1's lease (a v2 plan) must go: release it. If it says the lease is not held, it already expired.
node apps/cli/dist/wos.mjs release 01a0f4bb-ccf4-7960-98f1-9d75b801a7bd --reason "GLM trial run 1: AGENT_OUTPUT_INVALID (opencode 32000-token step cap)"

# B, shadow first. Same claim and context as the real run; nothing submitted; lease released at the end:
caffeinate -i node apps/cli/dist/wos.mjs roadmap 01a0f47a-0b77-7043-9299-0b237bb8d59c --provider opencode --model glm-5.3 --shadow

# A, the real run (submits; validation and review follow):
caffeinate -i node apps/cli/dist/wos.mjs roadmap 01a0f47a-0b77-7043-9299-0b237bb8d59c --provider opencode --model glm-5.3
```

- **Order.** B runs before A. A submission moves the document's head, so a shadow run after A would get a different context.
- **Checking the context matches.** Both runs print `context built … manifest <hash>`; the hashes match when product main has not moved in between. The shadow archive's run.json records the full hash.
- **If A fails validation**, the trial covers the new author task. Run the same command with that task's id (`node apps/cli/dist/wos.mjs tasks --kind roadmap_author --target salesforce`).

**Compare A and B (GLM vs GLM).**

```sh
git clone https://github.com/warOnSaaS/product ~/product 2>/dev/null; git -C ~/product fetch origin
node tools/experiments/roadmap-drift/compare.ts ~/.wos/shadow/01a0f47a-0b77-7043-9299-0b237bb8d59c/<run> ~/product@origin/wos/roadmap/salesforce/v1 \
  --target salesforce --out docs/experiments/roadmap-drift/salesforce/glm-shadow-vs-glm-real
```

The report covers:
- validator errors, including the D72 scan and rubric checks;
- inventory overlap by source URL and normalised title;
- capability overlap;
- weight deltas, as mean absolute difference and Spearman rank correlation;
- D59 completeness and citation share;
- for the shadow side, inventory sources found in its fetch log and the required reading it read;
- coverage of the 52 Salesforce scan capabilities.
