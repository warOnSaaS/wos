# White paper assessments: reference runs

Each file pair here is one reference run of the white paper's evaluation brief (the paper's self-assessment), run on
the founder's own subscriptions with `tools/assessments/run-reference.ts`: by `.github/workflows/self-assessment.yml`
(Claude, once per paper version, since v0.9) or by the founder by hand (Codex runs always):

- `<date>-v<paper version>-<model>.json`: an `AssessmentRecord` (`wos-assessment-record/v1`,
  `packages/contracts/src/assessment.ts`): source `reference run by warOnSaaS`, which CLI and model ran it, the
  sha256 of the exact prompt, the paper version the site served, the raw score block and the validated block
  (`wos-assessment/v1` for paper v0.7 and v0.8; `wos-assessment/v2`, with gaps and improvements, from v0.9).
- `<same stem>.md`: the agent's full report, verbatim.

Rules:

- **Never edit a run.** A run is evidence. If a block is wrong, the run is wrong: delete both files in a commit
  that says why, or keep it. Never type or adjust scores by hand. Never add a run that was not produced by the script.
- Only warOnSaaS's own reference runs are recorded. Reader submissions are not collected (founder, 2026-09-30).
- The site reads these files at build: `apps/web/scripts/sync-shared.mjs` writes `apps/web/generated/assessments.json`,
  which renders https://waronsaas.com/assessments (charts and the table of runs) and
  https://waronsaas.com/whitepaper/assessments.md (the trend an evaluating agent reads only after scoring).
  `tests/assessments.test.ts` validates every file here against the contract.
- Anti-anchoring: no score from here may appear in the white paper, its companions or the full pack.
- Every paper version needs at least one run here before the next version can ship (v0.1 to v0.8 exempt); the gap
  register (https://waronsaas.com/assessments/gaps) is derived from the latest run of each version and the paper's
  changelog.

How to run one: see `tools/assessments/README.md`.
