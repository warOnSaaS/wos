/**
 * The orchestrator's SecretStore over the OS keychain (@napi-rs/keyring): macOS Keychain, Windows
 * Credential Manager, Linux Secret Service. SECURITY.md S-4: the session and device key never touch a
 * plain file. The orchestrator stores exactly two keys (wos.session.v1, wos.device-key.v1).
 */
import { AsyncEntry } from "@napi-rs/keyring";
import type { SecretStore } from "@waronsaas/orchestrator";

/** Keychain service name for every wOS CLI entry. The entry's account is the orchestrator's key. */
export const KEYCHAIN_SERVICE = "com.waronsaas.wos";

/** The subset of AsyncEntry the store uses (injected in tests so they never touch the real keychain). */
export interface KeychainEntry {
  getPassword(): Promise<string | null | undefined>;
  setPassword(value: string): Promise<void>;
  deletePassword(): Promise<boolean>;
}

export type EntryFactory = (service: string, account: string) => KeychainEntry;

const defaultEntry: EntryFactory = (service, account) => new AsyncEntry(service, account);

/** keyring reports a missing entry as an error on some platforms and as undefined on others. */
function isMissing(e: unknown): boolean {
  return /no (matching )?entry|not found|could not be found|NoEntry/i.test(e instanceof Error ? e.message : String(e));
}

export function createKeychainSecretStore(service = KEYCHAIN_SERVICE, entry: EntryFactory = defaultEntry): SecretStore {
  return {
    async get(key) {
      try {
        return (await entry(service, key).getPassword()) ?? null;
      } catch (e) {
        if (isMissing(e)) return null;
        throw keychainError("read", key, e);
      }
    },
    async set(key, value) {
      try {
        await entry(service, key).setPassword(value);
      } catch (e) {
        throw keychainError("write", key, e);
      }
    },
    async delete(key) {
      try {
        await entry(service, key).deletePassword();
      } catch (e) {
        if (!isMissing(e)) throw keychainError("delete", key, e);
      }
    },
  };
}

function keychainError(op: string, key: string, cause: unknown): Error {
  const err = new Error(`OS keychain ${op} failed for ${key}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  (err as Error & { code: string }).code = "KEYCHAIN_UNAVAILABLE";
  return err;
}
