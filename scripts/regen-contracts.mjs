// The contracts bump procedure in one command (WORKSTREAMS section 5, B-0003-suite-shell). After changing
// packages/contracts/src (and CONTRACTS_VERSION), run from the repository root with Node 22:
//   node scripts/regen-contracts.mjs            regenerates every copy, then updates the version goldens
//   node scripts/regen-contracts.mjs --check    fails if any copy is stale (what `npm run check` also catches)
// Copies: the vendored validator bundle (templates/product/.github/wos/wos-ci-lib.mjs), the site's progress.ts,
// the product template's vendored contracts. Goldens: context-engine manifest hashes and CLI output, which embed the
// version; review their diff (only manifest hashes and the version may change).
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const check = process.argv.includes("--check");
const node = (script, cwd = ".") => {
  console.log(`> (cd ${cwd} && node ${script}${check ? " --check" : ""})`);
  execFileSync(process.execPath, [script, ...(check ? ["--check"] : [])], { cwd: `${root}${cwd}`, stdio: "inherit" });
};

execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" }); // tsc -b: the goldens import built packages
node("packages/verification/ci/bundle.mjs");
node("scripts/sync-shared.mjs", "apps/web"); // resolves the monorepo from apps/web
node("templates/product/modules/core-contracts/vendor.mjs");
if (!check) {
  const goldens = ["packages/context-engine/test/determinism.test.ts", "apps/cli/test/cli.test.ts"];
  for (const g of goldens) {
    // The file BEFORE -u: vitest 5's --update takes an optional value and would swallow the path (and run everything).
    console.log(`> npx vitest run ${g} -u`);
    execFileSync("npx", ["vitest", "run", g, "-u"], { cwd: root, stdio: "inherit" });
  }
  console.log("Done. Review `git diff` of the goldens: only manifest hashes and the contracts version may change.");
}
