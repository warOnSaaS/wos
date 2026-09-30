/**
 * tools/registry/publish-build-release.mjs (B-0007-control-plane): the maintainer script that publishes Build's
 * release, run here against the real control plane in process (migration 0008 applied), never against production.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUILD_MANIFEST_PATH, buildReleaseBody, publishBuildRelease } from "../../../tools/registry/publish-build-release.mjs";
import { COMMIT } from "./support/apps.js";
import { createHarness, HAS_DB, type Harness } from "./support/harness.js";

const manifest = () => JSON.parse(readFileSync(BUILD_MANIFEST_PATH, "utf8"));

describe("publish-build-release: the request body", () => {
  it("is Build's committed manifest, no package, source waronsaas/wos at build@<version>", () => {
    const body = buildReleaseBody(manifest(), COMMIT);
    expect(body).toMatchObject({
      desktopPackage: null,
      desktopPackageUrl: null,
      source: { repo: "waronsaas/wos", tag: `build@${manifest().app.version}`, commit: COMMIT },
    });
    expect(() => buildReleaseBody({ ...manifest(), app: { ...manifest().app, id: "crm" } }, COMMIT)).toThrow();
    expect(() => buildReleaseBody(manifest(), "HEAD")).toThrow();
  });
});

describe.skipIf(!HAS_DB)("publish-build-release against the control plane", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  const run = (email: string, dryRun = false) => {
    const lines: string[] = [];
    let n = 0;
    const result = publishBuildRelease({
      api: "https://api.waronsaas.com",
      email,
      body: buildReleaseBody(manifest(), COMMIT),
      fetch: (input: string, init?: RequestInit) => {
        n++;
        return Promise.resolve(
          h.app.request(input, { ...init, headers: { ...(init?.headers as object), "x-forwarded-for": `10.77.0.${n}` } }),
        );
      },
      readCode: async () => h.mailer.lastTo(email).code,
      log: (l: string) => lines.push(l),
      dryRun,
    });
    return { result, lines };
  };

  it("dry run publishes nothing; a non-maintainer is refused; a maintainer publishes once; a second run finds it", async () => {
    const dry = run("nobody@example.com", true);
    expect((await dry.result).status).toBe("dry-run");
    expect(h.mailer.sent.filter((m) => m.to === "nobody@example.com")).toEqual([]);

    const plain = await h.contributor("build-plain");
    await expect(run(plain.email).result).rejects.toThrow(/HTTP 403/);

    const maint = await h.contributor("build-maint", { maintainer: true });
    const first = run(maint.email);
    const published = await first.result;
    expect(published.status).toBe("published");
    expect(first.lines.join("\n")).toContain("published build@");
    expect(first.lines.join("\n")).not.toMatch(/wos_at_|wos_rt_/);
    const got = await h.call("GET", "/v1/public/apps/build");
    expect(got.body).toMatchObject({ id: "build", surfaces: { desktop: { available: true, package: null } } });

    const again = await run(maint.email).result;
    expect(again.status).toBe("exists");
    // The script logs its session out: no live session is left for the maintainer's publish-build-release sign-ins.
    const [live] = await h.owner<{ n: number }[]>`
      select count(*)::int as n from wos.sessions s join wos.account_emails e on e.account_id = s.account_id
       where e.email_normalized = ${maint.email.toLowerCase()} and s.revoked_at is null and s.device_id is null and s.client_kind = 'cli'`;
    expect(live!.n).toBe(0);
    expect(h.violations).toEqual([]);
  });
});
