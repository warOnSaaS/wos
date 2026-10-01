import type { ChangesetFile, OrchestratorEvent } from "@waronsaas/contracts";
import {
  ed25519PrivateKeyFromSeed,
  submissionSha256,
  type UnsignedChangeset,
  verifyChangesetSignature,
} from "@waronsaas/contracts/canonical";
import { afterEach, describe, expect, it } from "vitest";
import { DEVICE_KEY, deviceKey, SESSION_KEY, signChangesetWithDevice } from "../src/session.js";
import { ABU_KEY, SIGNIN_REQUEST_ID, TARGET } from "./support/fake-control-plane.js";
import { type Harness, harness } from "./support/harness.js";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

// The normative vectors of packages/contracts/test/canonical.test.ts.
const PARENT = "a".repeat(40);
const FILES: ChangesetFile[] = [
  {
    op: "upsert",
    path: "modules/contacts/b.ts",
    mode: "100644",
    contentBase64: "ZXhwb3J0IGNvbnN0IGIgPSAyOwo=",
    sha256: "sha256:b5d546753d33709dff508a6f2c2e547f432267fbb05b68d3da74fa5f7bda9f7a",
    bytes: 20,
  },
  { op: "delete", path: "modules/contacts/a.ts" },
  {
    op: "upsert",
    path: "modules/contacts/run.sh",
    mode: "100755",
    contentBase64: "IyEvYmluL3NoCg==",
    sha256: "sha256:a8076d3d28d21e02012b20eaf7dbf75409a6277134439025f282e368e3305abf",
    bytes: 10,
  },
];
const UNSIGNED: UnsignedChangeset = {
  schema: "wos-changeset.v1",
  taskId: "0192f000-0000-7000-8000-000000000001",
  leaseId: "0192f000-0000-7000-8000-000000000002",
  deviceId: "0192f000-0000-7000-8000-000000000003",
  parentCommit: PARENT,
  manifestSha256: `sha256:${"1".repeat(64)}`,
  submissionSha256: "sha256:08a42b4ece456507fc5cfa01d6d07d473044a230117a9667a278df54379b7608",
  files: FILES,
  summary: { schema: "build-summary.v1", summary: "s", requirementsCovered: ["R-001"], responses: [], abuConcerns: [] },
};
const PUBLIC_KEY = "6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw=";
const SIGNATURE = "igcfDlLL1ZIj7dqMSEM63k58K95STKlN0dOpV9ABw8R55EKa6Nlz1u2oSjjdU4MFbVGbcjef49crNxE/CjtsAA==";
const seededPem = () => ed25519PrivateKeyFromSeed(new Uint8Array(32).fill(7)).export({ type: "pkcs8", format: "pem" }).toString();

describe("canonical vectors through the orchestrator's device key", () => {
  it("reproduces the contracts' public key, diff hash and signature", async () => {
    h = harness();
    await h.secrets.set(DEVICE_KEY, seededPem());
    expect((await deviceKey(h.secrets)).publicKeyBase64).toBe(PUBLIC_KEY);
    expect(submissionSha256(PARENT, FILES)).toBe(UNSIGNED.submissionSha256);
    const signed = await signChangesetWithDevice(h.secrets, UNSIGNED);
    expect(signed.signature).toBe(SIGNATURE);
    expect(verifyChangesetSignature(signed, PUBLIC_KEY)).toBe(true);
  });

  it("the submitted changeset of a fake run verifies with the registered public key", async () => {
    h = harness();
    await h.secrets.set(DEVICE_KEY, seededPem());
    await h.make("cli").build({ abu: `${TARGET}/${ABU_KEY}`, detachAfterSubmit: true }, () => undefined);
    expect(verifyChangesetSignature(h.server.submissions[0]!, PUBLIC_KEY)).toBe(true);
  });
});

async function* links(...items: string[]): AsyncIterable<string> {
  for (const i of items) {
    await Promise.resolve();
    yield i;
  }
}

describe("signIn (D8)", () => {
  const never = () => new Promise<string>(() => undefined);

  it("signs in with the typed code, retrying a wrong one, and stores the session and device id", async () => {
    h = harness();
    await h.secrets.delete(SESSION_KEY);
    await h.secrets.set(DEVICE_KEY, seededPem());
    const codes = ["WRNG-CODE", "abcd-efgh"];
    const events: OrchestratorEvent[] = [];
    const me = await h
      .make("cli")
      .signIn({ email: "dev@example.com", deviceName: "laptop" }, { code: async () => codes.shift()! }, (e) => events.push(e));
    expect(me.email).toBe("dev@example.com");
    expect(h.server.signInStarts[0]).toMatchObject({
      email: "dev@example.com",
      clientKind: "cli",
      deviceName: "laptop",
      devicePublicKey: PUBLIC_KEY,
    });
    expect(h.server.redeems.map((r) => r.code)).toEqual(["WRNG-CODE", "ABCD-EFGH"]);
    expect(h.server.redeems.every((r) => r.pollSecret === "poll-secret-xyz" && r.requestId === SIGNIN_REQUEST_ID)).toBe(true);
    const stored = JSON.parse((await h.secrets.get(SESSION_KEY))!);
    expect(stored).toMatchObject({ accessToken: "test-access", deviceId: "0192ab3c-0000-7000-8000-0000000000dd" });
    // The poll secret is never persisted.
    expect([...h.secrets.map.values()].some((v) => v.includes("poll-secret"))).toBe(false);
    expect(events.filter((e) => e.type === "sign_in").map((e) => (e.type === "sign_in" ? e.status : ""))).toEqual([
      "email_sent",
      "waiting_for_code",
      "waiting_for_code",
      "redeemed",
    ]);
  });

  it("signs in with a matching wos://auth deep link", async () => {
    h = harness();
    await h.secrets.delete(SESSION_KEY);
    const me = await h
      .make("desktop")
      .signIn(
        { email: "dev@example.com", deviceName: "mac" },
        { code: never, deepLinks: links(`wos://auth?r=${SIGNIN_REQUEST_ID}&t=good-token`) },
        () => undefined,
      );
    expect(me.handle).toBe("octo-dev");
    expect(h.server.redeems).toEqual([
      { requestId: SIGNIN_REQUEST_ID, pollSecret: "poll-secret-xyz", linkToken: "good-token", code: null },
    ]);
  });

  it("ignores a deep link for a different request id (and other schemes), then completes by code", async () => {
    h = harness();
    await h.secrets.delete(SESSION_KEY);
    let release: (c: string) => void = () => undefined;
    const code = new Promise<string>((r) => {
      release = r;
    });
    const events: OrchestratorEvent[] = [];
    const done = h.make("desktop").signIn(
      { email: "dev@example.com", deviceName: "mac" },
      {
        code: () => code,
        deepLinks: links(
          "wos://auth?r=0192ab3c-0000-7000-8000-000000000bad&t=good-token",
          `https://evil.example/auth?r=${SIGNIN_REQUEST_ID}&t=good-token`,
        ),
      },
      (e) => events.push(e),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(h.server.redeems).toEqual([]);
    expect(events.filter((e) => e.type === "warning")).toHaveLength(2);
    release("ABCD-EFGH");
    await done;
    expect(h.server.redeems).toEqual([{ requestId: SIGNIN_REQUEST_ID, pollSecret: "poll-secret-xyz", linkToken: null, code: "ABCD-EFGH" }]);
  });
});

describe("linkGithub (D8)", () => {
  it("links through the brokered device flow", async () => {
    h = harness();
    h.server.meOverride = { github: null, canContribute: false };
    h.server.githubLinkScript = ["pending", "linked"];
    const shown: string[] = [];
    const events: OrchestratorEvent[] = [];
    await h.make("cli").linkGithub(
      (e) => events.push(e),
      (url, userCode) => shown.push(`${url} ${userCode}`),
    );
    expect(shown).toEqual(["https://github.com/login/device WOS1-2345"]);
    expect(events.map((e) => (e.type === "github_link" ? e.status : e.type))).toEqual(["waiting_for_user", "linked"]);
  });

  it("surfaces GITHUB_LINKED_ELSEWHERE as a refused link", async () => {
    h = harness();
    h.server.meOverride = { github: null, canContribute: false };
    h.server.githubLinkScript = ["pending", "elsewhere"];
    const events: OrchestratorEvent[] = [];
    await expect(
      h.make("cli").linkGithub(
        (e) => events.push(e),
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: "GITHUB_LINKED_ELSEWHERE" });
    expect(events.at(-1)).toMatchObject({ type: "github_link", status: "refused" });
  });
});

describe("server documents and repair runs", () => {
  it("fetches the plan's server documents by query ref and checks their sha256", async () => {
    h = harness();
    await h.make("cli").build({ abu: `${TARGET}/${ABU_KEY}`, detachAfterSubmit: true }, () => undefined);
    const taskId = [...h.server.tasks.values()][0]!.id;
    expect(h.server.documentRequests).toEqual(["wos:policy/builder@agent-policy.v4", `wos:task/${taskId}`]);
    const docCall = h.server.calls.find((c) => c.route === "getLeaseDocument");
    expect(docCall).toBeDefined();
    const m = h.server.manifestBodies[0]!;
    expect(m.artifacts).toContainEqual(expect.objectContaining({ ref: `wos:task/${taskId}`, gitBlobOid: null }));
  });

  it("a repair run posts a second manifest with local:verification-output and the changeset cites it", async () => {
    h = harness();
    h.processes.script.push("broken", "ok");
    await h.make("cli").build({ abu: `${TARGET}/${ABU_KEY}`, detachAfterSubmit: true }, () => undefined);
    const [first, second] = h.server.manifestBodies;
    expect(h.server.manifestBodies).toHaveLength(2);
    expect(first!.artifacts.some((a) => (a as { kind: string }).kind === "local_document")).toBe(false);
    expect(second!.artifacts).toContainEqual(expect.objectContaining({ kind: "local_document", ref: "local:verification-output" }));
    expect(second!.manifestSha256).not.toBe(first!.manifestSha256);
    expect(h.server.submissions[0]!.manifestSha256).toBe(second!.manifestSha256);
    expect((h.server.agentRuns as Array<{ manifestSha256: string }>).map((r) => r.manifestSha256)).toEqual([
      first!.manifestSha256,
      second!.manifestSha256,
    ]);
  });
});
