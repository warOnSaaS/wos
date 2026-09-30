// Vendors @waronsaas/contracts into the product repo, the way packages/verification/ci/bundle.mjs vendors the
// validator: a GENERATED, byte-identical copy of packages/contracts/src in waronsaas/wos, committed under
// src/vendor/. Nothing in src/vendor/ is edited by hand; src/index.ts re-exports only the names WORKSTREAMS
// section 12.4 lets suite-shell use. Runs only inside the wos monorepo (the product repo receives the copy).
// Usage: node templates/product/modules/core-contracts/vendor.mjs [--check]   (--check fails if the copy is stale)
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const source = here("../../../../packages/contracts/src");
const target = here("./src/vendor");

function list(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p));
    }
  };
  walk(dir);
  return out;
}

/** Problems between the monorepo contracts and the vendored copy; empty when current. */
export function vendorProblems() {
  if (!existsSync(source)) return ["packages/contracts/src not found: run this inside the wos monorepo"];
  const want = list(source);
  const have = new Set(list(target));
  const problems = [];
  for (const f of want) {
    if (!have.has(f)) problems.push(`missing ${f}`);
    else if (!readFileSync(join(source, f)).equals(readFileSync(join(target, f)))) problems.push(`stale ${f}`);
    have.delete(f);
  }
  for (const f of have) problems.push(`extra ${f}`);
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--check")) {
    const problems = vendorProblems();
    if (problems.length > 0) {
      console.error(
        `modules/core-contracts/src/vendor is stale (${problems.join(", ")}): run node templates/product/modules/core-contracts/vendor.mjs`,
      );
      process.exit(1);
    }
    console.log("vendored contracts are current");
  } else {
    rmSync(target, { recursive: true, force: true });
    cpSync(source, target, { recursive: true });
    console.log(`copied ${list(target).length} files into ${target}`);
  }
}
