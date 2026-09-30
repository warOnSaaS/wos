/**
 * Coverage map of SECURITY.md S-controls to the tests that fail when the control is removed.
 * Fails when SECURITY.md gains a control that is not listed here, so a new control cannot land untested
 * silently. `now` = runs on this branch (the API attacks run since the Wave 2 integration gate); `pending` = written, not yet runnable;
 * `none` = no verification test yet, with the reason (owned elsewhere or needs real GitHub/Electron).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../packages/verification/test/support/git-fixture.js";

type Status = "now" | "pending" | "none";
const COVERAGE: Record<string, { status: Status; where: string }> = {
  "S-1": { status: "none", where: "control-plane DONE (3) sign-in tests (token reuse, expiry, sixth try, hash-only)" },
  "S-2": { status: "now", where: "api.adversarial: wrong poll secret" },
  "S-3": { status: "now", where: "api.adversarial: identical start responses" },
  "S-4": { status: "none", where: "control-plane (refresh reuse revokes family); cli (keychain only)" },
  "S-5": { status: "none", where: "control-plane + web: CSRF header; needs the web cookie flow in the harness" },
  "S-6": { status: "now", where: "api.adversarial: GITHUB_REQUIRED" },
  "S-7": {
    status: "now",
    where: "templates.test: wos-ci verify runs npm ci without lifecycle scripts, minimal env, refuses unsafe install",
  },
  "S-8": { status: "now", where: "ci.yml secret scan + primitives.test secret patterns" },
  "S-9": {
    status: "now",
    where: "db.adversarial: RLS on reviews, findings, leases, devices, emails, sessions; app role not owner, no BYPASSRLS",
  },
  "S-10": { status: "now", where: "db.adversarial: forbid_mutation triggers and grants on every append-only table; owner rewrites fail" },
  "S-11": {
    status: "now",
    where: "db.adversarial other-slot RLS (now); pipeline.adversarial buildContext and api.adversarial sealed canary (pending)",
  },
  "S-12": {
    status: "now",
    where: "db.adversarial self-review trigger (now); pipeline.adversarial checkEligibility, api.adversarial claimReview (now)",
  },
  "S-13": {
    status: "now",
    where: "db.adversarial: a review citing an agent run with signature_valid=false or of another lease is rejected (0003)",
  },
  "S-14": { status: "now", where: "pipeline.adversarial policy data (now) and buildInvocation per role (pending)" },
  "S-15": {
    status: "now",
    where: "changeset vectors SYMLINK_OR_SPECIAL_FILE, templates.test scope rejects a committed symlink (now); captureChanges (pending)",
  },
  "S-16": { status: "now", where: "changeset-vectors.test: one vector per ChangesetErrorCode" },
  "S-17": {
    status: "now",
    where: "changeset-vectors.test PROTECTED_PATH/WORKFLOW_FILE/GENERATED_PATH/LOCKFILE/MIGRATION; templates.test CI scope",
  },
  "S-18": { status: "none", where: "needs real GitHub: PR by a user token, merge without wos/qualified (Wave 3); rulesets doc test only" },
  "S-19": { status: "now", where: "vectors WORKFLOW_FILE (now); webhook HMAC one-byte change (pending)" },
  "S-20": { status: "now", where: "templates.test + primitives.test: lintProductWorkflow over every product workflow" },
  "S-21": { status: "now", where: "pipeline.adversarial: injected text after obligations inside an untrusted block" },
  "S-22": { status: "now", where: "vectors SIGNATURE_INVALID/SUBMISSION_HASH_MISMATCH (now); api.adversarial modified client (now)" },
  "S-23": {
    status: "now",
    where: "db.adversarial head/hash binding and ReviewVerdict refinements (now); api fabricated verdict (now)",
  },
  "S-24": { status: "now", where: "pipeline.adversarial and api.adversarial: 89-day GitHub refused" },
  "S-25": { status: "now", where: "pipeline.adversarial: sixth review of the same author in 7 days" },
  "S-26": { status: "now", where: "changeset vectors: symlink, lockfile, generated; wos.json package.json-as-lockfile" },
  "S-27": { status: "now", where: "api.adversarial: lease expiry and lease limits; pipeline eligibility lease limit" },
  "S-28": { status: "none", where: "control-plane/rewards audit task (GAPS.md rate decision)" },
  "S-29": {
    status: "now",
    where: "apps/desktop/test security.test + ipc-fuzz.test (root suite); electron.test live renderer where Electron and the bundle exist",
  },
  "S-30": {
    status: "now",
    where: "apps/desktop/test/packaging.test asserts .github/workflows/desktop-release.yml (signing only in the release job)",
  },
  "S-31": {
    status: "now",
    where:
      "db.adversarial: bootstrap one-way, settings undeletable, bootstrap labels refused after exit (maintainer actions: control-plane)",
  },
  "S-32": {
    status: "now",
    where: "primitives.test no local hashing; vectors signed/verified via contracts canonical; db.adversarial device key encodings",
  },
  "S-33": {
    status: "now",
    where:
      "vectors TOOLCHAIN_WITHOUT_RESOURCE; templates.test base-restore, base wos.json, candidate-toolchain job, acceptance check names",
  },
  // Added by the architect with contracts 4.0.0 (D13); the verification workstream owns the tests (WORKSTREAMS section 8).
  "S-34": {
    status: "now",
    where:
      "db.adversarial: toolchain_attestations own rows, invisible to others, append-only; surfaces.adversarial template requirements; eligibility and API claim from Linux (now)",
  },
  "S-35": {
    status: "now",
    where:
      "primitives.test lint: secrets only in a release job of a tag-only workflow; templates.test release-mobile is the only secret reader, tag on default branch",
  },
  "S-36": { status: "now", where: "surfaces.adversarial: all six reviewer roles carry the trade-dress material rule" },
  // Added by the architect with contracts 5.0.0 (Amendment 01, D16, D17); Wave 3 owners in WORKSTREAMS section 12.
  "S-37": {
    status: "now",
    where:
      "contracts wos-app.test: pinned-key, tamper and swapped-manifest vectors (Desktop installer and module-release workflow: Wave 3)",
  },
  "S-38": {
    status: "none",
    where: "Wave 3: desktop module loader CSP/origin tests, mobile screen schema (contracts test covers the data)",
  },
  "S-39": {
    status: "now",
    where: "db-assertions: older release refused, published release immutable, un-yank refused (Desktop rollback: Wave 3)",
  },
  "S-40": { status: "none", where: "Wave 3: desktop IPC fuzz with Build off; control-plane claim without the build entitlement -> 403" },
  "S-41": { status: "none", where: "Wave 3: V1 proof step 8, self-hosted Core with no route to wOS Cloud" },
  "S-42": { status: "none", where: "Wave 3: release workflow refuses an unsigned Windows artefact; github/local on windows-latest" },
  "S-43": {
    status: "none",
    where: "Wave 3a: control-plane web_app bodies and link host; suite-shell sealed pollSecret binding, no Domain cookies",
  },
};

describe("security-hardening: every SECURITY.md control is mapped", () => {
  const ids = [...readFileSync(join(REPO_ROOT, "docs/architecture/SECURITY.md"), "utf8").matchAll(/\*\*(S-\d+) /g)].map((m) => m[1]!);
  it("SECURITY.md controls and the coverage map list the same ids", () => {
    expect(ids.length).toBeGreaterThan(0);
    expect(Object.keys(COVERAGE).sort()).toEqual([...new Set(ids)].sort());
  });
  it("reports the split", () => {
    const by = (s: Status) =>
      Object.entries(COVERAGE)
        .filter(([, v]) => v.status === s)
        .map(([k]) => k);
    console.info(
      `S-controls: now ${by("now").length} [${by("now")}], pending ${by("pending").length} [${by("pending")}], none ${by("none").length} [${by("none")}]`,
    );
    expect(by("now").length + by("pending").length + by("none").length).toBe(new Set(ids).size);
  });
});
