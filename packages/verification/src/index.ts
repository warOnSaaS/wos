/**
 * @waronsaas/verification — deterministic scope/diff validation shared by client, server and CI
 * (owner: verification workstream). Pure functions only.
 */
import {
  NotImplementedError,
  type AbuSpec,
  type Changeset,
  type ChangesetValidation,
  type RepoManifest,
  type WriteScope,
} from "@waronsaas/contracts";

/** True when two write scopes can touch the same path (prefix algebra, BUILD-PROTOCOL.md). */
export function scopesOverlap(a: WriteScope, b: WriteScope): boolean {
  const base = (s: string) => (s.endsWith("/**") ? { prefix: s.slice(0, -3), tree: true } : { prefix: s, tree: false });
  const x = base(a);
  const y = base(b);
  if (x.prefix === y.prefix) return true;
  if (x.tree && y.prefix.startsWith(`${x.prefix}/`)) return true;
  if (y.tree && x.prefix.startsWith(`${y.prefix}/`)) return true;
  return false;
}

export interface ScopeContext {
  kind: "abu" | "roadmap" | "feature_contract";
  abu: AbuSpec | null;
  /** For documents: the only paths the author may write. */
  documentPaths: WriteScope[];
  repoManifest: RepoManifest;
  /** Paths that exist at the parent commit (to validate deletes and case collisions). */
  existingPaths: ReadonlySet<string>;
}

export function validateChangeset(changeset: Changeset, ctx: ScopeContext): ChangesetValidation {
  void changeset;
  void ctx;
  throw new NotImplementedError("validateChangeset");
}
