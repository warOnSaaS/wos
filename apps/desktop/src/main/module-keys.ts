/**
 * S-37: the module-signing public keys PINNED in this Desktop binary. `keys/module-signing-keys.json` is committed and
 * inlined into dist/app/main.mjs by the bundler, so it ships inside the signed app; a key is never fetched at runtime.
 * Rotation ships in a Desktop release with both keys pinned for one cycle.
 *
 * The file is EMPTY until the coordinator adds the real public key(s) of the module-signing key held in the wos
 * `release` environment (FOUNDER-CHECKLIST 13.5). With no key pinned, every package is refused: "key ... is not pinned
 * in this Desktop". Tests use throwaway keys passed in explicitly; a test key never enters this file.
 *
 * Format: { "schema": "wos-module-signing-keys.v1", "keys": [{ "keyId": "wos-module-2026", "publicKey": "<C-5 base64>" }] }
 */
import { ModuleSignature } from "@waronsaas/contracts";
import { devicePublicKeyFromBase64 } from "@waronsaas/contracts/canonical";
import pinned from "./keys/module-signing-keys.json" with { type: "json" };

export interface PinnedKeyFile {
  schema: "wos-module-signing-keys.v1";
  keys: Array<{ keyId: string; publicKey: string }>;
}

/** Validates a key file: schema, key id format (the ModuleSignature rule), C-5 public keys, no duplicates. */
export function pinnedKeysFrom(file: unknown): Readonly<Record<string, string>> {
  const f = file as Partial<PinnedKeyFile> | null;
  if (f?.schema !== "wos-module-signing-keys.v1" || !Array.isArray(f.keys)) throw new Error("module-signing-keys.json: bad schema");
  const out: Record<string, string> = {};
  for (const k of f.keys) {
    if (!ModuleSignature.shape.keyId.safeParse(k?.keyId).success)
      throw new Error(`module-signing-keys.json: bad key id ${String(k?.keyId)}`);
    if (Object.hasOwn(out, k.keyId)) throw new Error(`module-signing-keys.json: duplicate key id ${k.keyId}`);
    // Throws unless it is base64 of exactly 32 raw Ed25519 bytes (C-5).
    devicePublicKeyFromBase64(k.publicKey);
    out[k.keyId] = k.publicKey;
  }
  return Object.freeze(out);
}

/** The keys compiled into this binary. Empty until the coordinator commits the real ones. */
export const PINNED_MODULE_KEYS: Readonly<Record<string, string>> = pinnedKeysFrom(pinned);
