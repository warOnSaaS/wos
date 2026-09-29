# @waronsaas/orchestrator

The one workflow driver behind wOS CLI (`wos`) and wOS Desktop (main process). It implements the
`Orchestrator` interface frozen in `packages/contracts/src/orchestrator.ts`. The apps contain no
workflow logic: they build an orchestrator, call one method per command or button, and render the
`OrchestratorEvent`s it streams. Owner: github-build.

## Creating one

```ts
import { HOSTS } from "@waronsaas/contracts";
import { createNodeProcessRunner, createOrchestrator } from "@waronsaas/orchestrator";

const wos = createOrchestrator({
  apiBaseUrl: HOSTS.api,                    // https://api.waronsaas.com
  workspaceRoot,                            // e.g. ~/.wos (mirrors, worktrees, per-attempt state)
  secrets,                                  // SecretStore: @napi-rs/keyring (CLI), safeStorage (Desktop)
  processes: createNodeProcessRunner(),     // spawns git, claude, codex, verify steps; no shell
  fetch: globalThis.fetch,
  clientKind: "cli",                        // or "desktop"
  clientVersion,
});
```

Optional dependencies (tests and fake runs): `engines`, `now`, `sleep`, `pollIntervalMs` (default
5000), `baseEnv` (default PATH, HOME, USER, LANG, TMPDIR; nothing else from the environment reaches an
agent), `platform` (the OS to attest).

The SecretStore holds two keys and nothing else: `wos.session.v1` (access and refresh token, device id)
and `wos.device-key.v1` (the Ed25519 device key, PKCS#8 PEM, created on first use). Model credentials
are never read (D1).

## Commands to methods

| CLI command / Desktop action | Method | Notes |
|---|---|---|
| `wos login` | `signIn({email, deviceName}, prompt, observer)` | `prompt.code()` returns the typed 8-character code; Desktop also passes `prompt.deepLinks` (its `wos://auth?r=&t=` handler). A link for another request is ignored with a `warning` event. A wrong code is retried up to 5 times through `prompt.code()`. Events `sign_in`. |
| `wos link-github` | `linkGithub(observer, openUrl)` | `openUrl(verificationUri, userCode)`: print them / open the browser. Rejects with `ApiCallError` code `GITHUB_LINKED_ELSEWHERE` or `GITHUB_RESERVED` (exit 3 in the CLI); `github_link` events. |
| `wos logout` | `logout()` | revokes the session family, deletes the session (keeps the device key). |
| `wos status` | `status()` | git, claude and codex (installed, version, signed in, auth method), eligible roles, active leases. When signed in with GitHub it also POSTS the provider and toolchain attestations (D13) the claim's eligibility check reads, so run it before the first build. |
| `wos build <abu>` | `build({abu, detachAfterSubmit?, signal?}, observer)` | `abu` = id or `<target>/<feature>#<nn>`. CLI waits through CI, reviews, PR and merge by default; Desktop detaches after submit by default and calls `resume` later. |
| `wos review` | `review({slot, kinds?, signal?}, observer)` | claims the server-assigned review for the slot (codex for astra, claude for fable), runs it read-only, submits the sealed verdict. |
| `wos roadmap`, `wos resolve`, revisions | `author({taskId, signal?}, observer)` | runs `roadmap_author`, `feature_author`, `abu_revision` (continues the attempt to merge) and `conflict_resolution` (Ruling) tasks. |
| `wos propose` | `propose({target, feature, title, body})` | returns the issue URL. |
| app start / "Resume" | `resume(observer)` | re-attaches to every attempt this machine drives (local state in `<workspaceRoot>/state`), continuing a build, waiting, or claiming its revision. |
| "Abandon" | `release(leaseId, reason)` | gives the lease back and removes the worktree. |
| "Show command" | `describeInvocation(plan)` | the exact binary, argv and env a plan launches (placeholders `<worktree>` etc.). |

## Results, errors, exit codes

Long operations resolve with `RunResult`: `{ok: true, attempt, task, output}` or
`{ok: false, code, message, task}`; they do not throw for workflow failures. Every failure is also
emitted as an `error` event. `signIn`, `linkGithub`, `status`, `propose`, `release` throw `ApiCallError`
(`code` is the API error code, e.g. `UNAUTHENTICATED`, `GITHUB_REQUIRED`, `NOT_ELIGIBLE`,
`RESOURCE_LOCKED`) or `Error`. Suggested CLI exit codes: `UNAUTHENTICATED` / `GITHUB_REQUIRED` /
`GITHUB_LINKED_ELSEWHERE` / `GITHUB_RESERVED` -> 3, `VALIDATION_FAILED` from argument parsing -> 2,
anything else -> 1.

Codes produced by the orchestrator itself: `LIMIT_REACHED` (local repair loops exhausted),
`MODEL_MISMATCH` (the CLI reported another model; submission refused), `AGENT_FAILED`,
`AGENT_OUTPUT_INVALID`, `SCOPE_VIOLATION`, `REPO_MANIFEST_INVALID`, `BUILD_GRAPH_INVALID`,
`DOCUMENT_MISMATCH` (a server document did not match the plan's sha256), `ABORTED`,
`ATTEMPT_<STATE>` (the attempt ended unmerged).

## Events

Stream every `OrchestratorEvent` as it arrives: `--json` prints one JSON object per line; Desktop
forwards them unchanged on `wos:events`. The same run produces the same sequence through CLI and
Desktop (test `local-orchestrator R-001`). `agent_output` chunks are the agent's raw stdout/stderr.

## Not there yet (blockers)

- B-0006: `LocalStatus` has no `toolchain` field, so `wos status` cannot display the attestation it
  posts; tool names (`node`, `xcode`, `android-sdk`) are not a contract vocabulary yet.
- B-0008: `review()` cannot send the round's `submissionSha256` (no contract field carries it); the
  real control plane refuses its verdict until that is added.
- B-0009: listing claimable ABUs, open tasks (for `wos roadmap` / `wos resolve` without an id), my
  work and my events are not orchestrator operations yet.
- `build()` finds acceptance checks through planning's `parseBuildGraphYaml`, still a stub on main;
  the default engines fail on it until planning lands.
