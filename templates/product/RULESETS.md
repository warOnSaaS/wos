# warOnSaaS suite: branch rulesets and repository settings

Template for the product repo `waronsaas/product` (owner: verification workstream, platform repo
`templates/product/`). Applied by the founder on day one (FOUNDER-CHECKLIST.md). Implements D9 and
SECURITY.md S-17 to S-20. Field names follow the GitHub REST rulesets API
(`POST /repos/{owner}/{repo}/rulesets`). UNVERIFIED until applied: the exact JSON is accepted by the API,
and whether the App installation counts as a collaborator for the PR-creation restriction (S-18 day-one
test). `<WOS_APP_ID>` is the wOS GitHub App's numeric id.

## 1. What must be true

| # | Rule | Why | Check |
|---|---|---|---|
| 1 | Nobody pushes to `main`, nobody force-pushes or deletes it; no bypass actors, not even admins | the only way to `main` is the merge queue | ruleset `main` |
| 2 | Merging requires `wos-verify` (GitHub Actions) and `wos/qualified` (source: the wOS App only) | D9: qualification plus trusted CI | ruleset `main`, `required_status_checks` |
| 3 | Merges go through the merge queue, which re-runs `wos-verify` on `merge_group` | simultaneous PRs are tested combined | ruleset `main`, `merge_queue` |
| 4 | A PR touching a CODEOWNERS path needs a maintainer | the gate's own files (workflows, `wos.json`, package manifests, toolchain configs, migrations) never change unreviewed | ruleset `main`, `require_code_owner_review` |
| 5 | Only the wOS App creates, updates or deletes `wos/**` branches (candidates, official, roadmap and feature branches) | a CI result counts only for a head the App created | ruleset `wos-branches` |
| 6 | Pull request and issue creation restricted to collaborators; contributors are never collaborators | D9: no human opens a PR | repository settings |
| 7 | The webhook closes and locks any PR whose author is not the App | fallback for rule 6 (S-18) | control plane |
| 8 | Actions: no secrets, no environments with secrets, default `GITHUB_TOKEN` read-only, Actions may not create or approve PRs, only GitHub-authored actions allowed, fork PR workflows need approval | S-20 | repository settings; lint in the platform repo |
| 9 | The wOS App has no `workflows` and no `administration` permission | GitHub itself refuses App pushes that touch `.github/workflows` (S-19) | App settings |

## 2. Ruleset `main`

```json
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": true,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          { "context": "wos-verify", "integration_id": 15368 },
          { "context": "wos/qualified", "integration_id": "<WOS_APP_ID>" }
        ]
      }
    },
    {
      "type": "merge_queue",
      "parameters": {
        "merge_method": "SQUASH",
        "grouping_strategy": "ALLGREEN",
        "max_entries_to_build": 5,
        "min_entries_to_merge": 1,
        "max_entries_to_merge": 5,
        "min_entries_to_merge_wait_minutes": 1,
        "check_response_timeout_minutes": 60
      }
    }
  ]
}
```

`integration_id` 15368 is GitHub Actions: a status named `wos-verify` from any other source does not
satisfy the rule. `wos/qualified` is pinned to the wOS App, so no person or other integration can set it.
`merge_method` is a FOUNDER DECISION (GAPS.md): SQUASH keeps one commit per ABU on `main`, with the
`wOS-*` and `Co-authored-by` trailers carried into the squash message by the App.

## 3. Ruleset `wos-branches`

```json
{
  "name": "wos-branches",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/wos/**"], "exclude": [] } },
  "bypass_actors": [{ "actor_id": "<WOS_APP_ID>", "actor_type": "Integration", "bypass_mode": "always" }],
  "rules": [{ "type": "creation" }, { "type": "update" }, { "type": "deletion" }, { "type": "non_fast_forward" }]
}
```

The App is the only bypass actor, so it alone creates candidate refs, force-moves them on rebase
(BUILD-PROTOCOL.md section 10) and deletes them after the PR opens.

## 4. Repository settings (not expressible as rulesets)

- General: pull requests restricted to collaborators; issues restricted to collaborators (D9).
- Actions > General: allow only actions created by GitHub; fork pull request workflows require approval
  for all outside collaborators; workflow permissions "Read repository contents"; "Allow GitHub Actions
  to create and approve pull requests" off.
- Secrets and variables > Actions: empty. Environments: none.
- The platform repo lints every product workflow with `lintProductWorkflow` (`secrets.`, permissions,
  triggers, environments, pinned third-party actions, `persist-credentials: false`).

## 5. Trusted verification and the toolchain (B-0005, contracts 3.0.0)

`wos-verify` runs `npm run typecheck`, `npm run lint` and `npm test`, whose meaning is defined by
`package.json` scripts and tool configs. So `templates/product/wos.json` lists every
`DEFAULT_TOOLCHAIN_PATHS` entry in `toolchainPaths`, and:

- a submission may change a toolchain file only when its ABU holds the exclusive resource
  `toolchain:<path>` (`TOOLCHAIN_WITHOUT_RESOURCE` otherwise), and CODEOWNERS then requires a maintainer;
- the REQUIRED job `wos-verify` restores every toolchain path from the base commit (deleting toolchain
  files the candidate added) and runs the BASE `wos.json` install and verify steps;
- the non-required job `wos-verify-candidate-toolchain` runs the candidate's own toolchain when it
  touches toolchain paths, so reviewers and the maintainer can see how it fares;
- on pushes to the default branch every feature profile's acceptance suite runs as its own check run
  `wos-acceptance/<feature>/<target>` (`profileAcceptanceCheckName`). These are not required checks;
  the control plane records them for progress.

## 6. Mobile releases (D13, SECURITY.md S-35)

`release-mobile.yml` is the only product workflow that reads a secret (`EXPO_TOKEN`), and only in the
`release` environment. The lint in the platform repo (`lintProductWorkflow`) fails any workflow that
references secrets outside a `release` job, uses any other environment, or puts the `release` environment in
a workflow triggered by anything but tag pushes.

Environment `release` (repository settings):
- required reviewer: a maintainer; "prevent self-review" on;
- deployment policy: selected tags only, pattern `mobile-v*`;
- secret: `EXPO_TOKEN` (an Expo robot token of the warOnSaaS account). The Apple distribution certificate,
  App Store Connect API key and Google Play upload key are EAS-managed credentials of that account; none is
  stored in GitHub, on a contributor machine, or in the platform repo (whose own `release` environment
  holds only wOS Desktop's Developer ID).

Ruleset `mobile-release-tags`:

```json
{
  "name": "mobile-release-tags",
  "target": "tag",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/tags/mobile-v*"], "exclude": [] } },
  "bypass_actors": [{ "actor_id": "<MAINTAINERS_TEAM_ID>", "actor_type": "Team", "bypass_mode": "always" }],
  "rules": [{ "type": "creation" }, { "type": "update" }, { "type": "deletion" }]
}
```

The job also refuses a tag whose commit is not on the default branch, so a release is always code that
passed `wos-verify`, two independent reviews and the merge queue. `apps/mobile/eas.json` (build and submit
profiles) is a protected path and code-owned.
