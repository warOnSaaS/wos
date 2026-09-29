/**
 * Largest-remainder pool allocation (REWARD-PROTOCOL.md section 4).
 *
 * Every key gets floor(total * weight / sumOfWeights); the tokens left over go one each to the keys
 * with the largest remainders, ties broken by key ascending (plain UTF-16 code-unit order, never
 * locale order). Arithmetic is BigInt, so the result is exact for any safe integer inputs and always
 * sums to `total`. The result does not depend on the order of `weights`.
 */

export class PoolAllocationError extends Error {
  override name = "PoolAllocationError";
}

export function allocatePool(total: number, weights: ReadonlyArray<{ key: string; weight: number }>): Map<string, number> {
  if (!Number.isSafeInteger(total) || total < 0)
    throw new PoolAllocationError(`pool total must be a non-negative safe integer, got ${total}`);
  const seen = new Set<string>();
  for (const w of weights) {
    if (seen.has(w.key)) throw new PoolAllocationError(`duplicate pool key ${w.key}`);
    seen.add(w.key);
    if (!Number.isSafeInteger(w.weight) || w.weight < 0)
      throw new PoolAllocationError(`weight for ${w.key} must be a non-negative safe integer, got ${w.weight}`);
  }
  const sorted = [...weights].sort((a, b) => compareKeys(a.key, b.key));
  const out = new Map<string, number>(sorted.map((w) => [w.key, 0]));
  const sum = sorted.reduce((s, w) => s + BigInt(w.weight), 0n);
  if (total === 0) return out;
  if (sum === 0n) throw new PoolAllocationError(`cannot split a pool of ${total} over zero total weight`);

  const T = BigInt(total);
  const parts = sorted.map((w) => {
    const num = T * BigInt(w.weight);
    return { key: w.key, base: num / sum, rem: num % sum };
  });
  let left = T - parts.reduce((s, p) => s + p.base, 0n);
  const byRemainder = [...parts].sort((a, b) => (a.rem === b.rem ? compareKeys(a.key, b.key) : a.rem > b.rem ? -1 : 1));
  for (const p of byRemainder) {
    if (left === 0n) break;
    if (p.rem === 0n) break; // exact shares; left is necessarily 0 here
    p.base += 1n;
    left -= 1n;
  }
  for (const p of parts) out.set(p.key, Number(p.base));
  return out;
}

/** Code-unit order; the same order Postgres uses for uuid text and ASCII keys. */
export function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
