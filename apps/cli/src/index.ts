#!/usr/bin/env node
/**
 * wOS CLI (`wos`, npm package @waronsaas/cli; owner: cli workstream).
 * A thin shell over @waronsaas/orchestrator — it must not contain workflow logic of its own.
 */
import { Command } from "commander";
import { CONTRACTS_VERSION } from "@waronsaas/contracts";

const program = new Command();
program.name("wos").description("wOS: build warOnSaaS with your own AI coding agents").version(`0.0.0 (contracts ${CONTRACTS_VERSION})`);

const stub = (name: string) => () => {
  process.stderr.write(`wos ${name}: not implemented yet\n`);
  process.exitCode = 2;
};

program.command("login").description("Sign in with your email (a code is emailed to you)").action(stub("login"));
program.command("link-github").description("Link your GitHub account (required to contribute)").action(stub("link-github"));
program.command("logout").description("Sign out on this machine").action(stub("logout"));
program.command("status").description("Check sign-in, git, Claude Code and Codex CLI readiness; show active work").action(stub("status"));
program
  .command("build")
  .argument("<abu>", "ABU id or <target>/<abu-key>")
  .description("LEASE -> BUILD -> VERIFY -> REVIEW -> QUALIFY -> PR")
  .action(stub("build"));
program
  .command("review")
  .option("--slot <slot>", "astra | fable")
  .description("Take the next assigned review for your eligible slot")
  .action(stub("review"));
program
  .command("roadmap")
  .argument("[task]", "roadmap_author task id")
  .description("Work the canonical roadmap for a target")
  .action(stub("roadmap"));
program.command("propose").description("Propose a roadmap or contract change (opens a GitHub Issue)").action(stub("propose"));
program
  .command("resolve")
  .argument("[task]", "conflict_resolution task id")
  .description("Resolve an escalated dispute or architecture blocker")
  .action(stub("resolve"));

await program.parseAsync(process.argv);
