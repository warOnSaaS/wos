/**
 * Lint for GitHub Actions workflows of the PRODUCT repo (S-20: CI holds no secrets). Takes the raw text
 * and the parsed YAML (callers parse; this package has no YAML dependency) and reports every way the
 * workflow could hand candidate code something of value or run it with privileges.
 */
export interface WorkflowLintIssue {
  rule: string;
  message: string;
}

const PRIVILEGED_TRIGGERS = [
  "pull_request_target",
  "workflow_run",
  "issue_comment",
  "workflow_dispatch",
  "repository_dispatch",
  "schedule",
];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function readOnlyPermissions(p: unknown): boolean {
  return isRecord(p) && Object.keys(p).length === 1 && p.contents === "read";
}

export function lintProductWorkflow(_raw: string, parsed: unknown, opts: { requireVerifyTriggers?: boolean } = {}): WorkflowLintIssue[] {
  const issues: WorkflowLintIssue[] = [];
  const add = (rule: string, message: string) => issues.push({ rule, message });

  if (!isRecord(parsed)) {
    add("shape", "workflow is not a mapping");
    return issues;
  }
  if (!readOnlyPermissions(parsed.permissions)) add("permissions", "top-level permissions must be exactly { contents: read }");

  // YAML 1.1 parsers read the key `on` as boolean true; accept both.
  const on = parsed.on ?? (parsed as Record<string, unknown>).true;
  const triggers =
    typeof on === "string" ? { [on]: null } : Array.isArray(on) ? Object.fromEntries(on.map((t) => [t, null])) : isRecord(on) ? on : {};
  for (const t of PRIVILEGED_TRIGGERS)
    if (t in triggers) add("triggers", `trigger ${t} runs with repository privileges or outside the gate`);
  if (opts.requireVerifyTriggers) {
    const push = triggers.push;
    const branches = isRecord(push) && Array.isArray(push.branches) ? push.branches : [];
    if (!branches.includes("wos/candidate/**")) add("triggers", "must run on push to wos/candidate/**");
    if (!("pull_request" in triggers)) add("triggers", "must run on pull_request");
    if (!("merge_group" in triggers)) add("triggers", "must run on merge_group");
  }

  // S-35: a RELEASE workflow runs only on pushed tags (never on candidate pushes, PRs or the merge queue),
  // and only its jobs in the protected `release` environment may read secrets. Everything else: none.
  const push = triggers.push;
  const releaseOnly =
    Object.keys(triggers).length === 1 &&
    isRecord(push) &&
    Array.isArray(push.tags) &&
    push.tags.length > 0 &&
    !("branches" in push) &&
    !("branches-ignore" in push);
  const expressions = (v: unknown): string[] => [...JSON.stringify(v ?? null).matchAll(/\$\{\{([\s\S]*?)\}\}/g)].map((m) => m[1] ?? "");
  const scan = (where: string, v: unknown, secretsAllowed: boolean) => {
    for (const e of expressions(v)) {
      if (/\bsecrets\b/.test(e) && !secretsAllowed) add("no-secrets", `${where} references the secrets context: \${{${e}}}`);
      if (/\bgithub\.token\b/.test(e)) add("no-token", `${where} hands the job token to a step: \${{${e}}}`);
    }
  };
  const { jobs: jobsValue, ...rest } = parsed;
  scan("workflow", rest, false);

  const jobs = isRecord(jobsValue) ? jobsValue : {};
  if (Object.keys(jobs).length === 0) add("shape", "no jobs");
  for (const [name, job] of Object.entries(jobs)) {
    if (!isRecord(job)) continue;
    if ("permissions" in job && !readOnlyPermissions(job.permissions)) add("permissions", `job ${name} widens permissions`);
    const env = isRecord(job.environment) ? job.environment.name : job.environment;
    const isRelease = env === "release" && releaseOnly;
    if ("environment" in job && !isRelease) {
      add(
        "environment",
        env === "release"
          ? `job ${name} uses the release environment in a workflow that is not tag-only (candidate code could reach it)`
          : `job ${name} uses an environment other than release (environments can hold secrets)`,
      );
    }
    scan(`job ${name}`, job, isRelease);
    const runsOn = JSON.stringify(job["runs-on"] ?? "");
    if (/macos/i.test(runsOn) && !/runner == 'macos'/.test(runsOn)) {
      add("runner", `job ${name} runs on macOS unconditionally; macOS runners are only for native iOS acceptance (runner == 'macos')`);
    }
    if ("secrets" in job) add("no-secrets", `job ${name} passes secrets to a reusable workflow`);
    const steps = Array.isArray(job.steps) ? job.steps : [];
    for (const step of steps) {
      if (!isRecord(step) || typeof step.uses !== "string") continue;
      const uses = step.uses;
      const [ref, version = ""] = uses.split("@");
      if (uses.startsWith("./")) add("uses", `job ${name} runs a local action ${uses}, which a submission could change`);
      else if (!ref?.startsWith("actions/") && !/^[0-9a-f]{40}$/.test(version))
        add("uses", `third-party action ${uses} must be pinned to a commit sha`);
      if (ref === "actions/checkout") {
        const withs = isRecord(step.with) ? step.with : {};
        if (withs["persist-credentials"] !== false) add("checkout", `job ${name}: actions/checkout must set persist-credentials: false`);
      }
    }
  }
  return issues;
}
