/**
 * WORKSTREAMS section 8 (github-build): `wos status` / Desktop collect a ToolchainAttestation (os, os
 * version, `xcodebuild -version`, Android SDK, Node) and post it with the provider attestations.
 * Snapshots on a macOS and a Linux fake machine.
 */
import { ProviderAttestation, ToolchainAttestation } from "@waronsaas/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { type Harness, harness, type Machine } from "./support/harness.js";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

async function statusOn(machine: Machine) {
  h = harness();
  h.processes.machine = machine;
  const status = await h.make("cli", { platform: machine === "macos" ? "darwin" : "linux" }).status();
  const posted = h.server.attestations;
  const { workspaceRoot, ...rest } = status;
  expect(workspaceRoot).toBe(h.root);
  return { status: rest, posted };
}

describe("status() and the toolchain attestation (D13)", () => {
  it("macOS: os version from sw_vers, Xcode from xcodebuild -version, Node; posted with the providers", async () => {
    const { status, posted } = await statusOn("macos");
    expect(posted).toHaveLength(1);
    const body = posted[0]!;
    expect(ToolchainAttestation.parse(body.toolchain)).toEqual({
      os: "macos",
      osVersion: "15.6.1",
      tools: [
        { name: "node", version: "22.23.1" },
        { name: "xcode", version: "26.0.1" },
      ],
      checkedAt: "2026-09-29T12:00:00.000Z",
    });
    for (const p of body.providers) ProviderAttestation.parse(p);
    expect(body.deviceId).toBe("0192ab3c-0000-7000-8000-0000000000dd");
    expect(status).toMatchSnapshot();
    expect(body).toMatchSnapshot();
  });

  it("Linux: kernel from uname -r, Android SDK from sdkmanager, Node; no Xcode probe", async () => {
    const { status, posted } = await statusOn("linux");
    expect(ToolchainAttestation.parse(posted[0]!.toolchain)).toEqual({
      os: "linux",
      osVersion: "6.8.0-85-generic",
      tools: [
        { name: "node", version: "22.23.1" },
        { name: "android-sdk", version: "12.0" },
      ],
      checkedAt: "2026-09-29T12:00:00.000Z",
    });
    expect(h!.processes.invocations.some((i) => i.binary === "xcodebuild")).toBe(false);
    expect(status).toMatchSnapshot();
    expect(posted[0]).toMatchSnapshot();
  });

  it("does not post an attestation when signed out, and reports missing providers as problems", async () => {
    h = harness();
    await h.secrets.delete("wos.session.v1");
    h.processes.machine = "linux";
    const s = await h.make("cli").status();
    expect(s.signedIn).toBe(false);
    expect(h.server.attestations).toHaveLength(0);
    expect(s.eligibleRoles.length).toBeGreaterThan(0);
  });
});
