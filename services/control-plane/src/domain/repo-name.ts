/**
 * Repository identity (first-run fix B2). GitHub owner and repository names are case-insensitive; webhooks carry the
 * display case (`warOnSaaS/product`) while wOS stores the lowercase form (`waronsaas/product`, migration 0013 checks
 * it). Every name that enters from outside (webhooks, env, agent-written files) goes through `repoKey` before it is
 * compared or stored.
 */
export const repoKey = (fullName: string): string => fullName.trim().toLowerCase();

/** A read-only map keyed by repository name that ignores case (the build-graph registry lookups). */
export function caseInsensitiveRepoMap<V>(entries: Iterable<readonly [string, V]>): ReadonlyMap<string, V> {
  const inner = new Map<string, V>();
  for (const [k, v] of entries) inner.set(repoKey(k), v);
  return new (class extends Map<string, V> {
    override get(key: string) {
      return inner.get(repoKey(key));
    }
    override has(key: string) {
      return inner.has(repoKey(key));
    }
  })(inner);
}
