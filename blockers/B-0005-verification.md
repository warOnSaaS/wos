```json
{
  "id": "B-0005-verification",
  "status": "accepted",
  "raisedBy": "verification",
  "raisedAt": "2026-09-29T18:18:19Z",
  "affectedContract": "SECURITY.md S-20 / D2 (CI is the trusted verification); RepoManifest.verify; protectedPaths",
  "reason": "Trusted CI runs commands whose meaning the candidate controls. wos.json verify steps are 'npm run typecheck', 'npm run lint', 'npm test', which execute the candidate's own package.json scripts and tool configs (vitest.config.ts, tsconfig, biome.json, .npmrc). A submission that edits package.json inside its write scope can set \"test\": \"true\" and CI reports success; reviewers are then the only defence. Neither the contracts nor protectedPaths' 'always' set cover package.json or the tool configs.",
  "evidence": "templates/suite/wos.json; packages/verification/test/templates.test.ts 'treats package.json as a lockfile'. Mitigation applied in the template: package.json listed in lockfiles (needs an exclusive lockfile:package.json resource), toolchain configs in protectedPaths, CODEOWNERS on /package.json.",
  "requestedCapability": "Make it policy: RepoManifest guidance (or a new field) listing files that define verification commands, which submissions may change only with a declared exclusive resource and which a build-graph validator flags; and ask reviewers (materialFindingRules) to treat any change to test/verify configuration as material.",
  "affectedWorkstreams": [
    "architect",
    "planning",
    "context-policy",
    "verification"
  ],
  "suggestedResolution": "Keep the template mitigation; add 'changes to how verification runs (scripts, test config, skipped tests) are material' to implementation reviewer materialFindingRules.",
  "decision": {
    "outcome": "accepted",
    "contractsVersion": "2.0.0",
    "note": "accept-modified (stronger than suggested). RepoManifest.toolchainPaths (must include DEFAULT_TOOLCHAIN_PATHS: wos.json, package.json files, lockfile, tsconfig*, biome/vitest/vite/eslint/prettier configs, .npmrc, .nvmrc); changing one needs the exclusive resource toolchain:<path> (TOOLCHAIN_WITHOUT_RESOURCE in changeset and build-graph validators) and a maintainer CODEOWNERS approval; the required wos-verify job restores all toolchain paths and reads verify steps from the BASE commit; a non-required job shows the candidate toolchain's result; implementation reviewers treat unrequested verification changes as material. Founder must accept the maintainer bottleneck (GAPS G-51).",
    "decidedAt": "2026-09-29T19:30:00Z"
  }
}
```

Raised by the verification workstream in Wave 1. See the evidence paths above; continuing with unaffected work.
