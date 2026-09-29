/**
 * A fresh, fully migrated database per test file on the Postgres at WOS_VERIFY_DATABASE_URL (an admin URL:
 * the Docker container locally, the service container in CI). Migrations are applied exactly as
 * packages/db/scripts/test-migrations.sh does (one transaction per file). Dropped afterwards.
 */
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { REPO_ROOT } from "../../support/git-fixture.js";

export const ADMIN_URL = process.env.WOS_VERIFY_DATABASE_URL ?? "";
export const DB_REASON = ADMIN_URL ? "" : " [PENDING: set WOS_VERIFY_DATABASE_URL to an admin Postgres URL; CI job adversarial-db sets it]";

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

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

/**
 * Fixture: alice (builder) holds a live attempt on contacts#01 whose candidate is in review round 1;
 * bob holds the astra review lease, carol the fable review lease; dave is uninvolved. A second attempt
 * (erin's, on contacts#02) has its own open round with the SAME head and diff hash, for binding attacks.
 */
export async function seedPipeline(sql: Sql) {
  const A = { alice: id(1), bob: id(2), carol: id(3), dave: id(4), erin: id(5) };
  const accounts = Object.entries(A);
  for (const [i, [handle, acc]] of accounts.entries()) {
    await sql`insert into wos.accounts (id, handle, github_user_id, github_login, github_created_at, github_linked_at)
              values (${acc}, ${handle}, ${2000 + i}, ${handle}, now() - interval '400 days', now())`;
    await sql`insert into wos.account_emails (account_id, email, email_normalized, verified_at) values (${acc}, ${`${handle}@example.com`}, ${`${handle}@example.com`}, now())`;
    await sql`insert into wos.devices (id, account_id, name, client_kind, public_key) values (${id(100 + i)}, ${acc}, 'mac', 'cli', ${`pk-${handle}`})`;
  }
  const dev = (acc: string) => id(100 + accounts.findIndex(([, a]) => a === acc));
  const [sf] = await sql`select id from wos.targets where slug = 'salesforce'`;
  await sql`insert into wos.documents (id, kind, target_id, version, state, branch) values (${id(200)}, 'roadmap', ${sf!.id}, 1, 'drafting', 'wos/roadmap/salesforce/v1')`;
  await sql`insert into wos.catalog_features (id, key, title, summary, state, created_by_document_id) values (${id(201)}, 'contacts', 'Contacts', 'People and companies', 'active', ${id(200)})`;
  await sql`insert into wos.documents (id, kind, catalog_feature_id, version, state, branch) values (${id(202)}, 'feature_contract', ${id(201)}, 1, 'consensus', 'wos/feature/contacts/v1')`;

  const abu = async (n: number, write: string[]) => {
    await sql`insert into wos.abus (id, catalog_feature_id, document_id, key, title, size_points, state, spec, est_context_tokens)
              values (${id(300 + n)}, ${id(201)}, ${id(202)}, ${`contacts#${String(n).padStart(2, "0")}`}, 'unit', 1, 'ready',
                      ${sql.json({ scope: { write } })}, 1000)`;
    await sql`insert into wos.tasks (id, kind, state, role, catalog_feature_id, abu_id) values (${id(400 + n)}, 'abu_build', 'open', 'builder', ${id(201)}, ${id(300 + n)})`;
  };
  await abu(1, ["modules/contacts/list/**"]);
  await abu(2, ["modules/contacts/detail/**"]);

  const review = async (attempt: string, abuN: number, builder: string, roundId: string, base: number) => {
    await sql`insert into wos.attempts (id, abu_id, account_id, github_user_id, state, base_sha, head_sha) values (${attempt}, ${id(300 + abuN)}, ${builder}, 1, 'in_review', ${"a".repeat(40)}, ${HEAD})`;
    await sql`insert into wos.rounds (id, subject_kind, attempt_id, round_number, head_sha, submission_sha256, state) values (${roundId}, 'implementation', ${attempt}, 1, ${HEAD}, ${HASH}, 'awaiting_reviews')`;
    for (const [k, slot] of (["astra", "fable"] as const).entries()) {
      await sql`insert into wos.tasks (id, kind, state, role, reviewer_slot, catalog_feature_id, attempt_id, round_id)
                values (${id(base + k)}, 'implementation_review', 'leased', ${`implementation_reviewer_${slot}`}, ${slot}, ${id(201)}, ${attempt}, ${roundId})`;
    }
  };
  await review(id(500), 1, A.alice, id(600), 700);
  await review(id(501), 2, A.erin, id(601), 710);

  const lease = async (leaseId: string, task: string, acc: string, manifest: string) => {
    await sql`insert into wos.leases (id, task_id, account_id, device_id, state, context_plan, expires_at, hard_deadline_at)
              values (${leaseId}, ${task}, ${acc}, ${dev(acc)}, 'active', '{}', now() + interval '30 minutes', now() + interval '3 hours')`;
    await sql`insert into wos.context_manifests (id, lease_id, task_id, account_id, role, model_id, reasoning, context_format_version, manifest, manifest_sha256)
              values (${manifest}, ${leaseId}, ${task}, ${acc}, 'implementation_reviewer', 'm', 'max', 'ctx-1', '{}', ${`sha256:${manifest.replace(/-/g, "").padEnd(64, "0").slice(0, 64)}`})`;
  };
  await lease(id(800), id(700), A.bob, id(900)); // bob: astra slot of alice's round
  await lease(id(801), id(701), A.carol, id(901)); // carol: fable slot of alice's round
  await lease(id(802), id(710), A.dave, id(902)); // dave: astra slot of erin's round

  return {
    A,
    dev,
    rounds: { alice: id(600), erin: id(601) },
    attempts: { alice: id(500), erin: id(501) },
    tasks: { bobAstra: id(700), carolFable: id(701), daveAstra: id(710) },
    leases: { bob: id(800), carol: id(801), dave: id(802) },
    manifests: { bob: id(900), carol: id(901), dave: id(902) },
  };
}

export type Seed = Awaited<ReturnType<typeof seedPipeline>>;

export function insertReview(
  sql: Sql | Tx,
  r: {
    round: string;
    task: string;
    lease: string;
    account: string;
    slot: "astra" | "fable";
    manifest: string;
    head?: string;
    hash?: string;
    independence?: string;
    verdict?: string;
  },
) {
  return sql`insert into wos.reviews (round_id, task_id, lease_id, account_id, github_user_id, slot, provider, model_id, reasoning,
                                      head_sha, submission_sha256, verdict, body, manifest_id, independence)
             values (${r.round}, ${r.task}, ${r.lease}, ${r.account}, 1, ${r.slot}, ${r.slot === "astra" ? "codex_cli" : "claude_cli"}, 'm', 'max',
                     ${r.head ?? HEAD}, ${r.hash ?? HASH}, ${r.verdict ?? "NO_MATERIAL_GAPS"}, '{}', ${r.manifest}, ${r.independence ?? "independent"})
             returning id`;
}
