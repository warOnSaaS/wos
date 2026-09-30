/**
 * The renderer: honest empty states (0% is 0%), the model picker shows only attested models, the look
 * is monochrome with one face and no text-transform, and renderer code never reaches for Node.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { AGENT_POLICY_V1, type LocalStatus, type Me, TOKEN_DISCLAIMER } from "@waronsaas/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { featureDetail, targetDetail, targets } from "../dev/fixtures.js";
import { builderModelChoices } from "../src/apps/build/main/models.js";
import { ContributionsView, ProfileView, WorkView } from "../src/apps/build/renderer/Account.js";
import { ActivityView } from "../src/apps/build/renderer/Activity.js";
import { BuildPanelView, type BuildPanelProps, FeatureView, SniperListView, TargetView } from "../src/apps/build/renderer/Targets.js";
import { agentLines, bar, eventLines, pct } from "../src/renderer/lib/format.js";
import { AppsView, type AppsViewProps } from "../src/renderer/screens/Apps.js";
import { SettingsView } from "../src/renderer/screens/Settings.js";
import type { ShellState } from "../src/shared/ipc.js";
import { APP_INFO } from "./support.js";

const here = import.meta.dirname;
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const noop = () => undefined;

const ME: Me = {
  id: "0192ab3c-0000-7000-8000-00000000aaaa",
  email: "dev@example.com",
  handle: "octo-dev",
  github: { userId: 4242, login: "octo-dev", linkedAt: "2026-09-29T12:00:00Z", accountCreatedAt: "2019-01-01T00:00:00Z" },
  canContribute: true,
  displayName: null,
  roles: [],
  leaderboardOptIn: false,
  status: "active",
  followedTargets: [],
  progressEmails: false,
  attestations: [],
  balance: { held: 0, available: 0, score: 0 },
};

const provider = (id: "claude_cli" | "codex_cli", ok: { installed: boolean; signedIn: boolean }) => ({
  provider: id,
  installed: ok.installed,
  cliVersion: ok.installed ? "1.0.0" : null,
  signedIn: ok.signedIn,
  authMethod: ok.signedIn ? "subscription" : null,
  models: id === "claude_cli" ? (["fable", "opus"] as const).slice() : (["astra", "sol"] as const).slice(),
  checkedAt: "2026-09-29T12:00:00Z",
  problems: [],
});

const status = (claude: boolean, codex: boolean): LocalStatus => ({
  signedIn: true,
  me: ME,
  git: { installed: true, version: "2.47.1" },
  providers: [provider("claude_cli", { installed: true, signedIn: claude }), provider("codex_cli", { installed: codex, signedIn: codex })],
  eligibleRoles: ["builder"],
  activeLeases: [],
  workspaceRoot: "/tmp/ws",
  toolchain: null,
});

describe("format: honest numbers", () => {
  it("0 is 0.00%, never rounded up; the bar never fills a cell early", () => {
    expect(pct(0)).toBe("0.00%");
    expect(pct(null)).toBe("0.00%");
    expect(pct(1)).toBe("0.01%");
    expect(pct(1250)).toBe("12.50%");
    expect(pct(10_000)).toBe("100.00%");
    expect(pct(99_999)).toBe("100.00%");
    expect(bar(0)).toBe("[..........]");
    expect(bar(999)).toBe("[..........]");
    expect(bar(1000)).toBe("[#.........]");
    expect(bar(10_000)).toBe("[##########]");
  });
  it("agent output is shown as words, not raw JSON", () => {
    const chunk = `${JSON.stringify({ type: "system", model: "claude-opus-5-5" })}\n${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Editing list.ts" }] } })}\nplain line\n`;
    expect(agentLines(chunk)).toEqual(["session started, model claude-opus-5-5", "Editing list.ts", "plain line"]);
    expect(eventLines({ type: "error", code: "LIMIT_REACHED", message: "x", recoverable: false })[0]).toMatchObject({
      tag: "ERROR",
      strong: true,
    });
  });
});

const SHELL: ShellState = {
  environment: {
    url: "https://core.waronsaas.com",
    isDefault: true,
    descriptor: null,
    problem: "NOT REACHABLE: https://core.waronsaas.com did not answer (fetch failed).",
    session: { signedIn: false, waitingForCode: false, email: null, organizationId: null, role: null, expiresAt: null },
  },
  organizations: [
    {
      id: "0192f000-0000-7000-8000-0000000000a1",
      slug: "dev",
      name: "dev@example.com",
      kind: "personal",
      role: "owner",
      createdAt: "2026-09-29T12:00:00Z",
    },
  ],
  organizationId: "0192f000-0000-7000-8000-0000000000a1",
  activeApps: null,
  activeAppsProblem: "NOT REACHABLE: https://core.waronsaas.com did not answer (fetch failed).",
  modules: [],
  navigation: [],
  build: {
    entitled: true,
    entitledOrgs: ["0192f000-0000-7000-8000-0000000000a1"],
    onDevice: false,
    open: false,
    reason: "BUILD IS OFF ON THIS DEVICE. Turn it on to let wOS run claude, codex and git here.",
    checkedAt: "2026-09-30T12:00:00Z",
  },
};

describe("the shell's APPS screen", () => {
  const props = (over: Partial<AppsViewProps>): AppsViewProps => ({
    me: ME,
    shell: SHELL,
    orgApps: { organizationId: SHELL.organizationId!, yourApps: [], availableApps: [] },
    orgAppsProblem: null,
    busy: null,
    error: null,
    onSelectOrg: noop,
    onEnable: noop,
    onDisable: noop,
    onBuildOnDevice: noop,
    onSettings: noop,
    ...over,
  });

  it("empty lists and an unreachable environment are said plainly, never filled in", () => {
    const t = text(renderToStaticMarkup(<AppsView {...props({})} />));
    expect(t).toContain("NO APPS ENABLED");
    expect(t).toContain("NOTHING ELSE TO ENABLE");
    expect(t).toContain("NO ACTIVE APPS READ");
    expect(t).toContain("dev@example.com / PERSONAL / OWNER");
  });

  it("without a wOS account the cloud sections are replaced by one plain line", () => {
    const t = text(renderToStaticMarkup(<AppsView {...props({ me: null })} />));
    expect(t).toContain("NOT SIGNED IN TO A wOS ACCOUNT");
    expect(t).not.toContain("YOUR APPS NO APPS ENABLED");
  });
});

describe("screens render real API shapes with honest empty states", () => {
  it("Sniper List: TGT-00 first, untouched targets at exactly 0.00%", () => {
    const html = renderToStaticMarkup(<SniperListView targets={targets()} onOpen={noop} />);
    const t = text(html);
    expect(t).toMatch(/TGT-00 warOnSaaS/);
    expect(t).toMatch(/TGT-03 Slack Team chat for work\. NOT OPENED 0\.00% 0\.00% \[\.\.\.\.\.\.\.\.\.\.\] 0\.00%/);
    expect(t).toMatch(/Salesforce .* V1 MERGED 12\.50% 3\.10%/);
  });

  it("Target without a roadmap says so and shows 0%", () => {
    const t = text(renderToStaticMarkup(<TargetView target={targetDetail("slack")!} onBack={noop} onFeature={noop} />));
    expect(t).toContain("NO ROADMAP YET");
    expect(t).toContain("0% is 0%");
    expect(t).toContain("MAPPED 0.00%");
  });

  it("Target with a roadmap lists capabilities, features and unmapped capabilities honestly", () => {
    const t = text(renderToStaticMarkup(<TargetView target={targetDetail("salesforce")!} onBack={noop} onFeature={noop} />));
    expect(t).toContain("CRM / crm");
    expect(t).toContain("Contacts SPECIFIED V1 MERGED 0 OF 3 MERGED");
    expect(t).toContain("NOT MAPPED YET: NO FEATURES");
    expect(t).toContain("EXCLUDED: The vendor ships no desktop CRM client.");
  });

  const panel = (over: Partial<BuildPanelProps>): BuildPanelProps => ({
    me: ME,
    abu: {
      id: "0192ab3c-0000-7000-8000-000000000001",
      key: "contacts#04",
      title: "Contact list endpoint",
      state: "ready",
      sizePoints: 3,
      dependsOn: [],
      requirements: ["R-001"],
      repo: "waronsaas/product",
      relevantTo: ["salesforce"],
      claimable: true,
      pr: null,
    },
    models: builderModelChoices(AGENT_POLICY_V1, status(true, true)),
    model: "opus",
    onModel: noop,
    onBuild: noop,
    starting: false,
    lastRun: null,
    error: null,
    onRefreshModels: noop,
    ...over,
  });

  it("model picker: only models this device attested are offered; others are explained", () => {
    const html = renderToStaticMarkup(
      <BuildPanelView {...panel({ models: builderModelChoices(AGENT_POLICY_V1, status(true, false)), model: "opus" })} />,
    );
    expect(html).toContain('data-testid="model-opus"');
    expect(html).not.toContain('data-testid="model-astra"');
    expect(html).not.toContain('data-testid="model-sol"');
    expect(html).not.toContain('data-testid="model-fable"');
    expect(text(html)).toContain("ASTRA NOT OFFERED: codex IS NOT INSTALLED on this device.");
    expect(text(html)).toContain("BUILD WITH OPUS");
    expect(html).not.toMatch(/data-testid="build"[^>]*disabled/);
  });

  it("BUILD is disabled, with the reason in words, when GitHub is not linked or no model is attested", () => {
    const noGithub = text(renderToStaticMarkup(<BuildPanelView {...panel({ me: { ...ME, github: null, canContribute: false } })} />));
    expect(noGithub).toContain("LINK GITHUB FIRST");
    const noModels = renderToStaticMarkup(
      <BuildPanelView {...panel({ models: builderModelChoices(AGENT_POLICY_V1, status(false, false)), model: null })} />,
    );
    expect(text(noModels)).toContain("NO BUILDER MODEL IS ATTESTED ON THIS DEVICE");
    expect(noModels).toMatch(/<button[^>]*disabled=""[^>]*data-testid="build"/);
  });

  it("a failed run is explained on the unit", () => {
    const t = text(
      renderToStaticMarkup(
        <BuildPanelView
          {...panel({
            lastRun: {
              id: "r",
              kind: "build",
              subject: "x",
              model: "astra",
              startedAt: "",
              finishedAt: "",
              state: "failed",
              code: "LIMIT_REACHED",
              explanation: "LIMIT REACHED. You already hold a build lease on this provider.",
              attempt: null,
            },
          })}
        />,
      ),
    );
    expect(t).toContain("LAST RUN ON THIS UNIT: FAILED");
    expect(t).toContain("You already hold a build lease on this provider.");
  });

  it("Feature: units table and requirements", () => {
    const abu = panel({}).abu!;
    const f = featureDetail("salesforce", "contacts", abu)!;
    const t = text(
      renderToStaticMarkup(
        <FeatureView
          feature={f}
          targetName="Salesforce"
          capability="crm"
          abus={[abu]}
          abusNote={null}
          selected={abu.id}
          onSelect={noop}
          onBack={noop}
          onTarget={noop}
          panel={panel({})}
        />,
      ),
    );
    expect(t).toContain("SNIPER LIST / Salesforce / CRM / Contacts");
    expect(t).toContain("contacts#04 Contact list endpoint READY YES 3 R-001");
    expect(t).toContain("1 CLAIMABLE");
  });

  it("Contributions: empty history is said plainly, token history hidden when not opted in", () => {
    const t = text(
      renderToStaticMarkup(
        <ContributionsView
          history={{
            handle: "octo-dev",
            profile: null,
            ledger: null,
            ledgerHiddenReason: "NO PUBLIC PROFILE YET. It appears after the first accepted contribution.",
          }}
          disclaimer={TOKEN_DISCLAIMER}
        />,
      ),
    );
    expect(t).toContain("CONTRIBUTIONS 0 ACCEPTED 0 PENDING 0 SCORE NOT PUBLIC");
    expect(t).toContain("NO CONTRIBUTIONS YET");
    expect(t).toContain(TOKEN_DISCLAIMER);
  });

  it("Profile shows the balance with the D3 disclaimer and the toolchain attestation", () => {
    const s = {
      ...status(true, true),
      toolchain: {
        os: "macos" as const,
        osVersion: "15.6.1",
        tools: [{ name: "xcode" as const, version: "26.0.1" }],
        checkedAt: "2026-09-29T12:00:00Z",
      },
    };
    const t = text(renderToStaticMarkup(<ProfileView me={ME} status={s} disclaimer={TOKEN_DISCLAIMER} />));
    expect(t).toContain("SCORE 0 AVAILABLE 0 HELD 0");
    expect(t).toContain(TOKEN_DISCLAIMER);
    expect(t).toContain("OS MACOS 15.6.1");
    expect(t).toContain("XCODE 26.0.1");
    const none = text(renderToStaticMarkup(<ProfileView me={ME} status={status(true, true)} disclaimer={TOKEN_DISCLAIMER} />));
    expect(none).toContain("NOT ATTESTED YET");
  });

  it("Work and Settings render; no attempts is an honest empty state", () => {
    expect(text(renderToStaticMarkup(<WorkView work={{ leases: [], tasks: [], attempts: [] }} onRelease={noop} />))).toContain(
      "NO ATTEMPTS YET",
    );
    const s = text(
      renderToStaticMarkup(
        <SettingsView
          settings={{
            deviceName: "dev",
            detachAfterSubmit: true,
            preferredModel: null,
            eventsPollSeconds: 5,
            environmentUrl: "https://core.waronsaas.com",
            organizationId: null,
            buildOnDevice: false,
          }}
          me={ME}
          info={APP_INFO}
          shell={SHELL}
          onChange={noop}
          onLogout={noop}
          onOpen={noop}
          onBuildOnDevice={noop}
          onEnvironment={noop}
          onEnvSignIn={noop}
          onEnvCode={noop}
          onEnvSignOut={noop}
        />,
      ),
    );
    expect(s).toContain("OS KEYCHAIN");
    expect(s).toContain("B-0003-desktop");
    expect(s).toContain("ENVIRONMENT");
    expect(s).toContain("NOT REACHABLE: https://core.waronsaas.com did not answer");
    expect(s).toContain("USE BUILD ON THIS DEVICE");
    expect(s).toContain("BUILD IS OFF ON THIS DEVICE");
  });

  it("Activity: nothing run yet says so; runs show state in words", () => {
    expect(
      text(renderToStaticMarkup(<ActivityView runs={[]} entries={[]} server={[]} filter="all" onFilter={noop} polling="" />)),
    ).toContain("NOTHING HAS RUN YET");
    const t = text(
      renderToStaticMarkup(
        <ActivityView
          runs={[
            {
              id: "a",
              kind: "build",
              subject: "x",
              model: "opus",
              startedAt: "",
              finishedAt: null,
              state: "running",
              code: null,
              explanation: null,
              attempt: null,
            },
            {
              id: "b",
              kind: "build",
              subject: "y",
              model: "astra",
              startedAt: "",
              finishedAt: "",
              state: "failed",
              code: "NOT_ELIGIBLE",
              explanation: "NOT ELIGIBLE.",
              attempt: null,
            },
          ]}
          entries={[{ seq: 1, runId: "a", at: "2026-09-29T12:00:00Z", line: { tag: "LEASE", text: "STARTED", strong: false } }]}
          server={[]}
          filter="all"
          onFilter={noop}
          polling=""
        />,
      ),
    );
    expect(t).toContain("1 RUNNING");
    expect(t).toMatch(/RUN 01 BUILD x OPUS RUNNING/);
    expect(t).toMatch(/RUN 02 BUILD y ASTRA FAILED/);
    expect(t).toContain("12:00:00 01 LEASE STARTED");
  });
});

// ------------------------------------------------------------------------------------ static checks

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p, ext) : ext.test(f) ? [p] : [];
  });
}

describe("renderer isolation (static)", () => {
  const sources = [
    ...files(join(here, "../src/renderer"), /\.(ts|tsx)$/),
    ...files(join(here, "../src/apps/build/renderer"), /\.(ts|tsx)$/),
  ];
  it("never imports Node, Electron, the orchestrator or runtime values from contracts", () => {
    expect(sources.length).toBeGreaterThan(5);
    for (const f of sources) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"([^"]+)";/gms)) {
        const spec = m[2]!;
        expect(spec, f).not.toMatch(/^(node:|electron|fs$|path$|child_process|os$|@waronsaas\/orchestrator)/);
        if (spec.startsWith("@waronsaas/")) expect(m[0], `${f}: contracts is types-only in the renderer`).toMatch(/^import\s+type\s/);
      }
      expect(src, f).not.toMatch(/\brequire\(/);
      expect(src, f).not.toMatch(/\bprocess\./);
      expect(src, f).not.toMatch(/dangerouslySetInnerHTML/);
    }
  });
});

describe("the look (founder's rule and the site's CSS rules)", () => {
  const css = readFileSync(join(here, "../src/renderer/styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const tsx = [...files(join(here, "../src/renderer"), /\.tsx$/), ...files(join(here, "../src/apps/build/renderer"), /\.tsx$/)].map((f) =>
    readFileSync(f, "utf8"),
  );
  it("monochrome: every colour is a grey (r = g = b), no gradients, no shadows, square corners", () => {
    const hexes = [...css.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)].map((m) => m[1]!.toLowerCase());
    expect(hexes.length).toBeGreaterThan(5);
    for (const h of hexes) {
      const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
      const [r, g, b] = [0, 2, 4].map((i) => Math.abs(Number.parseInt(full.slice(i, i + 2), 16)));
      expect(Math.max(r!, g!, b!) - Math.min(r!, g!, b!), `#${h}`).toBeLessThanOrEqual(3);
    }
    expect(css).not.toMatch(/gradient\(|rgba?\(|hsla?\(/);
    expect(css).toMatch(/border-radius: 0 !important/);
    expect(css).toMatch(/box-shadow: none !important/);
  });
  it("JetBrains Mono for everything, Geist Mono Bold for the wOS mark only; both bundled with their OFL licences", () => {
    const families = new Set([...css.matchAll(/font-family:\s*([^;]+);/g)].map((m) => m[1]!.split(",")[0]!.trim()));
    expect([...families].sort()).toEqual(['"Geist Mono"', '"JetBrains Mono"']);
    expect(css).toContain('url("./fonts/JetBrainsMono-400.ttf")');
    expect(css).toContain('url("./fonts/GeistMono-700.ttf")');
    // Geist Mono is used by the masthead mark and the sign-in mark, nowhere else.
    const uses = [...css.matchAll(/([^{}]+)\{[^}]*font-family:\s*"Geist Mono",/g)].map((m) => m[1]!.trim());
    expect(uses).toEqual([".wordmark", ".gate .mark"]);
    expect(readFileSync(join(here, "../src/renderer/fonts/OFL-JetBrainsMono.txt"), "utf8")).toMatch(/SIL OPEN FONT LICENSE/i);
    expect(readFileSync(join(here, "../src/renderer/fonts/OFL-GeistMono.txt"), "utf8")).toMatch(/SIL OPEN FONT LICENSE/i);
  });
  it("no text-transform and no italic: capitals are written in the source", () => {
    expect(css).not.toMatch(/text-transform/);
    expect(css).toMatch(/font-style: normal !important/);
    for (const src of tsx) expect(src).not.toMatch(/textTransform|toUpperCase\(\)\s*}\s*<\/h1>/);
  });
  it("casing: warOnSaaS and wOS are never re-cased in human-facing strings", () => {
    for (const src of tsx) {
      expect(src).not.toMatch(/WarOnSaas|Waronsaas|WARONSAAS|WaronSaaS|WAROnSaaS|\bWOS DESKTOP\b|\bWos\b/);
      // Names are data: never upper-cased (TGT-00 is "warOnSaaS"; upper-casing it would break the casing rule).
      expect(src).not.toMatch(/\.(name|title|targetName)\.toUpperCase\(\)/);
    }
  });
});
