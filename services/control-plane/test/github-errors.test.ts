/**
 * Incident 2026-10-01 (the first real roadmap submission): every App commit was refused by the App's own commit-message
 * check (trailer lines inside the message, Co-authored-by missing from the trailers), and the control plane reported it as
 * "GitHub commit failed; retry with the same Idempotency-Key" after retrying a deterministic refusal three times.
 * Now: the commit identity passes the real checks, the error carries GitHub's code, status and message (no secrets), and
 * only transient failures are retried.
 */
import { COMMIT_TRAILERS } from "@waronsaas/contracts";
import { coAuthoredBy } from "@waronsaas/github";
import { buildCommitMessage, GithubAppError } from "@waronsaas/github/app";
import { describe, expect, it } from "vitest";
import type { Deps } from "../src/deps.js";
import { ApiFailure } from "../src/errors.js";
import { githubErrorDetail, withGithubRetries } from "../src/handlers/work.js";

const deps = (retries = 2) => ({ config: { githubRetries: retries }, log: () => {} }) as unknown as Deps;

describe("GitHub errors (incident 2026-10-01)", () => {
  it("the old commit identity (trailer lines in the message) is refused by the App; the new one passes", () => {
    const trailers = { [COMMIT_TRAILERS.task]: "01a0f47a-0b77-7043-9299-0b237bb8d59c", [COMMIT_TRAILERS.contributor]: "adventurini" };
    const coAuthor = coAuthoredBy(1234, "adventurini");
    const old = {
      author: { name: "waronsaas-wos[bot]", email: "335681065+waronsaas-wos[bot]@users.noreply.github.com" },
      trailers,
      message: `salesforce v1 revision\n\n${Object.entries(trailers)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n")}\n${coAuthor}`,
    };
    expect(() => buildCommitMessage(old)).toThrow(/reserved trailer line/);
    const now = {
      ...old,
      trailers: { ...trailers, "Co-authored-by": coAuthor.slice("Co-authored-by: ".length) },
      message: "salesforce v1 revision",
    };
    const msg = buildCommitMessage(now);
    expect(msg).toContain("wOS-Task: 01a0f47a-0b77-7043-9299-0b237bb8d59c");
    expect(msg.trimEnd().split("\n").at(-1)).toBe(coAuthor);
  });

  it("a deterministic refusal is not retried and its code, status and message reach the caller", async () => {
    let calls = 0;
    const err = await withGithubRetries(deps(), "commit", async () => {
      calls++;
      throw new GithubAppError("INVALID_INPUT", "commit message contains a reserved trailer line");
    }).catch((e) => e);
    expect(calls).toBe(1);
    expect(err).toBeInstanceOf(ApiFailure);
    expect(err.code).toBe("UPSTREAM_GITHUB");
    expect(err.message).toBe("GitHub commit failed: INVALID_INPUT: commit message contains a reserved trailer line");
    expect(err.details).toMatchObject({ github: { code: "INVALID_INPUT", status: null }, retryable: false });
  });

  it("a 5xx is retried, then reported with GitHub's status and message and the retry hint", async () => {
    let calls = 0;
    const err = await withGithubRetries(deps(2), "commit", async () => {
      calls++;
      throw new GithubAppError("GITHUB_ERROR", "commitChangeset waronsaas/product@wos/x: Server Error", 502);
    }).catch((e) => e);
    expect(calls).toBe(3);
    expect(err.message).toBe(
      "GitHub commit failed: GITHUB_ERROR (HTTP 502): commitChangeset waronsaas/product@wos/x: Server Error; retry with the same Idempotency-Key",
    );
    const ok = await withGithubRetries(deps(2), "x", async () => {
      calls++;
      if (calls < 5) throw Object.assign(new Error("socket hang up"), {});
      return 7;
    });
    expect(ok).toBe(7);
  });

  it("never carries a secret", () => {
    const d = githubErrorDetail(
      Object.assign(
        new Error(
          "Bad credentials ghs_abcdefghijklmnopqrstuvwxyz0123456789 Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.x.y -----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----",
        ),
        { status: 401 },
      ),
    );
    expect(d.status).toBe(401);
    expect(d.message).not.toMatch(/ghs_|eyJhbGci|MIIE/);
    expect(d.message).toContain("[token]");
    expect(d.message).toContain("[key]");
  });
});
