/**
 * V1 proof step 8 in Docker (S-41): `docker compose` Core with WOS_APPS=crm on networks with NO route out, wOS Web
 * pointed at it shows CRM. Runs only with WOS_DOCKER_PROOF=1 (`npm run proof:self-host`, here or at the repository
 * root); needs Docker.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/** The product repository root: docker-compose.yml, docker-compose.proof.yml and proof/ live there (B-0003-suite-shell). */
const dir = fileURLToPath(new URL("../../..", import.meta.url));
const project = `wos-proof-${randomBytes(3).toString("hex")}`;
const env = {
  ...process.env,
  POSTGRES_PASSWORD: randomBytes(12).toString("hex"),
  WOS_CORE_SECRET: randomBytes(24).toString("base64url"),
  WOS_WEB_SESSION_SECRET: randomBytes(24).toString("base64url"),
  WOS_OWNER_EMAIL: "owner@example.test",
  WOS_APPS: "crm",
};
const compose = (...args: string[]) =>
  execFileSync("docker", ["compose", "-p", project, "-f", "docker-compose.yml", "-f", "docker-compose.proof.yml", ...args], {
    cwd: dir,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

describe.skipIf(process.env.WOS_DOCKER_PROOF !== "1")("suite-shell V1 proof step 8 in Docker", () => {
  afterAll(() => {
    try {
      compose("--profile", "proof", "down", "-v", "--remove-orphans");
    } catch {}
  });

  it("self-hosted Core with WOS_APPS=crm and no route to warOnSaaS; wOS Web shows CRM", { timeout: 300_000 }, () => {
    execFileSync(process.execPath, ["build.mjs"], { cwd: `${dir}apps/api`, stdio: "ignore" });
    execFileSync(process.execPath, ["build.mjs"], { cwd: `${dir}apps/web`, stdio: "ignore" });
    compose("up", "-d", "--build", "--wait", "postgres", "core", "web");

    // Nothing is published and the networks are internal: neither Core nor the probe can reach warOnSaaS.
    const noRoute = `fetch("https://api.waronsaas.com/v1/health",{signal:AbortSignal.timeout(5000)}).then(()=>process.exit(1),()=>process.exit(0))`;
    compose("exec", "-T", "core", "node", "-e", noRoute);
    expect(compose("run", "--rm", "probe", "noroute")).toContain("no route");

    const started = JSON.parse(compose("run", "--rm", "probe", "start", "owner@example.test").trim().split("\n").pop()!) as {
      cookie: string;
    };
    const code = /sign-in code for owner@example\.test[^:]*: ([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(compose("logs", "core"))?.[1];
    expect(code).toBeTruthy();
    expect(compose("run", "--rm", "probe", "finish", started.cookie, code!)).toContain("PROOF OK");
  });
});
