#!/bin/sh
# Installs the wOS command-line tool (wos) from a GitHub Release of warOnSaaS/wos. No sudo, no npm.
#
#   curl -fsSL https://waronsaas.com/install.sh | sh
#
# What it does: checks Node.js 22.12 or later; finds the newest release tagged cli@<version> (or WOS_VERSION);
# downloads wos-<version>-<platform>-<arch>.tar.gz and SHA256SUMS; refuses the file unless its SHA-256 matches;
# unpacks it into ~/.local/share/wos/<version>; links ~/.local/bin/wos to it. Nothing else on the machine changes.
#
# Settings (environment variables, all optional):
#   WOS_VERSION       a version to install, e.g. 0.1.0 (default: the newest cli@ release)
#   WOS_INSTALL_DIR   where versions are unpacked (default: ~/.local/share/wos)
#   WOS_BIN_DIR       where the wos link goes (default: ~/.local/bin)
#   WOS_INSTALL_FROM  a local directory holding the release files instead of GitHub (used by the release CI)
#
# Uninstall: rm -rf ~/.local/share/wos ~/.local/bin/wos
# Source: https://github.com/warOnSaaS/wos/blob/main/apps/web/install/install.sh
set -eu

REPO="warOnSaaS/wos"
INSTALL_DIR="${WOS_INSTALL_DIR:-$HOME/.local/share/wos}"
BIN_DIR="${WOS_BIN_DIR:-$HOME/.local/bin}"

die() {
  printf 'wOS install: %s\n' "$1" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || die "Node.js 22.12 or later is required and was not found on PATH. Install it from https://nodejs.org and run this again."
node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 12) ? 0 : 1)' ||
  die "Node.js 22.12 or later is required; this machine has $(node --version). Install it from https://nodejs.org and run this again."
command -v tar >/dev/null 2>&1 || die "tar is required."

# The platform and architecture of the Node that will run wos, so the keychain binding matches it.
TARGET=$(node -p 'process.platform + "-" + process.arch')
case "$TARGET" in
  darwin-arm64 | darwin-x64 | linux-x64 | linux-arm64) ;;
  win32-*) die "on Windows, run in PowerShell: irm https://waronsaas.com/install.ps1 | iex" ;;
  *) die "no build for $TARGET yet (macOS arm64 and x64, Linux x64 and arm64, Windows x64)." ;;
esac

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Find the release, download the tarball and SHA256SUMS, and verify the checksum. Node does the network and the
# hashing, so neither curl, wget nor sha256sum is needed. Exit 3 means there is no CLI release yet.
set +e
VERSION=$(WOS_TMP="$TMP" WOS_TARGET="$TARGET" WOS_REPO="$REPO" node --input-type=module -e '
import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const { WOS_TMP: tmp, WOS_TARGET: target, WOS_REPO: repo, WOS_VERSION: wanted, WOS_INSTALL_FROM: from } = process.env;
const headers = { "user-agent": "wos-install", accept: "application/vnd.github+json" };
let version = wanted ? wanted.replace(/^cli@/, "").replace(/^v/, "") : null;
if (!version) {
  if (from) { console.error("WOS_INSTALL_FROM needs WOS_VERSION"); process.exit(1); }
  const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`, { headers });
  if (!res.ok) { console.error(`could not read the releases of ${repo} from GitHub (HTTP ${res.status}); try again later`); process.exit(1); }
  const rel = (await res.json()).find((r) => r.tag_name.startsWith("cli@") && !r.draft && !r.prerelease);
  if (!rel) process.exit(3);
  version = rel.tag_name.slice(4);
}
const file = `wos-${version}-${target}.tar.gz`;
const get = async (name) => {
  if (from) { copyFileSync(join(from, name), join(tmp, name)); return readFileSync(join(tmp, name)); }
  const url = `https://github.com/${repo}/releases/download/${encodeURIComponent(`cli@${version}`)}/${name}`;
  const res = await fetch(url, { headers: { "user-agent": "wos-install" } });
  if (!res.ok) { console.error(`download failed: ${url} (HTTP ${res.status})`); process.exit(1); }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(join(tmp, name), buf);
  return buf;
};
const sums = (await get("SHA256SUMS")).toString("utf8");
const line = sums.split("\n").find((l) => l.trim().endsWith(`  ${file}`));
if (!line) { console.error(`SHA256SUMS of cli@${version} lists no ${file}`); process.exit(1); }
const expected = line.trim().split(/\s+/)[0].toLowerCase();
const actual = createHash("sha256").update(await get(file)).digest("hex");
if (actual !== expected) { console.error(`checksum mismatch for ${file}: expected ${expected}, got ${actual}; nothing was installed`); process.exit(1); }
process.stdout.write(version);
')
status=$?
set -e
if [ "$status" -eq 3 ]; then
  die "the wOS CLI is not released yet: https://github.com/$REPO has no cli@ release. See https://waronsaas.com/contribute"
fi
[ "$status" -eq 0 ] || die "nothing was installed."

DEST="$INSTALL_DIR/$VERSION"
mkdir -p "$INSTALL_DIR" "$BIN_DIR"
rm -rf "$DEST" "$DEST.partial"
mkdir -p "$DEST.partial"
tar -xzf "$TMP/wos-$VERSION-$TARGET.tar.gz" -C "$DEST.partial" --strip-components=1
mv "$DEST.partial" "$DEST"
chmod +x "$DEST/dist/wos.mjs"
ln -sf "$DEST/dist/wos.mjs" "$BIN_DIR/wos"

"$BIN_DIR/wos" --version >/dev/null || die "installed to $DEST, but $BIN_DIR/wos --version failed."
printf 'wOS CLI %s installed: %s -> %s\n' "$VERSION" "$BIN_DIR/wos" "$DEST"
case ":$PATH:" in
  *":$BIN_DIR:"*) printf 'Next: wos login\n' ;;
  *)
    printf '%s is not on your PATH. Add this line to your shell profile (~/.zshrc or ~/.bashrc), then open a new terminal:\n' "$BIN_DIR"
    printf '  export PATH="%s:$PATH"\n' "$BIN_DIR"
    printf 'Next: wos login\n'
    ;;
esac
