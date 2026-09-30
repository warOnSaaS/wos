/**
 * Pins a module-signing PUBLIC key in wOS Desktop (S-37; FOUNDER-CHECKLIST 13.5). The coordinator runs it with the
 * public PEM the founder hands over (`openssl pkey -in wos-module-2026.pem -pubout`); it converts the SPKI PEM to the
 * C-5 encoding (standard base64 of the raw 32 bytes) and adds it to src/main/keys/module-signing-keys.json, which the
 * bundler compiles into the signed binary. Never give it a private key: it refuses one.
 *
 *   node apps/desktop/scripts/pin-module-key.mjs wos-module-2026 wos-module-2026.pub.pem
 *   node apps/desktop/scripts/pin-module-key.mjs wos-module-2026-next wos-module-2026-next.pub.pem
 *
 * Rotation: pin the new key next to the old one and ship a Desktop release with both for one cycle; remove the old
 * one in the release after that (`--remove <keyId>`).
 */
import { createPublicKey } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FILE = join(dirname(dirname(fileURLToPath(import.meta.url))), "src/main/keys/module-signing-keys.json");
const KEY_ID = /^wos-module-\d{4}(?:-[a-z0-9]+)?$/;

export function c5FromPem(pem) {
  if (/PRIVATE KEY/.test(pem)) throw new Error("that is a PRIVATE key; pin only the public key (openssl pkey -pubout)");
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error(`not an Ed25519 key (${key.asymmetricKeyType})`);
  const der = key.export({ format: "der", type: "spki" });
  if (der.length !== 44) throw new Error("unexpected Ed25519 SPKI length");
  return der.subarray(12).toString("base64");
}

function main(argv) {
  const file = JSON.parse(readFileSync(FILE, "utf8"));
  if (argv[0] === "--remove") {
    file.keys = file.keys.filter((k) => k.keyId !== argv[1]);
  } else {
    const [keyId, pemPath] = argv;
    if (!keyId || !pemPath) throw new Error("usage: pin-module-key.mjs <keyId> <public.pem> | --remove <keyId>");
    if (!KEY_ID.test(keyId)) throw new Error(`key id must look like wos-module-2026 or wos-module-2026-next, got ${keyId}`);
    if (file.keys.some((k) => k.keyId === keyId)) throw new Error(`${keyId} is already pinned`);
    file.keys.push({ keyId, publicKey: c5FromPem(readFileSync(pemPath, "utf8")) });
  }
  writeFileSync(FILE, `${JSON.stringify(file, null, 2)}\n`);
  console.log(`pinned: ${file.keys.map((k) => k.keyId).join(", ") || "none"} (${FILE})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
