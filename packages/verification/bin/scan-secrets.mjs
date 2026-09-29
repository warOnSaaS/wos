#!/usr/bin/env node
// Secret scan over every tracked file of a git repo (S-8). Exit 1 on any hit. Usage: scan-secrets.mjs [repoDir]
// Uses the same patterns as SECRET_DETECTED so the platform repo and submissions share one definition.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { scanForSecrets } from "../dist/index.js";

const root = process.argv[2] ?? process.cwd();
const files = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
let hits = 0;
for (const f of files) {
  const p = join(root, f);
  let st;
  try {
    st = statSync(p);
  } catch {
    continue; // deleted in the working tree
  }
  if (!st.isFile() || st.size > 5_000_000) continue;
  const buf = readFileSync(p);
  if (buf.includes(0)) continue; // binary
  for (const h of scanForSecrets(buf.toString("utf8"))) {
    hits++;
    console.error(`${f}:${h.line}: ${h.id}`);
  }
}
console.log(`scanned ${files.length} tracked files, ${hits} secret pattern hit(s)`);
process.exit(hits ? 1 : 0);
