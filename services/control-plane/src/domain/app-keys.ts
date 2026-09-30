/**
 * Keys for the one-product routes (Amendment 01, WOS-APP-PROTOCOL sections 6 and 8). Read from the environment
 * once; values are never logged, returned or put in an error message.
 *
 *   WOS_ENV_TOKEN_KEY        Ed25519 private key that signs environment tokens (C-8): PKCS#8 PEM
 *                            (`openssl genpkey -algorithm ed25519`), literal or with `\n` escapes, or the
 *                            standard base64 of the raw 32-byte seed.
 *   WOS_ENV_TOKEN_KID        its key id, `wos-env-NNNN[-suffix]` (default `wos-env-2026`).
 *   WOS_ENV_TOKEN_KEY_NEXT   the next key, same format. Only its public half is published (rotation); it never signs.
 *   WOS_ENV_TOKEN_KID_NEXT   its key id (default `wos-env-2026-next`).
 *   WOS_MODULE_PUBLIC_KEYS   JSON object keyId -> module-signing PUBLIC key (standard base64 of the raw 32 bytes, or
 *                            SPKI PEM): the keys Desktop pins (S-37). The control plane re-verifies every published
 *                            desktop package against them.
 *
 * Rotation: set the new key as `_NEXT` for at least one token lifetime plus skew (16 minutes) so hosted Core has
 * fetched it, then move it to `WOS_ENV_TOKEN_KEY`/`_KID` and put a fresh one in `_NEXT`.
 */
import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { EnvironmentKey, EnvironmentTokenHeader } from "@waronsaas/contracts";
import { devicePublicKeyFromBase64, ed25519PrivateKeyFromSeed, encodeDevicePublicKey } from "@waronsaas/contracts/canonical";

export interface SigningKey {
  kid: string;
  privateKey: KeyObject;
  /** C-5 encoding: standard base64 of the raw 32-byte public key. */
  publicKey: string;
}

export interface AppKeys {
  /** Signs environment tokens; null when not configured (issueEnvironmentToken then fails closed). */
  envToken: SigningKey | null;
  /** Published beside the current key for rotation; never signs. */
  envTokenNext: { kid: string; publicKey: string } | null;
  /** keyId -> C-5 public key, for verifyModulePackage. */
  modulePublicKeys: Readonly<Record<string, string>>;
}

export const DEFAULT_ENV_TOKEN_KID = "wos-env-2026";
export const DEFAULT_ENV_TOKEN_KID_NEXT = "wos-env-2026-next";

/** Parses an Ed25519 private key given as PKCS#8 PEM or base64 seed. Throws without echoing the value. */
export function parseEd25519PrivateKey(value: string, name: string): KeyObject {
  const text = value.trim().replace(/\\n/g, "\n");
  let key: KeyObject;
  try {
    if (text.startsWith("-----BEGIN")) key = createPrivateKey(text);
    else {
      const seed = Buffer.from(text, "base64");
      if (seed.length !== 32) throw new Error("length");
      key = ed25519PrivateKeyFromSeed(seed);
    }
  } catch {
    throw new Error(`wOS control plane: ${name} is not an Ed25519 private key (PKCS#8 PEM or base64 of the 32-byte seed)`);
  }
  if (key.asymmetricKeyType !== "ed25519") throw new Error(`wOS control plane: ${name} is not an Ed25519 key`);
  return key;
}

function parsePublicKey(value: string, name: string): string {
  const text = value.trim().replace(/\\n/g, "\n");
  try {
    if (text.startsWith("-----BEGIN")) {
      const key = createPublicKey(text);
      if (key.asymmetricKeyType !== "ed25519") throw new Error("type");
      return encodeDevicePublicKey(key);
    }
    devicePublicKeyFromBase64(text);
    return text;
  } catch {
    throw new Error(`wOS control plane: ${name} is not an Ed25519 public key (base64 of 32 bytes or SPKI PEM)`);
  }
}

function kidOf(value: string | undefined, fallback: string, name: string): string {
  const kid = value?.trim() || fallback;
  if (!EnvironmentTokenHeader.shape.kid.safeParse(kid).success) throw new Error(`wOS control plane: ${name} must look like wos-env-2026`);
  return kid;
}

export function signingKey(kid: string, privateKey: KeyObject): SigningKey {
  const publicKey = encodeDevicePublicKey(createPublicKey(privateKey));
  EnvironmentKey.parse({ kid, alg: "EdDSA", publicKey });
  return { kid, privateKey, publicKey };
}

/** Reads the keys from the environment. Missing values yield nulls (fail closed at use); malformed values throw. */
export function appKeysFromEnv(env: Readonly<Record<string, string | undefined>>): AppKeys {
  const current = env.WOS_ENV_TOKEN_KEY?.trim()
    ? signingKey(
        kidOf(env.WOS_ENV_TOKEN_KID, DEFAULT_ENV_TOKEN_KID, "WOS_ENV_TOKEN_KID"),
        parseEd25519PrivateKey(env.WOS_ENV_TOKEN_KEY, "WOS_ENV_TOKEN_KEY"),
      )
    : null;
  const next = env.WOS_ENV_TOKEN_KEY_NEXT?.trim()
    ? signingKey(
        kidOf(env.WOS_ENV_TOKEN_KID_NEXT, DEFAULT_ENV_TOKEN_KID_NEXT, "WOS_ENV_TOKEN_KID_NEXT"),
        parseEd25519PrivateKey(env.WOS_ENV_TOKEN_KEY_NEXT, "WOS_ENV_TOKEN_KEY_NEXT"),
      )
    : null;
  if (current && next && current.kid === next.kid)
    throw new Error("wOS control plane: WOS_ENV_TOKEN_KID and WOS_ENV_TOKEN_KID_NEXT must differ");
  const modulePublicKeys: Record<string, string> = {};
  const raw = env.WOS_MODULE_PUBLIC_KEYS?.trim();
  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("wOS control plane: WOS_MODULE_PUBLIC_KEYS must be a JSON object keyId -> public key");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new Error("wOS control plane: WOS_MODULE_PUBLIC_KEYS must be a JSON object keyId -> public key");
    for (const [keyId, value] of Object.entries(parsed)) {
      if (!/^wos-module-\d{4}(?:-[a-z0-9]+)?$/.test(keyId) || typeof value !== "string")
        throw new Error("wOS control plane: WOS_MODULE_PUBLIC_KEYS keys must look like wos-module-2026 with string values");
      modulePublicKeys[keyId] = parsePublicKey(value, `WOS_MODULE_PUBLIC_KEYS.${keyId}`);
    }
  }
  return { envToken: current, envTokenNext: next ? { kid: next.kid, publicKey: next.publicKey } : null, modulePublicKeys };
}
