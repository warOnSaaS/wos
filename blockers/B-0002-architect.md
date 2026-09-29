```json
{
  "id": "B-0002-architect",
  "status": "accepted",
  "raisedBy": "architect",
  "raisedAt": "2026-09-29T20:30:00Z",
  "affectedContract": "packages/db schema abus, documents, catalog_features",
  "reason": "ABUs have no repository column; control-plane assumed the product repo, which is wrong for TGT-00 (platform repo).",
  "evidence": "Reported by the control-plane workstream at the Wave 1 gate (worked around without a blocker; ws/control-plane @ 4c93f85).",
  "requestedCapability": "A contract decision so the workaround can be removed.",
  "affectedWorkstreams": [
    "control-plane"
  ],
  "suggestedResolution": null,
  "decision": {
    "outcome": "accepted",
    "contractsVersion": "3.0.0",
    "note": "Migration 0003 adds repo_full_name to catalog_features, documents and abus with a consistency trigger (roadmap = its target's repo; contract = its catalog feature's; ABU = its contract's; catalog feature = its creating roadmap's). Catalogs are per repository (GAPS G-54). Views and plans expose repo.",
    "decidedAt": "2026-09-29T20:30:00Z"
  }
}
```

Raised by the Lead Architect on the control-plane workstream's behalf at the Wave 1 gate.
