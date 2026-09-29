/**
 * SecretStore over Electron `safeStorage` (S-4: "Desktop stores tokens with Electron safeStorage; never
 * plain files"). Each key is one file holding ONLY the OS-encrypted blob (macOS Keychain-backed key,
 * libsecret/kwallet on Linux). If the OS cannot encrypt (Linux without a keyring: backend "basic_text"),
 * the store refuses to write rather than fall back to plaintext.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SecretStore } from "@waronsaas/orchestrator";

/** The subset of Electron's safeStorage used here (injected so tests run without Electron). */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
  getSelectedStorageBackend?(): string;
}

const KEY = /^[a-z0-9.-]{1,64}$/;

export class SafeStorageSecrets implements SecretStore {
  constructor(
    private readonly safe: SafeStorageLike,
    private readonly dir: string,
  ) {}

  private file(key: string): string {
    if (!KEY.test(key)) throw new Error(`invalid secret key ${key}`);
    return join(this.dir, `${key}.bin`);
  }

  private usable(): boolean {
    if (!this.safe.isEncryptionAvailable()) return false;
    const backend = this.safe.getSelectedStorageBackend?.();
    return backend !== "basic_text";
  }

  async get(key: string): Promise<string | null> {
    let blob: Buffer;
    try {
      blob = readFileSync(this.file(key));
    } catch {
      return null;
    }
    if (!this.usable()) return null;
    try {
      return this.safe.decryptString(blob);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    if (!this.usable()) {
      throw new Error(
        "KEYCHAIN_UNAVAILABLE: this system has no OS keychain for wOS to store the session in; wOS will not store it in plain text",
      );
    }
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    writeFileSync(this.file(key), this.safe.encryptString(value), { mode: 0o600 });
  }

  async delete(key: string): Promise<void> {
    rmSync(this.file(key), { force: true });
  }
}
