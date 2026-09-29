/**
 * Golden tests of every `wos` command against the real orchestrator, its fake control plane and fake
 * agent CLIs (WORKSTREAMS 11.1 DONE 1). Human output is compared with files in test/golden; --json
 * output must be OrchestratorEvent lines plus one result line.
 */
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import type { OrchestratorEvent } from "@waronsaas/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { ABU_KEY, type Harness, harness, normalize, TARGET, wos } from "./support.js";

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

const golden = (name: string) => `./golden/${name}`;
const paths = () => ({
  "<root>": [h!.root, realpathSync(h!.root)],
  "<upstream>": [h!.upstream.dir, realpathSync(h!.upstream.dir)],
});
const cli = (argv: string[], opts: Parameters<typeof wos>[2] = {}) => wos(() => h!.make("cli"), argv, opts);

describe("wos help and usage (exit 2)", () => {
  it("wos --help and wos build --help", async () => {
    h = harness();
    const top = await cli(["--help"]);
    expect(top.code).toBe(0);
    await expect(top.out).toMatchFileSnapshot(golden("help.txt"));
    const build = await cli(["build", "--help"]);
    expect(build.code).toBe(0);
    await expect(build.out).toMatchFileSnapshot(golden("build-help.txt"));
  });

  it.each([
    [["bogus"], "unknown command"],
    [["build"], "missing required argument 'abu'"],
    [["build", "x", "--model", "gpt-4"], "argument 'gpt-4' is invalid"],
    [["review", "--slot", "opus"], "argument 'opus' is invalid"],
    [["resolve", "--model", "opus"], "argument 'opus' is invalid"],
    [["roadmap", "--model", "sol"], "argument 'sol' is invalid"],
    [["login", "not-an-email"], "login needs an email address"],
    [["propose", "--target", "salesforce", "--title", "t"], "exactly one of --body or --body-file"],
    [["events", "--after", "x"], "--after takes an event id"],
  ])("%j exits 2", async (argv, message) => {
    h = harness();
    const r = await cli(argv);
    expect(r.code).toBe(2);
    expect(r.err).toContain(message);
    expect(h.server.calls).toEqual([]);
  });
});

describe("identity", () => {
  it("wos login: emails a code, retries a wrong one, stores the session in the SecretStore", async () => {
    h = harness();
    await h.secrets.delete("wos.session.v1");
    const r = await cli(["login", "dev@example.com"], { lines: ["wrong-code", "abcd-efgh"] });
    expect(r.code, r.err).toBe(0);
    expect(r.asked).toEqual(["code from the email: ", "code from the email: "]);
    expect(h.server.signInStarts[0]).toMatchObject({ email: "dev@example.com", clientKind: "cli", deviceName: "test-host" });
    expect(JSON.parse((await h.secrets.get("wos.session.v1"))!)).toMatchObject({ accessToken: "test-access" });
    await expect(r.out + r.err).toMatchFileSnapshot(golden("login.txt"));
  });

  it("wos login prompts for the email and fails with exit 1 when no code is entered", async () => {
    h = harness();
    await h.secrets.delete("wos.session.v1");
    const r = await cli(["login"], { lines: ["dev@example.com"] });
    expect(r.asked).toEqual(["email: ", "code from the email: "]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("ABORTED: no code entered");
    expect(await h.secrets.get("wos.session.v1")).toBeNull();
  });

  it("wos link-github prints the verification URL and code, then the linked account", async () => {
    h = harness();
    h.server.meOverride = { github: null, canContribute: false };
    h.server.githubLinkScript = ["pending", "linked"];
    const r = await cli(["link-github"]);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain("open     https://github.com/login/device\nenter    WOS1-2345\n");
    await expect(r.out).toMatchFileSnapshot(golden("link-github.txt"));
  });

  it("wos link-github exits 3 when the GitHub account is linked elsewhere", async () => {
    h = harness();
    h.server.meOverride = { github: null, canContribute: false };
    h.server.githubLinkScript = ["elsewhere"];
    const r = await cli(["link-github"]);
    expect(r.code).toBe(3);
    expect(r.err).toContain("GITHUB_LINKED_ELSEWHERE");
  });

  it("wos logout removes the session and keeps the device key", async () => {
    h = harness();
    await h.secrets.set("wos.device-key.v1", "pem");
    const r = await cli(["logout"]);
    expect(r).toMatchObject({ code: 0, out: "signed out\n" });
    expect(await h.secrets.get("wos.session.v1")).toBeNull();
    expect(await h.secrets.get("wos.device-key.v1")).toBe("pem");
  });
});

describe("wos status", () => {
  it("git, claude, codex, sign-in, toolchain attestation and work (golden)", async () => {
    h = harness();
    const r = await cli(["status"]);
    expect(r.code, r.err).toBe(0);
    expect(h.server.attestations).toHaveLength(1);
    await expect(normalize(r.out, paths())).toMatchFileSnapshot(golden("status.txt"));
  });

  it("signed out: says so, posts nothing, exit 0", async () => {
    h = harness();
    await h.secrets.delete("wos.session.v1");
    const r = await cli(["status"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("account    signed out (wos login)");
    expect(h.server.attestations).toHaveLength(0);
  });

  it("--json prints the LocalStatus and my work as one result line", async () => {
    h = harness();
    const r = await cli(["status", "--json"]);
    const line = JSON.parse(r.out.trim());
    expect(line.type).toBe("result");
    expect(line.status.toolchain).toMatchObject({ os: "linux", tools: [{ name: "node" }, { name: "android-sdk" }] });
    expect(line.work).toEqual({ leases: [], tasks: [], attempts: [] });
  });
});

describe("wos build", () => {
  it("LEASE -> ... -> PR merged, human output (golden)", async () => {
    h = harness();
    const r = await cli(["build", `${TARGET}/${ABU_KEY}`]);
    expect(r.code, r.err).toBe(0);
    await expect(normalize(r.out, paths())).toMatchFileSnapshot(golden("build.txt"));
    expect(r.out).not.toMatch(/^\| /m); // agent output only with --verbose
  });

  it("--json streams every OrchestratorEvent unchanged, then one result line (golden)", async () => {
    h = harness();
    const events: OrchestratorEvent[] = [];
    // The same run observed directly: CLI JSON lines must equal the orchestrator's event stream.
    const r = await wos(() => {
      const o = h!.make("cli");
      return {
        ...o,
        build: (opts, obs) =>
          o.build(opts, (e) => {
            events.push(e);
            obs(e);
          }),
      } as typeof o;
    }, ["--json", "build", `${TARGET}/${ABU_KEY}`]);
    expect(r.code, r.err).toBe(0);
    const lines = r.out
      .trimEnd()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines.slice(0, -1)).toEqual(JSON.parse(JSON.stringify(events)));
    expect(lines.at(-1)).toMatchObject({ type: "result", result: { ok: true, attempt: { state: "merged" } } });
    const types = lines.slice(0, -1).map((l) => (l.type === "step" ? `step:${l.step}:${l.status}` : l.type));
    await expect(`${types.join("\n")}\n`).toMatchFileSnapshot(golden("build-json-types.txt"));
  });

  it("--verbose shows agent output", async () => {
    h = harness();
    const r = await cli(["build", `${TARGET}/${ABU_KEY}`, "--verbose"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('| {"type":"system","subtype":"init","model":"claude-opus-5-5"}');
  });

  it("a failing attempt exits 1 with the error on stderr", async () => {
    h = harness();
    h.processes.script.push("out-of-scope", "out-of-scope", "out-of-scope", "out-of-scope");
    const r = await cli(["build", `${TARGET}/${ABU_KEY}`]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/^error {4}[A-Z_]+: /m);
    expect(r.out).toMatch(/^result {3}failed {3}[A-Z_]+$/m);
  });

  it("not signed in: exit 3", async () => {
    h = harness();
    await h.secrets.delete("wos.session.v1");
    const r = await cli(["build", `${TARGET}/${ABU_KEY}`]);
    expect(r.code).toBe(3);
    expect(r.err).toContain("UNAUTHENTICATED");
  });

  it("--model is passed to the orchestrator (D15, contracts 4.3.0)", async () => {
    h = harness();
    const seen: Array<string | undefined> = [];
    const r = await wos(() => {
      const o = h!.make("cli");
      return { ...o, build: (opts, obs) => (seen.push(opts.model), o.build(opts, obs)) } as typeof o;
    }, ["build", `${TARGET}/${ABU_KEY}`, "--model", "astra"]);
    expect(r.code, r.err).toBe(0);
    expect(seen).toEqual(["astra"]);
  });

  it.each([
    ["NOT_ELIGIBLE", 403, "astra", "Astra is not allowed for this role, or codex is not attested on this device"],
    ["LIMIT_REACHED", 409, "sol", "one build lease per provider (D15): you already hold one on codex"],
    ["NOT_ELIGIBLE", 403, undefined, "run wos status (it posts your attestation)"],
  ])("a claim refused with %s explains the model choice (exit 1)", async (code, status, model, hint) => {
    h = harness();
    const served = h.server.fetch;
    h.server.fetch = async (input, init) =>
      /\/v1\/abus\/[^/]+\/claim$/.test(new URL(String(input)).pathname)
        ? new Response(JSON.stringify({ error: { code, message: "refused", requestId: "r" } }), { status })
        : served(input, init);
    const r = await cli(["build", `${TARGET}/${ABU_KEY}`, ...(model ? ["--model", model] : [])]);
    expect(r.code).toBe(1);
    expect(r.err).toContain(`error    ${code}: claimBuild: ${code}: refused`);
    expect(r.err).toMatch(/^hint {5}/m);
    expect(r.err).toContain(hint);
  });
});

describe("wos review", () => {
  it("both reviewer slots, each through its own orchestrator, while a build waits (golden)", async () => {
    h = harness();
    h.server.reviewMode = "orchestrators";
    const reviewerRoot = `${h.root}-reviewers`;
    const outputs: string[] = [];
    h.idle.push(async () => {
      for (const slot of ["astra", "fable"] as const) {
        if (h!.server.reviewTasks.some((t) => t.slot === slot && t.state === "open")) {
          const r = await wos(() => h!.make("cli", { root: reviewerRoot }), ["review", "--slot", slot]);
          expect(r.code, r.err).toBe(0);
          outputs.push(`$ wos review --slot ${slot}\n${r.out}`);
        }
      }
    });
    const build = await cli(["build", `${TARGET}/${ABU_KEY}`]);
    expect(build.code, build.err).toBe(0);
    expect(h.server.verdicts.map((v) => v.slot)).toEqual(["astra", "fable"]);
    await expect(
      normalize(outputs.join("\n"), { ...paths(), "<reviewers>": [reviewerRoot, realpathSync(reviewerRoot)] }),
    ).toMatchFileSnapshot(golden("review.txt"));
  });

  it("without --slot, both slots eligible on this machine: exit 2", async () => {
    h = harness();
    const r = await cli(["review"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("pass --slot astra or --slot fable");
  });
});

describe("wos roadmap / wos resolve", () => {
  it("wos roadmap with no id takes the single open roadmap task (golden)", async () => {
    h = harness();
    h.server.openAuthorTask("roadmap_author");
    const r = await cli(["roadmap"]);
    expect(r.code, r.err).toBe(0);
    expect(h.server.submissions[0]!.files.map((f) => f.path)).toEqual(["roadmaps/salesforce/ROADMAP.yaml"]);
    await expect(normalize(r.out, paths())).toMatchFileSnapshot(golden("roadmap.txt"));
  });

  it("wos roadmap lists several open tasks and asks for one (exit 2); with an id it runs that one", async () => {
    h = harness();
    const a = h.server.openAuthorTask("roadmap_author");
    h.server.openAuthorTask("roadmap_author");
    const list = await cli(["roadmap"]);
    expect(list.code).toBe(2);
    expect(list.out).toContain(a.id);
    expect(list.err).toContain("2 open tasks: pick one, wos roadmap <task>");
    const run = await cli(["roadmap", a.id, "--model", "astra"]);
    expect(run.code, run.err).toBe(0);
    expect(run.out).toMatch(/^result {3}ok {7}roadmap_author \| drafted roadmaps\/salesforce\/ROADMAP.yaml$/m);
  });

  it("wos roadmap with nothing open: exit 0", async () => {
    h = harness();
    const r = await cli(["roadmap"]);
    expect(r).toMatchObject({ code: 0, out: "no open roadmap_author or feature_author tasks\n" });
  });

  it("wos resolve runs the conflict_resolution task and prints the ruling (golden)", async () => {
    h = harness();
    h.server.openAuthorTask("conflict_resolution");
    const r = await cli(["resolve"]);
    expect(r.code, r.err).toBe(0);
    expect(h.server.rulings).toHaveLength(1);
    await expect(normalize(r.out, paths())).toMatchFileSnapshot(golden("resolve.txt"));
  });
});

describe("wos propose and the read commands", () => {
  it("wos propose prints the issue URL", async () => {
    h = harness();
    const r = await cli([
      "propose",
      "--target",
      "salesforce",
      "--feature",
      "contacts",
      "--title",
      "Split contacts#04",
      "--body",
      "Too big.",
    ]);
    expect(r).toMatchObject({ code: 0, out: "proposed https://github.com/waronsaas/product/issues/1\n" });
  });

  it("wos propose --body-file - reads stdin", async () => {
    h = harness();
    const r = await cli(["propose", "--target", "salesforce", "--title", "t", "--body-file", "-", "--json"], {
      lines: ["line 1", "line 2"],
    });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual({ type: "result", issueUrl: "https://github.com/waronsaas/product/issues/1" });
  });

  it("wos abus, wos tasks, wos work (golden)", async () => {
    h = harness();
    h.server.openAuthorTask("roadmap_author");
    const abus = await cli(["abus", TARGET, "contacts"]);
    const tasks = await cli(["tasks", "--kind", "roadmap_author"]);
    const work = await cli(["work"]);
    for (const r of [abus, tasks, work]) expect(r.code, r.err).toBe(0);
    await expect(`$ wos abus\n${abus.out}\n$ wos tasks\n${tasks.out}\n$ wos work\n${work.out}`).toMatchFileSnapshot(golden("reads.txt"));
  });

  it("wos events prints my events; an API failure exits 1", async () => {
    h = harness();
    const served = h.server.fetch;
    h.server.fetch = async (input, init) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.pathname !== "/v1/me/events") return served(input, init);
      const after = Number(url.searchParams.get("after") ?? 0);
      const items = [
        {
          id: 7,
          v: 1,
          visibility: "public",
          occurredAt: "2026-09-29T12:00:00Z",
          actorAccountId: null,
          actorKind: "system",
          aggregateKind: "attempt",
          aggregateId: "a1",
          contractsVersion: "4.2.0",
          type: "attempt.created",
          payload: { attemptId: "0192ab3c-0000-7000-8000-000000000003", abu: "contacts#04", state: "leased" },
        },
      ].filter((e) => e.id > after);
      return new Response(JSON.stringify({ items, lastId: 7 }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const r = await cli(["events"]);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain("7   2026-09-29T12:00:00Z  attempt.created  attempt a1");
    const none = await cli(["events", "--after", "7"]);
    expect(none.out).toBe("no events (last id 7)\n");
    // The shared fake control plane serves listMyEvents since Wave 2a, so the failure is forced explicitly.
    h.server.fetch = async (input, init) =>
      new URL(String(input instanceof Request ? input.url : input)).pathname === "/v1/me/events"
        ? new Response(JSON.stringify({ error: { code: "INTERNAL", message: "boom", requestId: "r1" } }), {
            status: 500,
            headers: { "content-type": "application/json" },
          })
        : served(input, init);
    const failed = await cli(["events"]);
    expect(failed.code).toBe(1);
    expect(failed.err).toMatch(/^error {4}INTERNAL: /);
  });
});

describe("presentation", () => {
  it("monochrome by default; bold/dim only on a TTY without NO_COLOR", async () => {
    h = harness();
    const esc = "\u001b[";
    const plain = await cli(["status"], { isTTY: false });
    expect(plain.out).not.toContain(esc);
    const noColor = await cli(["status"], { isTTY: true, env: { NO_COLOR: "1" } });
    expect(noColor.out).not.toContain(esc);
    const tty = await cli(["status"], { isTTY: true });
    expect(tty.out).toContain(`${esc}1mwOS status${esc}22m`);
    // Only bold (1) and dim (2): never a colour.
    const codes = tty.out
      .split(esc)
      .slice(1)
      .map((chunk) => /^(\d+)m/.exec(chunk)?.[1]);
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.every((c) => c === "1" || c === "2" || c === "22")).toBe(true);
  });

  it("S-4: after login and a build, no token material exists under the workspace", async () => {
    h = harness();
    await h.secrets.delete("wos.session.v1");
    expect((await cli(["login", "dev@example.com"], { lines: ["ABCD-EFGH"] })).code).toBe(0);
    expect((await cli(["build", `${TARGET}/${ABU_KEY}`, "--detach"])).code).toBe(0);
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else files.push(p);
      }
    };
    walk(h.root);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const text = readFileSync(f).toString("latin1");
      expect(text.includes("test-access") || text.includes("test-refresh") || text.includes("PRIVATE KEY"), f).toBe(false);
    }
  });
});
