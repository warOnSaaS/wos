/**
 * A fresh, fully migrated database per test file on the Postgres at WOS_VERIFY_DATABASE_URL (an admin URL:
 * the Docker container locally, the service container in CI). Migrations are applied exactly as
 * packages/db/scripts/test-migrations.sh does (one transaction per file). Dropped afterwards.
 *
 * WOS_VERIFY_MUTATION_SQL (optional) runs after the migrations: it is how a control is removed on purpose
 * to prove its tests turn red (mutation check), never set in CI.
 */
import { createPublicKey, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ed25519PrivateKeyFromSeed, encodeDevicePublicKey } from "@waronsaas/contracts/canonical";
import postgres from "postgres";
import { REPO_ROOT } from "../../../packages/verification/test/support/git-fixture.js";

export const ADMIN_URL = process.env.WOS_VERIFY_DATABASE_URL ?? "";
export const DB_REASON = ADMIN_URL ? "" : " [PENDING: set WOS_VERIFY_DATABASE_URL to an admin Postgres URL; CI job adversarial-db sets it]";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;
export const SUITE_REPO = "waronsaas/product";
export const PLATFORM_REPO_NAME = "waronsaas/wos";

export async function freshDatabase(): Promise<{ sql: Sql; url: string; drop: () => Promise<void> }> {
  const name = `wos_adv_${randomBytes(6).toString("hex")}`;
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });
  await admin.unsafe(`create database ${name}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const sql = postgres(url.toString(), { max: 25, onnotice: () => undefined });
  const dir = join(REPO_ROOT, "packages/db/migrations");
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    const text = readFileSync(join(dir, f), "utf8");
    await sql.begin((tx) => tx.unsafe(text));
  }
  const mutation = process.env.WOS_VERIFY_MUTATION_SQL;
  if (mutation) await sql.begin((tx) => tx.unsafe(mutation));
  return {
    sql,
    url: url.toString(),
    drop: async () => {
      await sql.end({ timeout: 5 });
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end({ timeout: 5 });
    },
  };
}

/** Runs fn as the app role with the given actor, exactly like a control-plane request handler. */
export function asActor<T>(
  sql: Sql,
  kind: "contributor" | "maintainer" | "system" | "anonymous",
  accountId: string | null,
  fn: (tx: Tx) => Promise<T>,
) {
  return sql.begin(async (tx) => {
    await tx`set local role wos_app`;
    await tx`select set_config('wos.actor_kind', ${kind}, true), set_config('wos.actor_id', ${accountId ?? ""}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

/** Resolves to the error message when the statement fails, or null when it succeeds. */
export async function failure(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export const id = (n: number) => `00000000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
export const HEAD = "c".repeat(40);
export const HASH = `sha256:${"4".repeat(64)}`;
export const devicePublicKey = (seed: number) => encodeDevicePublicKey(createPublicKey(ed25519PrivateKeyFromSeed(Buffer.alloc(32, seed))));

export type Slot = "astra" | "fable";
export interface OpenRound {
  round: string;
  attempt: string;
  abu: string;
  tasks: Record<Slot, string>;
}
export interface ReviewLease {
  task: string;
  account: string;
  lease: string;
  manifest: string;
  run: string;
}

/**
 * The pipeline fixture. Accounts alice, bob, carol, dave, erin are contributors; `founder` holds the
 * maintainer role. Each round is a fresh implementation attempt in review with its own two review tasks;
 * each review lease comes with its own context manifest and a signed agent run, exactly as the control
 * plane records them, so the only thing an attack changes is the binding it is attacking.
 */
export class Pipeline {
  readonly A = { alice: id(1), bob: id(2), carol: id(3), dave: id(4), erin: id(5), founder: id(6) };
  private n = 1000;
  private abuN = 0;
  constructor(private readonly sql: Sql) {}

  private next() {
    this.n += 1;
    return id(this.n);
  }
  device(account: string) {
    return id(100 + Object.values(this.A).indexOf(account));
  }

  async seed() {
    const sql = this.sql;
    for (const [i, [handle, acc]] of Object.entries(this.A).entries()) {
      await sql`insert into wos.accounts (id, handle, github_user_id, github_login, github_created_at, github_linked_at)
                values (${acc}, ${handle}, ${2000 + i}, ${handle}, now() - interval '400 days', now())`;
      await sql`insert into wos.account_emails (account_id, email, email_normalized, verified_at) values (${acc}, ${`${handle}@example.com`}, ${`${handle}@example.com`}, now())`;
      await sql`insert into wos.devices (id, account_id, name, client_kind, public_key) values (${this.device(acc)}, ${acc}, 'mac', 'cli', ${devicePublicKey(i + 1)})`;
    }
    await sql`insert into wos.account_roles (account_id, role) values (${this.A.founder}, 'maintainer')`;
    const [sf] = await sql`select id from wos.targets where slug = 'salesforce'`;
    await sql`insert into wos.documents (id, kind, target_id, version, state, branch, repo_full_name) values (${id(200)}, 'roadmap', ${sf!.id}, 1, 'drafting', 'wos/roadmap/salesforce/v1', ${SUITE_REPO})`;
    await sql`insert into wos.catalog_features (id, key, title, summary, state, created_by_document_id, repo_full_name) values (${id(201)}, 'contacts', 'Contacts', 'People and companies', 'active', ${id(200)}, ${SUITE_REPO})`;
    await sql`insert into wos.documents (id, kind, catalog_feature_id, version, state, branch, repo_full_name) values (${id(202)}, 'feature_contract', ${id(201)}, 1, 'consensus', 'wos/feature/contacts/v1', ${SUITE_REPO})`;
    return this;
  }

  async abu(write: string[] = ["modules/contacts/**"], state = "ready") {
    this.abuN += 1;
    const abu = this.next();
    await this
      .sql`insert into wos.abus (id, catalog_feature_id, document_id, key, title, size_points, state, spec, est_context_tokens, repo_full_name)
                   values (${abu}, ${id(201)}, ${id(202)}, ${`contacts#${String(this.abuN).padStart(2, "0")}`}, 'unit', 1, ${state},
                           ${this.sql.json({ scope: { write } })}, 1000, ${SUITE_REPO})`;
    return abu;
  }

  /** A builder's attempt in review: round 1 awaiting reviews, with its astra and fable review tasks. */
  async openRound(builder: string, head = HEAD, hash = HASH): Promise<OpenRound> {
    const abu = await this.abu(undefined, "in_progress");
    const attempt = this.next();
    const round = this.next();
    await this
      .sql`insert into wos.attempts (id, abu_id, account_id, github_user_id, state, base_sha, head_sha) values (${attempt}, ${abu}, ${builder}, 1, 'in_review', ${"a".repeat(40)}, ${head})`;
    await this
      .sql`insert into wos.rounds (id, subject_kind, attempt_id, round_number, head_sha, submission_sha256, state) values (${round}, 'implementation', ${attempt}, 1, ${head}, ${hash}, 'awaiting_reviews')`;
    const tasks = { astra: this.next(), fable: this.next() };
    for (const slot of ["astra", "fable"] as const) {
      await this.sql`insert into wos.tasks (id, kind, state, role, reviewer_slot, catalog_feature_id, attempt_id, round_id)
                     values (${tasks[slot]}, 'implementation_review', 'leased', ${`implementation_reviewer_${slot}`}, ${slot}, ${id(201)}, ${attempt}, ${round})`;
    }
    return { round, attempt, abu, tasks };
  }

  /** Active lease on a review task + its accepted manifest + a signed agent run. */
  async reviewLease(task: string, account: string, opts: { signatureValid?: boolean } = {}): Promise<ReviewLease> {
    const lease = this.next();
    const manifest = this.next();
    const run = this.next();
    await this.sql`insert into wos.leases (id, task_id, account_id, device_id, state, context_plan, expires_at, hard_deadline_at)
                   values (${lease}, ${task}, ${account}, ${this.device(account)}, 'active', '{}', now() + interval '30 minutes', now() + interval '3 hours')`;
    await this
      .sql`insert into wos.context_manifests (id, lease_id, task_id, account_id, role, model_id, reasoning, context_format_version, manifest, manifest_sha256)
                   values (${manifest}, ${lease}, ${task}, ${account}, 'implementation_reviewer', 'm', 'max', 'ctx-1', '{}', ${`sha256:${manifest.replace(/-/g, "").padStart(64, "0")}`})`;
    await this.sql`insert into wos.agent_runs (id, lease_id, manifest_id, account_id, device_id, record, signature_valid)
                   values (${run}, ${lease}, ${manifest}, ${account}, ${this.device(account)}, '{}', ${opts.signatureValid ?? true})`;
    return { task, account, lease, manifest, run };
  }

  /**
   * An agent-run row forged to satisfy the 0003 run check for an arbitrary (lease, manifest, account), so a
   * test can reach exactly the 0002 binding clause it attacks (triggers fire in name order).
   */
  async forgeRun(lease: string, manifest: string, account: string) {
    const run = this.next();
    await this.sql`insert into wos.agent_runs (id, lease_id, manifest_id, account_id, device_id, record, signature_valid)
                   values (${run}, ${lease}, ${manifest}, ${account}, ${this.device(account)}, '{}', true)`;
    return run;
  }

  /** Inserts a review from the given bundle; `over` changes exactly the fields an attack forges. */
  review(
    round: string,
    slot: Slot,
    b: ReviewLease,
    over: Partial<{
      account: string;
      task: string;
      lease: string;
      manifest: string;
      run: string;
      head: string;
      hash: string;
      independence: string;
      verdict: string;
    }> = {},
    sql: Sql | Tx = this.sql,
  ) {
    const r = { ...b, ...over };
    return sql`insert into wos.reviews (round_id, task_id, lease_id, account_id, github_user_id, slot, provider, model_id, reasoning,
                                        head_sha, submission_sha256, verdict, body, manifest_id, independence, agent_run_id)
               values (${round}, ${r.task}, ${r.lease}, ${r.account}, 1, ${slot}, ${slot === "astra" ? "codex_cli" : "claude_cli"}, 'm', 'max',
                       ${over.head ?? HEAD}, ${over.hash ?? HASH}, ${over.verdict ?? "NO_MATERIAL_GAPS"}, '{}', ${r.manifest},
                       ${over.independence ?? "independent"}, ${r.run})
               returning id`;
  }
}
