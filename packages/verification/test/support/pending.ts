/**
 * Activation of tests that exercise another workstream's code. A probe that throws the contracts'
 * NotImplementedError means the implementation has not landed on this branch yet: the test is skipped
 * with a PENDING reason in its name. At the wave-gate merge the stub disappears and the test runs
 * automatically; any other error means "implemented" and the test runs (and may fail).
 */
const isStub = (e: unknown) => e instanceof Error && e.name === "NotImplementedError";

export function implemented(probe: () => unknown): boolean {
  try {
    const r = probe();
    if (r instanceof Promise) r.catch(() => undefined);
    return true;
  } catch (e) {
    return !isStub(e);
  }
}

export async function implementedAsync(probe: () => Promise<unknown>): Promise<boolean> {
  try {
    await probe();
    return true;
  } catch (e) {
    return !isStub(e);
  }
}

/** Test-name suffix that says why a test is skipped. */
export const pendingReason = (ready: boolean, what: string) =>
  ready ? "" : ` [PENDING Wave 2 integration: ${what} is a stub on this branch]`;
