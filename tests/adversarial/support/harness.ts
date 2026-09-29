/**
 * The control-plane test harness the API-level adversarial suite runs against (Wave 2 integration).
 *
 * The control-plane workstream exports `createTestHarness()` from `@waronsaas/control-plane/test-harness`:
 * the real Hono app on a fresh migrated Postgres, with fakes for GitHub (records calls), email (keeps the
 * last message per address) and the agent CLIs. Until that export exists, `loadHarness()` returns null
 * and every API attack is skipped with a PENDING reason. The interface below is the verification
 * workstream's request; it adds no route and no contract field.
 */
import type { KeyObject } from "node:crypto";

export interface Contributor {
  accountId: string;
  email: string;
  accessToken: string;
  deviceId: string;
  /** The device's Ed25519 private key, registered with the control plane. */
  deviceKey: KeyObject;
}

export interface ReadyLease {
  leaseId: string;
  taskId: string;
  attemptId: string;
  /** The pinned base commit (first submission's parentCommit). */
  parentCommit: string;
  /** manifest_sha256 accepted for this lease. */
  manifestSha256: string;
  /** Paths present at the base commit. */
  existingPaths: string[];
}

export interface OpenRound {
  roundId: string;
  attemptId: string;
  headSha: string;
  submissionSha256: string;
}

export interface ControlPlaneHarness {
  request(
    method: string,
    path: string,
    init?: { token?: string; body?: unknown; headers?: Record<string, string>; ip?: string },
  ): Promise<{ status: number; body: unknown; headers: Record<string, string> }>;
  /** An account; `github: false` leaves it unlinked, `githubAgeDays` sets the linked account's age. */
  contributor(opts?: { github?: boolean; githubAgeDays?: number; maintainer?: boolean }): Promise<Contributor>;
  /** A ready ABU in the product repo; returns its id. */
  seedAbu(spec: { key: string; write: string[]; resources?: { key: string; mode: "exclusive" | "shared" }[] }): Promise<string>;
  /** Claim + accepted manifest + signed agent run: the attempt is `verifying` and ready to submit. */
  leaseReadyToSubmit(builder: Contributor, abuId: string): Promise<ReadyLease>;
  /** Drives the builder's attempt through submission, candidate commit and green CI to an open round. */
  roundInReview(builder: Contributor, abuId: string): Promise<OpenRound>;
  /** Signed agent run for a review lease (so a verdict can reference it). */
  reviewAgentRun(reviewer: Contributor, leaseId: string): Promise<string>;
  bootstrap(enabled: boolean): Promise<void>;
  lastEmail(to: string): Promise<{ link: string; code: string } | null>;
  githubCalls(): Array<{ method: string; path: string; body?: unknown }>;
  close(): Promise<void>;
}

export async function loadHarness(): Promise<ControlPlaneHarness | null> {
  const specifier = "@waronsaas/control-plane/test-harness";
  try {
    const mod = (await import(specifier)) as { createTestHarness?: () => Promise<ControlPlaneHarness> };
    return mod.createTestHarness ? await mod.createTestHarness() : null;
  } catch {
    return null;
  }
}

export const HARNESS_REASON = " [PENDING Wave 2 integration: @waronsaas/control-plane/test-harness createTestHarness() not exported yet]";
