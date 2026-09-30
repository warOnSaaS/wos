/** The Postgres CoreStore over schema `core` (applications/core/migrations). */
import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { type CoreStore, type RedeemResult, type Role, SIGNIN_MAX_ATTEMPTS, type SessionRow } from "./store.js";

export class PostgresStore implements CoreStore {
  constructor(private readonly sql: Sql) {}

  async environment(nameIfNew: string) {
    await this.sql`insert into core.environment (id, name) values (${randomUUID()}, ${nameIfNew}) on conflict (singleton) do nothing`;
    const [row] = await this.sql<{ id: string; name: string }[]>`select id, name from core.environment`;
    return row!;
  }

  async organization(nameIfNew: string) {
    await this.sql`insert into core.organizations (id, name)
                   select ${randomUUID()}, ${nameIfNew} where not exists (select 1 from core.organizations)`;
    const [row] = await this.sql<{ id: string; name: string }[]>`select id, name from core.organizations order by created_at limit 1`;
    return row!;
  }

  async createSigninRequest(r: { id: string; email: string; codeHash: string; expiresAt: Date }) {
    await this
      .sql`insert into core.signin_requests (id, email, code_hash, expires_at) values (${r.id}, ${r.email}, ${r.codeHash}, ${r.expiresAt})`;
  }

  async signinRequestsSince(email: string, since: Date) {
    const [row] = await this.sql<
      { n: number }[]
    >`select count(*)::int as n from core.signin_requests where email = ${email} and created_at >= ${since}`;
    return row!.n;
  }

  async redeemSignin(id: string, codeHash: string, now: Date): Promise<RedeemResult> {
    return this.sql.begin(async (tx) => {
      const [r] = await tx<{ email: string; code_hash: string; attempts: number; expires_at: Date; redeemed_at: Date | null }[]>`
        select email, code_hash, attempts, expires_at, redeemed_at from core.signin_requests where id = ${id} for update`;
      if (!r || r.redeemed_at !== null || r.expires_at <= now || r.attempts >= SIGNIN_MAX_ATTEMPTS) return { ok: false } as const;
      if (r.code_hash !== codeHash) {
        await tx`update core.signin_requests set attempts = attempts + 1 where id = ${id}`;
        return { ok: false } as const;
      }
      await tx`update core.signin_requests set redeemed_at = ${now} where id = ${id}`;
      return { ok: true, email: r.email } as const;
    });
  }

  async ensureMember(organizationId: string, email: string, roleIfNew: (memberCount: number) => Role) {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('core.memberships'))`;
      await tx`insert into core.users (id, email) values (${randomUUID()}, ${email}) on conflict (email) do nothing`;
      const [u] = await tx<{ id: string }[]>`select id from core.users where email = ${email}`;
      const [m] = await tx<
        { role: Role }[]
      >`select role from core.memberships where organization_id = ${organizationId} and user_id = ${u!.id}`;
      if (m) return { userId: u!.id, role: m.role };
      const [c] = await tx<{ n: number }[]>`select count(*)::int as n from core.memberships where organization_id = ${organizationId}`;
      const role = roleIfNew(c!.n);
      await tx`insert into core.memberships (organization_id, user_id, role) values (${organizationId}, ${u!.id}, ${role})`;
      return { userId: u!.id, role };
    });
  }

  async createSession(s: { tokenHash: string; userId: string; organizationId: string; expiresAt: Date }) {
    await this.sql`insert into core.sessions (token_hash, user_id, organization_id, expires_at)
                   values (${s.tokenHash}, ${s.userId}, ${s.organizationId}, ${s.expiresAt})`;
  }

  async getSession(tokenHash: string, now: Date): Promise<SessionRow | null> {
    const [r] = await this.sql<{ user_id: string; organization_id: string; role: Role; expires_at: Date }[]>`
      select s.user_id, s.organization_id, m.role, s.expires_at
        from core.sessions s join core.memberships m on m.organization_id = s.organization_id and m.user_id = s.user_id
       where s.token_hash = ${tokenHash} and s.expires_at > ${now}`;
    return r ? { userId: r.user_id, organizationId: r.organization_id, role: r.role, expiresAt: r.expires_at } : null;
  }

  async deleteSession(tokenHash: string) {
    await this.sql`delete from core.sessions where token_hash = ${tokenHash}`;
  }
}
