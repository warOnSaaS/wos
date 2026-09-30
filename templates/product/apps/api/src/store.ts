/** Core's persistence for the self-hosted environment: one organization, local users, sign-in requests, sessions. */
import { randomUUID } from "node:crypto";

export type Role = "owner" | "admin" | "member";
export type SessionRow = { userId: string; organizationId: string; role: Role; expiresAt: Date };
export type RedeemResult = { ok: true; email: string } | { ok: false };

export const SIGNIN_MAX_ATTEMPTS = 5;

export interface CoreStore {
  /** The environment row, created on first call. */
  environment(nameIfNew: string): Promise<{ id: string; name: string }>;
  /** The one organization of a self-hosted Core, created on first call. */
  organization(nameIfNew: string): Promise<{ id: string; name: string }>;
  createSigninRequest(r: { id: string; email: string; codeHash: string; expiresAt: Date }): Promise<void>;
  signinRequestsSince(email: string, since: Date): Promise<number>;
  /** Atomic: single use, unexpired, fewer than SIGNIN_MAX_ATTEMPTS tries; a wrong code counts a try. */
  redeemSignin(id: string, codeHash: string, now: Date): Promise<RedeemResult>;
  /** Creates the user and membership on first sign-in; returns the membership role. */
  ensureMember(organizationId: string, email: string, roleIfNew: (memberCount: number) => Role): Promise<{ userId: string; role: Role }>;
  createSession(s: { tokenHash: string; userId: string; organizationId: string; expiresAt: Date }): Promise<void>;
  getSession(tokenHash: string, now: Date): Promise<SessionRow | null>;
  deleteSession(tokenHash: string): Promise<void>;
}

/** In-memory store: tests and `WOS_DEV_MEMORY=true` evaluation runs only; nothing survives a restart. */
export class MemoryStore implements CoreStore {
  private env: { id: string; name: string } | null = null;
  private org: { id: string; name: string } | null = null;
  private readonly requests = new Map<
    string,
    { email: string; codeHash: string; expiresAt: Date; attempts: number; redeemed: boolean; createdAt: Date }
  >();
  private readonly users = new Map<string, { id: string; role: Role }>();
  private readonly sessions = new Map<string, { userId: string; organizationId: string; expiresAt: Date }>();

  async environment(nameIfNew: string) {
    this.env ??= { id: randomUUID(), name: nameIfNew };
    return this.env;
  }
  async organization(nameIfNew: string) {
    this.org ??= { id: randomUUID(), name: nameIfNew };
    return this.org;
  }
  async createSigninRequest(r: { id: string; email: string; codeHash: string; expiresAt: Date }) {
    this.requests.set(r.id, {
      email: r.email,
      codeHash: r.codeHash,
      expiresAt: r.expiresAt,
      attempts: 0,
      redeemed: false,
      createdAt: new Date(),
    });
  }
  async signinRequestsSince(email: string, since: Date) {
    return [...this.requests.values()].filter((r) => r.email === email && r.createdAt >= since).length;
  }
  async redeemSignin(id: string, codeHash: string, now: Date): Promise<RedeemResult> {
    const r = this.requests.get(id);
    if (!r || r.redeemed || r.expiresAt <= now || r.attempts >= SIGNIN_MAX_ATTEMPTS) return { ok: false };
    if (r.codeHash !== codeHash) {
      r.attempts += 1;
      return { ok: false };
    }
    r.redeemed = true;
    return { ok: true, email: r.email };
  }
  async ensureMember(_organizationId: string, email: string, roleIfNew: (memberCount: number) => Role) {
    let u = this.users.get(email);
    if (!u) {
      u = { id: randomUUID(), role: roleIfNew(this.users.size) };
      this.users.set(email, u);
    }
    return { userId: u.id, role: u.role };
  }
  async createSession(s: { tokenHash: string; userId: string; organizationId: string; expiresAt: Date }) {
    this.sessions.set(s.tokenHash, { userId: s.userId, organizationId: s.organizationId, expiresAt: s.expiresAt });
  }
  async getSession(tokenHash: string, now: Date): Promise<SessionRow | null> {
    const s = this.sessions.get(tokenHash);
    if (!s || s.expiresAt <= now) return null;
    const role = [...this.users.values()].find((u) => u.id === s.userId)?.role;
    return role ? { ...s, role } : null;
  }
  async deleteSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }
}
