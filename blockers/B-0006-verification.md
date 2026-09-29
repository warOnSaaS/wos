```json
{
  "id": "B-0006-verification",
  "status": "open",
  "raisedBy": "verification",
  "raisedAt": "2026-09-29T18:53:35Z",
  "affectedContract": "docs/architecture/SECURITY.md S-17 vs docs/architecture/FEATURE-CONTRACT.md scope.write[]; RepoManifest.protectedPaths (WriteScope)",
  "reason": "S-17 says protectedPaths include 'the catalog/roadmaps/features directories for builders', but FEATURE-CONTRACT.md lets an ABU write under features/<feature>/acceptance/ (per-app profile suites). protectedPaths are WriteScopes (exact file or <dir>/**), so 'features/** except */acceptance/**' cannot be expressed. With features/** protected (templates/suite/wos.json today) every ABU that adds an acceptance test is rejected with PROTECTED_PATH; without it a builder can edit CONTRACT.yaml and BUILD-GRAPH.yaml, which CI reads the ABU spec and acceptance checks from (though from the base, so only a merged edit matters).",
  "evidence": "docs/architecture/FEATURE-CONTRACT.md:60; docs/architecture/SECURITY.md:206; templates/suite/wos.json protectedPaths; packages/verification/src/vectors.ts vector 'PROTECTED_PATH: a builder writing a feature contract'.",
  "requestedCapability": "A rule the validator can apply: either protect exact document files per feature (features/<f>/CONTRACT.yaml and BUILD-GRAPH.yaml, e.g. a protectedPaths glob or a built-in rule for ARTIFACT_PATHS), or state that acceptance tests live outside features/ for builders.",
  "affectedWorkstreams": [
    "architect",
    "planning",
    "verification"
  ],
  "suggestedResolution": "Built-in rule in validateChangeset for builders: reject any features/<f>/<file> that is not under features/<f>/acceptance/ (PROTECTED_PATH), and drop features/** from the template's protectedPaths. Documents keep their own documentPaths.",
  "decision": null
}
```

Raised by the verification workstream at the Wave 1 rebase. Template keeps features/** protected (fail closed) until ruled.
