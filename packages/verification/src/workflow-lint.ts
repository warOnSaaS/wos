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

export function lintProductWorkflow(raw: string, parsed: unknown, opts: { requireVerifyTriggers?: boolean } = {}): WorkflowLintIssue[] {
  const issues: WorkflowLintIssue[] = [];
  const add = (rule: string, message: string) => issues.push({ rule, message });

  // Any reference to the secrets context, including secrets["X"], toJSON(secrets) and `secrets: inherit`.
  if (/\bsecrets\s*(?:\.|\[|\))|secrets\s*:\s*inherit/.test(raw)) add("no-secrets", "references the secrets context");
  if (/\bgithub\.token\b|\bGITHUB_TOKEN\b/.test(raw)) add("no-token", "passes the job token to steps");

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

  const jobs = isRecord(parsed.jobs) ? parsed.jobs : {};
  if (Object.keys(jobs).length === 0) add("shape", "no jobs");
  for (const [name, job] of Object.entries(jobs)) {
    if (!isRecord(job)) continue;
    if ("permissions" in job && !readOnlyPermissions(job.permissions)) add("permissions", `job ${name} widens permissions`);
    if ("environment" in job) add("environment", `job ${name} uses an environment (environments can hold secrets)`);
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
