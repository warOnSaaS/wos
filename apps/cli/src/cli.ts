/**
 * `wos`: a thin shell over the Orchestrator (packages/contracts/src/orchestrator.ts). Each command
 * calls one orchestrator method and prints the events it streams. Argument parsing, presentation and
 * exit codes live here; workflow does not.
 *
 * Exit codes (WORKSTREAMS section 3): 0 success, 1 failure, 2 usage, 3 not signed in / GitHub required.
 */
import { readFile } from "node:fs/promises";
import {
  AGENT_POLICY,
  BUILD_APP_ID,
  CONTRACTS_VERSION,
  type LaunchDeclaration,
  type ModelRef,
  type Orchestrator,
  type ReviewerSlot,
  Ruling,
  type RunResult,
  TaskKind,
  type TaskView,
} from "@waronsaas/contracts";
import { Command, CommanderError, Option } from "commander";
import { type AppsApi, AppsCallError } from "./apps.js";
import { describeResult, EventPrinter, renderStatus, type Style, styleFor, table, type Writer } from "./render.js";
import { parseVerdictFile, promptVerdict, renderHumanReview } from "./human-review.js";

export const EXIT = { ok: 0, failure: 1, usage: 2, auth: 3 } as const;

/** API and orchestrator codes that mean "sign in" or "link GitHub first" (orchestrator README). */
const AUTH_CODES = new Set(["UNAUTHENTICATED", "GITHUB_REQUIRED", "GITHUB_LINKED_ELSEWHERE", "GITHUB_RESERVED"]);

export function exitCodeFor(code: string): number {
  if (AUTH_CODES.has(code)) return EXIT.auth;
  return EXIT.failure;
}

export interface CliIo {
  stdout: Writer;
  stderr: Writer;
  /** Writes `question` (to stderr) and resolves with the next stdin line, or null at end of input. */
  prompt(question: string): Promise<string | null>;
  env: Record<string, string | undefined>;
  isTTY: boolean;
}

export interface CliDeps {
  /**
   * Built lazily so `--help` and usage errors never touch the keychain or network. `launch` (contracts 5.17.0, D52/D69):
   * the launch declared for claims and runs of these models (e.g. glm on OpenCode Go).
   */
  orchestrator(opts?: { launch?: Partial<Record<ModelRef, LaunchDeclaration>> }): Orchestrator;
  /** Organizations and app entitlements (AppRoutes); built lazily like the orchestrator. */
  apps(): AppsApi;
  version: string;
  hostname: string;
  /** Aborted on SIGINT: passed to long operations. */
  signal?: AbortSignal;
}

class UsageError extends Error {}

/**
 * A failure the CLI has explained: `code` is the server's (or the CLI's) error code, `message` says what happened
 * in plain words, `hints` say what to do. --json prints code, message, the server's message and details.
 */
export class ExplainedError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hints: string[] = [],
    readonly server: { message: string; details: unknown } | null = null,
  ) {
    super(message);
    this.name = "ExplainedError";
  }
}

/** Thrown to end a command with an exit code after its output was printed. */
class Exit extends Error {
  constructor(readonly exitCode: number) {
    super(`exit ${exitCode}`);
  }
}

/** Models a role may run on (policy data, D15). The server re-checks them against this device's attestation. */
const modelsFor = (...roles: string[]): ModelRef[] => [
  ...new Set(AGENT_POLICY.roles.filter((r) => roles.includes(r.role)).flatMap((r) => r.allowedModels)),
];
const BUILDER_MODELS = modelsFor("builder");
const AUTHOR_MODELS = modelsFor("roadmap_author", "feature_author");
const RESOLVER_MODELS = modelsFor("conflict_resolver");
const MODEL_LABEL: Record<ModelRef, string> = { opus: "Opus", astra: "Astra", sol: "Sol", fable: "Fable", glm: "GLM" };
const PROVIDER_OF = Object.fromEntries(AGENT_POLICY.models.map((m) => [m.ref, m.provider])) as Record<ModelRef, string>;
const CLI_OF: Record<string, string> = { claude_cli: "claude", codex_cli: "codex", opencode_cli: "opencode" };

/**
 * contracts 5.17.0: `--model` takes a policy model ref (opus, glm) or its model id, with or without the provider prefix
 * (`glm-5.3`, `opencode-go/glm-5.3`). Null when the policy has no such model.
 */
export function modelRefFor(value: string): ModelRef | null {
  const m = AGENT_POLICY.models.find((x) => x.ref === value || x.modelId === value || x.modelId.endsWith(`/${value}`));
  return m ? m.ref : null;
}
/** The launch the opencode CLI declares for a model (D52: self-reported), from its model id's provider prefix. */
const OPENCODE_LAUNCH = { provider: "opencode-go", baseUrl: null, identity: "self_reported" } as const;

interface HintContext {
  model?: ModelRef;
  lease?: "build" | "task";
}

/**
 * One line of advice for errors a contributor can act on. NOT_ELIGIBLE and LIMIT_REACHED from a claim
 * mean the model choice (D15); LIMIT_REACHED from the orchestrator itself means local repair loops ran out.
 */
export function hintFor(code: string, message: string, h: HintContext = {}): string | null {
  const fromClaim = /^claim(Build|Task|Review): /.test(message);
  const cli = h.model ? CLI_OF[PROVIDER_OF[h.model]] : undefined;
  switch (code) {
    case "UNAUTHENTICATED":
      return "sign in: wos login";
    case "GITHUB_REQUIRED":
      return "link GitHub first: wos link-github";
    case "GITHUB_LINKED_ELSEWHERE":
      return "that GitHub account is linked to another wOS account; sign in to GitHub as another user and retry";
    case "GITHUB_RESERVED":
      return "that GitHub account is reserved; contact the maintainers";
    case "NOT_ENTITLED":
      // S-40 / D16: claims are gated on the `build` app (WORKSTREAMS 12.4); the personal org is the default of `wos apps enable`.
      return `the ${APP_LABEL[BUILD_APP_ID]} app isn't enabled for your account, so wOS won't lease you work; enable it: wos apps enable ${BUILD_APP_ID}`;
    case "NOT_ELIGIBLE":
      return h.model
        ? `${MODEL_LABEL[h.model]} is not allowed for this role, or ${cli} is not attested on this device: run wos status, sign in to ${cli}, or pick another --model`
        : "this device is not eligible for that work: run wos status (it posts your attestation) and check the roles row";
    case "LIMIT_REACHED":
      if (!fromClaim) return null;
      return h.lease === "build"
        ? `one build lease per provider (D15): you already hold one on ${cli ?? "that provider"}; finish or wos release it, or build with the other provider's model`
        : "you hold the maximum number of leases for this kind of work; finish or wos release one (wos work)";
    default:
      return null;
  }
}
/** Display names for apps the CLI talks about before the registry has an entry for them. */
const APP_LABEL: Record<string, string> = { [BUILD_APP_ID]: "Build" };
const ROADMAP_KINDS: TaskKind[] = ["roadmap_author", "feature_author"];
const RESOLVE_KINDS: TaskKind[] = ["conflict_resolution"];

export async function runCli(argv: string[], io: CliIo, deps: CliDeps): Promise<number> {
  let orch: Orchestrator | null = null;
  const o = () => {
    orch ??= deps.orchestrator();
    return orch;
  };
  let appsApi: AppsApi | null = null;
  const a = () => {
    appsApi ??= deps.apps();
    return appsApi;
  };
  let exitCode: number = EXIT.ok;

  const ctx = (cmd: Command) => {
    const g = cmd.optsWithGlobals() as { json?: boolean; verbose?: boolean };
    const json = g.json === true;
    const style = styleFor({ isTTY: io.isTTY, env: io.env, json });
    return { json, style, printer: new EventPrinter(io.stdout, io.stderr, { json, verbose: g.verbose === true, style }) };
  };
  const printJson = (value: unknown) => io.stdout.write(`${JSON.stringify(value)}\n`);
  const finish = (r: RunResult, c: { json: boolean }, hc: HintContext = {}) => {
    if (c.json) printJson({ type: "result", result: r });
    else io.stdout.write(`${describeResult(r)}\n`);
    if (r.ok) return;
    const h = c.json ? null : hintFor(r.code, r.message, hc);
    if (h) io.stderr.write(`hint     ${h}\n`);
    throw new Exit(exitCodeFor(r.code));
  };

  const program = new Command()
    .name("wos")
    .description("wOS: build warOnSaaS with your own Claude Code and Codex CLIs")
    .version(`${deps.version} (contracts ${CONTRACTS_VERSION})`, "-V, --version")
    .option("--json", "print one JSON object per line (OrchestratorEvents, then a result line)")
    .option("-v, --verbose", "show raw agent output")
    .showHelpAfterError("(wos --help for usage)")
    .exitOverride()
    .configureOutput({ writeOut: (s) => io.stdout.write(s), writeErr: (s) => io.stderr.write(s) })
    .addHelpText(
      "after",
      "\nExit codes: 0 ok, 1 failed, 2 usage, 3 not signed in or GitHub not linked.\nSession: OS keychain. Workspace: $WOS_HOME (default ~/.wos).",
    );

  // ------------------------------------------------------------------------------ identity

  program
    .command("login")
    .argument("[email]", "your email address (prompted when omitted)")
    .option("--device-name <name>", "name shown for this machine", deps.hostname)
    .description("Sign in by email: wOS mails you an 8-character code")
    .action(async (emailArg: string | undefined, opts: { deviceName: string }, cmd: Command) => {
      const c = ctx(cmd);
      const email = (emailArg ?? (await io.prompt("email: ")) ?? "").trim();
      if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new UsageError("login needs an email address");
      const me = await o().signIn(
        { email, deviceName: opts.deviceName },
        {
          code: async () => {
            const code = await io.prompt("code from the email: ");
            if (code === null) throw codeError("ABORTED", "no code entered");
            return code;
          },
          signal: deps.signal,
        },
        c.printer.observe,
      );
      if (c.json) printJson({ type: "result", me });
      else if (!me.github) io.stdout.write("next: wos link-github (required to build, review, propose or resolve)\n");
    });

  program
    .command("link-github")
    .description("Link your GitHub account (device flow); required to contribute")
    .action(async (_opts: unknown, cmd: Command) => {
      const c = ctx(cmd);
      const me = await o().linkGithub(c.printer.observe, (url, userCode) => {
        if (c.json) return; // the github_link event carries both
        io.stdout.write(`open     ${url}\nenter    ${c.style.bold(userCode)}\n`);
      });
      if (c.json) printJson({ type: "result", me });
    });

  program
    .command("logout")
    .description("Sign out on this machine (revokes the session, keeps the device key)")
    .action(async (_opts: unknown, cmd: Command) => {
      const c = ctx(cmd);
      await o().logout();
      if (c.json) printJson({ type: "result", signedIn: false });
      else io.stdout.write("signed out\n");
    });

  program
    .command("status")
    .description("git, claude and codex readiness, sign-in, toolchain attestation, active work")
    .action(async (_opts: unknown, cmd: Command) => {
      const c = ctx(cmd);
      const s = await o().status();
      const work = s.me?.canContribute ? await o().myWork() : null;
      if (c.json) {
        printJson({ type: "result", status: s, work });
        return;
      }
      const summary = work && {
        leases: work.leases.length,
        tasks: work.tasks.length,
        attempts: work.attempts.map((a) => `${a.abu} ${a.state}${a.pr ? ` PR #${a.pr.number}` : ""}`),
      };
      io.stdout.write(renderStatus(s, summary, c.style));
    });

  // ------------------------------------------------------------------------------ work

  program
    .command("build")
    .argument("<abu>", "ABU id, or <target>/<abu-key> (e.g. salesforce/contacts#04)")
    .addOption(new Option("--model <model>", `builder model (D15), default ${BUILDER_MODELS[0]}`).choices(BUILDER_MODELS))
    .option("--detach", "stop after local verify and submit; `wos resume` re-attaches")
    .description("LEASE, BUILD, VERIFY, submit, then wait through CI, REVIEW, QUALIFY and PR")
    .action(async (abu: string, opts: { model?: ModelRef; detach?: boolean }, cmd: Command) => {
      const c = ctx(cmd);
      const r = await o().build(
        { abu, model: opts.model, detachAfterSubmit: opts.detach === true, signal: deps.signal },
        c.printer.observe,
      );
      finish(r, c, { model: opts.model, lease: "build" });
    });

  program
    .command("review")
    .addOption(new Option("--slot <slot>", "reviewer slot; default: the one this machine can serve").choices(["astra", "fable"]))
    .addOption(
      new Option("--kind <kind...>", "only these review kinds").choices(["roadmap_review", "feature_review", "implementation_review"]),
    )
    .option("--human", "the required human review (D53 fallback fable_unavailable): show a round, then record your verdict")
    .option("--round <id>", "with --human: the round (default: the only one waiting for you)")
    .option("--verdict-file <path>", "with --human: your verdict as review-verdict.v1 JSON (default: prompted on a terminal)")
    .description("Claim the review assigned to you and run it read-only (astra: codex, fable: claude); --human for the human seat")
    .action(
      async (
        opts: {
          slot?: ReviewerSlot;
          kind?: Array<"roadmap_review" | "feature_review" | "implementation_review">;
          human?: boolean;
          round?: string;
          verdictFile?: string;
        },
        cmd: Command,
      ) => {
        const c = ctx(cmd);
        if (opts.human) return humanReview(c, opts);
        if (opts.round || opts.verdictFile) throw new UsageError("--round and --verdict-file go with --human");
        let slot = opts.slot;
        if (!slot) {
          const roles = (await o().status()).eligibleRoles;
          const slots = (["astra", "fable"] as const).filter((s) => roles.some((r) => r.endsWith(`_reviewer_${s}`)));
          if (slots.length === 0) {
            c.printer.observe({
              type: "error",
              code: "NOT_ELIGIBLE",
              message: "this machine can serve no reviewer slot: sign in to codex (astra) or claude (fable), see wos status",
              recoverable: false,
            });
            throw new Exit(EXIT.failure);
          }
          if (slots.length > 1) throw new UsageError("this machine can serve both slots: pass --slot astra or --slot fable");
          slot = slots[0]!;
        }
        finish(await o().review({ slot, kinds: opts.kind, signal: deps.signal }, c.printer.observe), c);
      },
    );

  /** D53: the human seat. Show the round; record a verdict from a file or the prompts; never an agent run. */
  const humanReview = async (c: ReturnType<typeof ctx>, opts: { slot?: string; round?: string; verdictFile?: string }) => {
    if (opts.slot) throw new UsageError("--human holds the human seat; it takes no --slot");
    let roundId = opts.round;
    if (!roundId) {
      const queue = await explainApps(() => a().listHumanReviews());
      const mine = queue.filter((q) => q.eligibility.eligible);
      if (mine.length !== 1) {
        if (c.json) return void printJson({ type: "result", humanReviews: queue });
        if (queue.length === 0) return void io.stdout.write("no round is waiting for a human review\n");
        io.stdout.write(
          table(
            ["ROUND", "N", "SUBJECT", "ASTRA", "YOU"],
            queue.map((q) => [
              q.roundId,
              String(q.roundNumber),
              `${q.subjectKind} ${q.target ?? q.feature ?? q.subjectId}`,
              q.agentVerdictSealed ? "sealed" : "pending",
              q.eligibility.eligible ? "eligible" : q.eligibility.reasons.join("; "),
            ]),
            c.style,
          ),
        );
        if (mine.length > 1) io.stdout.write("pick one: wos review --human --round <id>\n");
        return;
      }
      roundId = mine[0]!.roundId;
    }
    const subject = await explainApps(() => a().getHumanReview(roundId));
    if (!opts.verdictFile && (c.json || !io.isTTY || !subject.round.eligibility.eligible)) {
      if (c.json) return void printJson({ type: "result", humanReview: subject });
      io.stdout.write(renderHumanReview(subject));
      if (subject.round.eligibility.eligible)
        io.stdout.write(`record it: wos review --human --round ${roundId} --verdict-file <review-verdict.v1 JSON>\n`);
      else throw new ExplainedError("NOT_ELIGIBLE", "you may not hold the human seat of this round", subject.round.eligibility.reasons);
      return;
    }
    if (!c.json) io.stdout.write(renderHumanReview(subject));
    if (!subject.round.eligibility.eligible)
      throw new ExplainedError("NOT_ELIGIBLE", "you may not hold the human seat of this round", subject.round.eligibility.reasons);
    let verdict: import("@waronsaas/contracts").ReviewVerdict | null;
    if (opts.verdictFile) {
      const parsed = parseVerdictFile(await readFile(opts.verdictFile, "utf8"), subject);
      if (!parsed.ok) throw new ExplainedError("VALIDATION_FAILED", `${opts.verdictFile} is not a verdict for this round`, parsed.problems);
      verdict = parsed.verdict;
    } else {
      verdict = await promptVerdict(io.prompt, subject);
      if (verdict === null) throw new ExplainedError("ABORTED", "no verdict recorded");
      const sure = await io.prompt(
        `seal ${verdict.verdict} with ${verdict.findings.length} finding(s) on ${subject.round.headSha.slice(0, 12)}? [y/N] `,
      );
      if (!sure || !/^y(es)?$/i.test(sure.trim())) throw new ExplainedError("ABORTED", "no verdict recorded");
    }
    const r = await explainApps(() =>
      a().submitHumanReview(roundId, {
        verdict: verdict!,
        headSha: subject.round.headSha,
        submissionSha256: subject.round.submissionSha256,
      }),
    );
    if (c.json) return void printJson({ type: "result", ...r });
    io.stdout.write(
      `${tagOf("sealed")}human review ${r.humanReviewId} (${verdict!.verdict}) on round ${roundId}${
        r.revealed ? `; the round is revealed: ${r.outcome}` : "; waiting for the Astra verdict"
      }\n`,
    );
  };

  program
    .command("human-ruling")
    .argument("<document>", "the escalated document id")
    .requiredOption("--ruling-file <path>", "your ruling as ruling.v1 JSON: every open material finding upheld or overruled")
    .requiredOption("--note <text>", "public note")
    .description("Rule on an escalated document yourself (D53: under fable_unavailable every conflict goes to the human)")
    .action(async (documentId: string, opts: { rulingFile: string; note: string }, cmd: Command) => {
      const c = ctx(cmd);
      let ruling: unknown;
      try {
        ruling = JSON.parse(await readFile(opts.rulingFile, "utf8"));
      } catch {
        throw new ExplainedError("VALIDATION_FAILED", `${opts.rulingFile} is not JSON`);
      }
      const parsed = Ruling.safeParse(ruling);
      if (!parsed.success)
        throw new ExplainedError(
          "VALIDATION_FAILED",
          `${opts.rulingFile} is not a ruling.v1`,
          parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
        );
      await explainApps(() => a().submitHumanRuling(documentId, { ruling: parsed.data, note: opts.note }));
      if (c.json) return void printJson({ type: "result", ok: true });
      io.stdout.write(`${tagOf("ruled")}document ${documentId}: ${parsed.data.rulings.length} finding(s)\n`);
    });

  program
    .command("resubmit")
    .argument("<dir>", "an archived failed run: <workspace>/failed/<task>/<run>/ (it holds run.json, output.json and the files)")
    .description(
      "Re-submit a failed author run's archived output without running a model: releases its lease if still active, claims the task again with the same model, posts this lease's context manifest, and submits the same files and summary (recorded as re-submitted from that run)",
    )
    .action(async (dir: string, _opts: unknown, cmd: Command) => {
      const c = ctx(cmd);
      let taskId: string;
      try {
        taskId = (JSON.parse(await readFile(`${dir.replace(/\/$/, "")}/run.json`, "utf8")) as { taskId: string }).taskId;
      } catch {
        throw new UsageError(`${dir} has no readable run.json (wos resubmit takes a <workspace>/failed/<task>/<run>/ directory)`);
      }
      finish(await o().author({ taskId, resubmitFrom: dir, signal: deps.signal }, c.printer.observe), c, { lease: "task" });
    });

  const authorCommand = (name: "roadmap" | "resolve", kinds: TaskKind[], models: ModelRef[], description: string) =>
    program
      .command(name)
      .argument("[task]", `task id (${kinds.join(" or ")}); omitted: pick from your open tasks`)
      .option("--model <model>", `model (D15): ${models.join(", ")} (or a model id such as glm-5.3); default ${models[0]}`)
      .addOption(
        new Option(
          "--provider <provider>",
          "opencode: run through your opencode CLI login (the candidate model glm on OpenCode Go; only a task a maintainer designated for it, D69)",
        ).choices(["opencode"]),
      )
      .option("--target <slug>", "only tasks for this target")
      .option("--feature <key>", "only tasks for this feature")
      .option(
        "--ensemble <n>",
        "run N shadow runs on one manifest, merge them deterministically (majority; disagreements become decisions in roadmaps/<target>/DECISIONS.md) and submit the merge (D73)",
      )
      .option(
        "--shadow",
        "run the same claim and context, validate and archive under $WOS_HOME/shadow/<task>/<run>/, then release the lease: nothing is submitted",
      )
      .description(description)
      .action(
        async (
          taskArg: string | undefined,
          raw: { target?: string; feature?: string; model?: string; provider?: "opencode"; shadow?: boolean; ensemble?: string },
          cmd: Command,
        ) => {
          const c = ctx(cmd);
          if (raw.ensemble !== undefined && (raw.shadow || !/^\d+$/.test(raw.ensemble)))
            throw new UsageError("--ensemble takes a number of runs and cannot be combined with --shadow (its runs are shadow runs)");
          const ref = raw.model === undefined ? undefined : modelRefFor(raw.model);
          if (ref === null || (ref !== undefined && !models.includes(ref)))
            throw new UsageError(
              `option '--model <model>' argument '${raw.model}' is invalid. Allowed choices are ${models.join(", ")} (or a model id such as glm-5.3).`,
            );
          const opts = { ...raw, model: ref };
          // D69: the opencode provider runs policy models whose provider is opencode_cli (glm); it declares its launch.
          const viaOpencode = raw.provider === "opencode" || (ref !== undefined && PROVIDER_OF[ref] === "opencode_cli");
          if (viaOpencode) {
            if (ref !== undefined && PROVIDER_OF[ref] !== "opencode_cli")
              throw new UsageError(
                `--provider opencode runs ${models.filter((m) => PROVIDER_OF[m] === "opencode_cli").join(", ")}, not ${ref}`,
              );
            opts.model = ref ?? models.find((m) => PROVIDER_OF[m] === "opencode_cli");
            if (!opts.model) throw new UsageError(`wos ${name} has no opencode model`);
          }
          const orchestrator = viaOpencode ? deps.orchestrator({ launch: { [opts.model!]: OPENCODE_LAUNCH } }) : o();
          let taskId = taskArg;
          if (!taskId) {
            const open: TaskView[] = [];
            for (const kind of kinds)
              open.push(...(await orchestrator.listOpenTasks({ kind, target: opts.target, feature: opts.feature })));
            // A candidate model claims only tasks designated for it (D69).
            if (viaOpencode) open.splice(0, open.length, ...open.filter((t) => t.candidateTrial?.candidate === opts.model));
            if (open.length === 0) {
              if (c.json) printJson({ type: "result", tasks: [] });
              else io.stdout.write(`no open ${kinds.join(" or ")} tasks\n`);
              return;
            }
            if (open.length > 1) {
              if (c.json) printJson({ type: "result", tasks: open });
              else io.stdout.write(tasksTable(open, c.style));
              throw new UsageError(`${open.length} open tasks: pick one, wos ${name} <task>`);
            }
            taskId = open[0]!.id;
          }
          finish(
            await orchestrator.author(
              {
                taskId,
                model: opts.model,
                ...(viaOpencode ? { launch: OPENCODE_LAUNCH } : {}),
                ...(raw.shadow ? { shadow: true } : {}),
                ...(raw.ensemble !== undefined ? { ensemble: Number(raw.ensemble) } : {}),
                signal: deps.signal,
              },
              c.printer.observe,
            ),
            c,
            { model: opts.model, lease: "task" },
          );
        },
      );

  authorCommand("roadmap", ROADMAP_KINDS, AUTHOR_MODELS, "Author a target's canonical roadmap or a Feature Contract");
  authorCommand("resolve", RESOLVE_KINDS, RESOLVER_MODELS, "Rule on an escalated dispute or architecture blocker");

  program
    .command("propose")
    .requiredOption("--target <slug>", "target the proposal is for (e.g. salesforce)")
    .option("--feature <key>", "catalog feature, when the proposal is about one")
    .requiredOption("--title <text>", "one-line title")
    .option("--body <text>", "proposal text")
    .option("--body-file <path>", "read the proposal text from a file ('-' for stdin)")
    .description("Propose a roadmap or Feature Contract change (opens a GitHub issue through wOS)")
    .action(async (opts: { target: string; feature?: string; title: string; body?: string; bodyFile?: string }, cmd: Command) => {
      const c = ctx(cmd);
      if ((opts.body === undefined) === (opts.bodyFile === undefined))
        throw new UsageError("propose needs exactly one of --body or --body-file");
      const body = opts.bodyFile === undefined ? opts.body! : await readBody(opts.bodyFile, io);
      if (!body.trim()) throw new UsageError("the proposal body is empty");
      const r = await o().propose({ target: opts.target, feature: opts.feature ?? null, title: opts.title, body });
      if (c.json) printJson({ type: "result", ...r });
      else io.stdout.write(`proposed ${r.issueUrl}\n`);
    });

  program
    .command("resume")
    .description("Re-attach to every attempt this machine drives (after a restart or --detach)")
    .action(async (_opts: unknown, cmd: Command) => {
      const c = ctx(cmd);
      const results = await o().resume(c.printer.observe);
      if (results.length === 0 && !c.json) io.stdout.write("nothing to resume\n");
      for (const r of results) {
        if (c.json) printJson({ type: "result", result: r });
        else io.stdout.write(`${describeResult(r)}\n`);
      }
      const failed = results.find((r) => !r.ok);
      if (failed && !failed.ok) throw new Exit(exitCodeFor(failed.code));
    });

  program
    .command("release")
    .argument("<lease>", "lease id (see wos work)")
    .option("--reason <text>", "why you are giving it back", "released by the contributor")
    .description("Give a lease back and remove its worktree")
    .action(async (lease: string, opts: { reason: string }, cmd: Command) => {
      const c = ctx(cmd);
      await o().release(lease, opts.reason);
      if (c.json) printJson({ type: "result", released: lease });
      else io.stdout.write(`released ${lease}\n`);
    });

  // ------------------------------------------------------------------------------ reads

  program
    .command("abus")
    .argument("<target>", "target slug, e.g. salesforce")
    .argument("<feature>", "catalog feature key, e.g. contacts")
    .description("List a feature's ABUs and whether you can claim them now")
    .action(async (target: string, feature: string, _opts: unknown, cmd: Command) => {
      const c = ctx(cmd);
      const items = await o().listClaimableAbus(target, feature);
      if (c.json) return void printJson({ type: "result", abus: items });
      if (items.length === 0) return void io.stdout.write("no ABUs\n");
      io.stdout.write(
        table(
          ["ABU", "STATE", "SIZE", "CLAIMABLE", "ID", "TITLE"],
          items.map((a) => [`${target}/${a.key}`, a.state, String(a.sizePoints), a.claimable ? "yes" : "no", a.id, a.title]),
          c.style,
        ),
      );
    });

  program
    .command("tasks")
    .addOption(new Option("--kind <kind>", "task kind").choices(TaskKind.options))
    .option("--target <slug>", "only this target")
    .option("--feature <key>", "only this feature")
    .description("List open tasks you could take")
    .action(async (opts: { kind?: TaskKind; target?: string; feature?: string }, cmd: Command) => {
      const c = ctx(cmd);
      const items = await o().listOpenTasks({ kind: opts.kind, target: opts.target, feature: opts.feature });
      if (c.json) return void printJson({ type: "result", tasks: items });
      io.stdout.write(items.length ? tasksTable(items, c.style) : "no open tasks\n");
    });

  program
    .command("work")
    .description("Your leases, tasks and attempts")
    .action(async (_opts: unknown, cmd: Command) => {
      const c = ctx(cmd);
      const w = await o().myWork();
      if (c.json) return void printJson({ type: "result", ...w });
      const rows = [
        ...w.leases.map((l) => ["lease", l.state, l.id, `task ${l.taskId}, expires ${l.expiresAt}`]),
        ...w.tasks.map((t) => ["task", t.state, t.id, `${t.kind} ${subject(t)}`]),
        ...w.attempts.map((a) => ["attempt", a.state, a.id, `${a.abu}${a.pr ? ` PR #${a.pr.number} ${a.pr.url}` : ""}`]),
      ];
      io.stdout.write(rows.length ? table(["KIND", "STATE", "ID", "DETAIL"], rows, c.style) : "no work\n");
    });

  program
    .command("events")
    .option("--after <id>", "only events after this id", (v) => {
      if (!/^\d+$/.test(v)) throw new UsageError("--after takes an event id (a whole number)");
      return Number(v);
    })
    .description("Your recent events")
    .action(async (opts: { after?: number }, cmd: Command) => {
      const c = ctx(cmd);
      const r = await o().events(opts.after);
      if (c.json) return void printJson({ type: "result", ...r });
      if (r.items.length === 0) return void io.stdout.write(`no events (last id ${r.lastId})\n`);
      io.stdout.write(
        table(
          ["ID", "AT", "TYPE", "SUBJECT"],
          r.items.map((e) => [String(e.id), e.occurredAt, e.type, `${e.aggregateKind} ${e.aggregateId}`]),
          c.style,
        ),
      );
    });

  // ------------------------------------------------------------------------------ organizations and apps (AppRoutes)

  program
    .command("orgs")
    .description("Your organizations and your role in each (the personal one first)")
    .action(async (_opts: unknown, cmd: Command) => {
      const c = ctx(cmd);
      const orgs = await explainApps(() => a().listMyOrganizations());
      if (c.json) return void printJson({ type: "result", organizations: orgs });
      if (orgs.length === 0) return void io.stdout.write("no organizations\n");
      io.stdout.write(
        table(
          ["ORG", "KIND", "ROLE", "ID", "NAME"],
          orgs.map((g) => [g.slug, g.kind, g.role, g.id, g.name]),
          c.style,
        ),
      );
    });

  const orgOption = () => new Option("--org <slug>", "organization (default: your personal one; see wos orgs)");

  const apps = program
    .command("apps")
    .addOption(orgOption())
    .description("Your organization's apps: enabled, and available to enable")
    .action(async (opts: { org?: string }, cmd: Command) => {
      const c = ctx(cmd);
      const org = await resolveOrg(a(), opts.org);
      const list = await explainApps(() => a().listOrgApps(org.id));
      if (c.json) return void printJson({ type: "result", organization: org, ...list });
      io.stdout.write(`${tagOf("org")}${describeOrg(org)}\n`);
      const rows = [
        ...list.yourApps.map((v) => appRow(v, v.app.kind === "app" ? v.entitlement.state : "included")),
        ...list.availableApps.map((v) => appRow(v, v.entitlement.state)),
      ];
      io.stdout.write(rows.length ? table(["APP", "KIND", "STATE", "VERSION", "NAME"], rows, c.style) : "no apps in the registry\n");
      // Contract (AppRegistryEntry doc): an app with no published release is absent from OrgApps; its entitlement still gates.
      const listed = new Set(rows.map((r) => r[0]));
      if (!listed.has(BUILD_APP_ID))
        io.stdout.write(`${tagOf("note")}${BUILD_APP_ID} is not listed: the registry has no ${APP_LABEL[BUILD_APP_ID]} release yet\n`);
    });

  const change = (event: "enable" | "disable") =>
    apps
      .command(event)
      .argument("<app>", "app id, e.g. build or crm")
      .addOption(orgOption())
      .description(
        event === "enable"
          ? "Enable an app for the organization (owner or admin)"
          : "Disable an app for the organization (owner or admin); its data is kept",
      )
      .action(async (app: string, opts: { org?: string }, cmd: Command) => {
        const c = ctx(cmd);
        const slug = opts.org ?? (cmd.parent?.opts() as { org?: string } | undefined)?.org;
        const org = await resolveOrg(a(), slug);
        const orgFlag = org.kind === "personal" && slug === undefined ? "" : ` --org ${org.slug}`;
        const list = await explainApps(() => a().listOrgApps(org.id));
        const seen = [...list.yourApps, ...list.availableApps].find((v) => v.app.id === app) ?? null;
        const target = event === "enable" ? "enabled" : "disabled";
        const already = (state: string) => {
          if (c.json) printJson({ type: "result", organization: org, changed: false, state });
          else io.stdout.write(`${tagOf("unchanged")}${app} is ${state === target ? "already " : ""}${state} on ${describeOrg(org)}\n`);
        };
        if (seen && seen.app.kind === "app" && seen.entitlement.state === target) return already(target);
        if (event === "disable" && seen && seen.app.kind === "app" && seen.entitlement.state === "available") return already("not enabled");
        // "available" is the absence of a row: the server expects null then (EntitlementBody.expectedRowVersion).
        const expected = seen && seen.entitlement.changedAt !== null ? seen.entitlement.rowVersion : null;
        let view: Awaited<ReturnType<AppsApi["enableApp"]>>;
        try {
          view = await (event === "enable" ? a().enableApp(org.id, app, expected) : a().disableApp(org.id, app, expected));
        } catch (e) {
          if (e instanceof AppsCallError && e.code === "CONFLICT") {
            const current = (e.details as { current?: { state?: string; rowVersion?: number } } | undefined)?.current;
            if (current?.state === target) return already(target);
          }
          throw explainChange(e, { event, app, org, orgFlag, listed: seen !== null });
        }
        if (c.json) return void printJson({ type: "result", organization: org, changed: true, ...view });
        const note = event === "disable" ? " (its data is kept; hosted surfaces hide it)" : "";
        io.stdout.write(`${tagOf(target)}${app} on ${describeOrg(org)}${note}\n`);
      });
  change("enable");
  change("disable");

  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (e) {
    exitCode = handleError(e, io, argv.includes("--json"));
  }
  return exitCode;
}

function handleError(e: unknown, io: CliIo, json: boolean): number {
  if (e instanceof Exit) return e.exitCode;
  if (e instanceof CommanderError) {
    if (e.code === "commander.helpDisplayed" || e.code === "commander.version" || e.code === "commander.help") return EXIT.ok;
    return EXIT.usage; // commander already printed the message
  }
  if (e instanceof UsageError) {
    io.stderr.write(`wos: ${e.message}\n`);
    return EXIT.usage;
  }
  if (e instanceof ExplainedError) {
    if (json)
      io.stdout.write(
        `${JSON.stringify({ type: "error", code: e.code, message: e.message, server: e.server, hints: e.hints, recoverable: false })}\n`,
      );
    else {
      io.stderr.write(`error    ${e.code}: ${e.message}\n`);
      if (e.server && e.server.message !== e.message) io.stderr.write(`server   ${e.server.message}\n`);
      for (const h of e.hints) io.stderr.write(`hint     ${h}\n`);
    }
    return exitCodeFor(e.code);
  }
  const code = typeof (e as { code?: unknown })?.code === "string" ? (e as { code: string }).code : "INTERNAL";
  const message = e instanceof Error ? e.message : String(e);
  if (json) io.stdout.write(`${JSON.stringify({ type: "error", code, message, recoverable: false })}\n`);
  else {
    io.stderr.write(`error    ${code}: ${message}\n`);
    const h = hintFor(code, message);
    if (h) io.stderr.write(`hint     ${h}\n`);
  }
  return exitCodeFor(code);
}

// ------------------------------------------------------------------------------ apps helpers

const tagOf = (s: string) => (s.length >= 9 ? `${s} ` : s.padEnd(9));

interface OrgRef {
  id: string;
  slug: string;
  name: string;
  kind: "personal" | "team";
  role: string;
}

const describeOrg = (g: OrgRef) => `${g.slug} (${g.kind}, ${g.role})`;

function appRow(v: { app: { id: string; kind: string; name: string; currentVersion: string } }, state: string): string[] {
  return [v.app.id, v.app.kind, state, v.app.currentVersion, v.app.name];
}

/** Runs an AppRoutes call and turns its failure into a plain explanation. */
async function explainApps<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    throw explainCall(e);
  }
}

function explainCall(e: unknown): unknown {
  if (!(e instanceof AppsCallError)) return e;
  const server = { message: e.message, details: e.details };
  const hint = hintFor(e.code, e.message);
  return new ExplainedError(e.code, e.message, hint ? [hint] : [], server);
}

/** The personal organization by default (listed first, `kind: "personal"`), else the one named by --org. */
async function resolveOrg(api: AppsApi, slug: string | undefined): Promise<OrgRef> {
  const orgs = await explainApps(() => api.listMyOrganizations());
  const org = slug === undefined ? orgs.find((g) => g.kind === "personal") : orgs.find((g) => g.slug === slug);
  if (org) return org;
  if (slug === undefined)
    throw new ExplainedError("NOT_FOUND", "your account has no personal organization", ["see wos orgs; pass --org <slug>"]);
  const known = orgs.map((g) => g.slug).join(", ") || "none";
  throw new ExplainedError("NOT_FOUND", `you are not a member of an organization named ${slug}`, [
    `your organizations: ${known} (wos orgs)`,
  ]);
}

function explainChange(
  e: unknown,
  x: { event: "enable" | "disable"; app: string; org: OrgRef; orgFlag: string; listed: boolean },
): unknown {
  if (!(e instanceof AppsCallError)) return e;
  const server = { message: e.message, details: e.details };
  const label = APP_LABEL[x.app] ?? x.app;
  const on = x.org.slug;
  switch (e.code) {
    case "NOT_FOUND":
      // The organization was just resolved from listMyOrganizations, so NOT_FOUND here is about the app. The server
      // says so ("app <id> has no published release"); an app missing from listOrgApps confirms it.
      if (/no published release/.test(e.serverMessage) || !x.listed)
        return new ExplainedError(
          "NOT_FOUND",
          `${label} isn't available to ${x.event} yet (registry has no ${label} release)`,
          [
            x.app === BUILD_APP_ID
              ? `nothing to fix on your side: once a maintainer publishes ${label}'s release, run wos apps enable ${x.app}${x.orgFlag} again`
              : `check the id with wos apps${x.orgFlag}`,
          ],
          server,
        );
      break;
    case "FORBIDDEN":
      return new ExplainedError(
        "FORBIDDEN",
        `only an owner or admin of ${on} can ${x.event} apps; your role there is ${x.org.role}`,
        ["ask an owner of the organization, or use your personal one (omit --org)"],
        server,
      );
    case "DEPENDENCY_NOT_ENABLED": {
      const missing = arrayOf((e.details as { missing?: unknown } | undefined)?.missing);
      const enable = missing.map((m) => /^(\S+) is not enabled$/.exec(m)?.[1]).filter((id): id is string => !!id);
      return new ExplainedError(
        e.code,
        `${x.app} needs apps that are not enabled on ${on}: ${missing.join("; ") || e.serverMessage}`,
        [...enable.map((id) => `enable it first: wos apps enable ${id}${x.orgFlag}`), `then: wos apps enable ${x.app}${x.orgFlag}`],
        server,
      );
    }
    case "DEPENDENT_ENABLED": {
      const dependents = arrayOf((e.details as { dependents?: unknown } | undefined)?.dependents);
      return new ExplainedError(
        e.code,
        `other apps on ${on} require ${x.app}: ${dependents.join(", ") || e.serverMessage}`,
        [...dependents.map((id) => `disable it first: wos apps disable ${id}${x.orgFlag}`), `then: wos apps disable ${x.app}${x.orgFlag}`],
        server,
      );
    }
    case "CONFLICT": {
      const current = (e.details as { current?: { state?: string; rowVersion?: number } } | undefined)?.current;
      const now = current?.state ? `; it is now ${current.state}` : "";
      if (current?.state === "suspended")
        return new ExplainedError(
          e.code,
          `${x.app} is suspended on ${on}; it cannot be ${x.event}d until the maintainers resume it`,
          [],
          server,
        );
      return new ExplainedError(
        e.code,
        `${x.app} changed on ${on} while this command ran${now}`,
        [`check it with wos apps${x.orgFlag}, then decide and run the command again`],
        server,
      );
    }
  }
  return explainCall(e);
}

const arrayOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

function codeError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

async function readBody(path: string, io: CliIo): Promise<string> {
  if (path !== "-") return readFile(path, "utf8");
  const lines: string[] = [];
  for (;;) {
    const l = await io.prompt("");
    if (l === null) return lines.join("\n");
    lines.push(l);
  }
}

function subject(t: TaskView): string {
  return t.abu ?? t.feature ?? t.target ?? "";
}

function tasksTable(items: TaskView[], style: Style): string {
  return table(
    ["TASK", "KIND", "SUBJECT", "SLOT", "CREATED"],
    items.map((t) => [t.id, t.kind, subject(t), t.reviewerSlot ?? "-", t.createdAt]),
    style,
  );
}
