/**
 * Runs the tokenomics simulation deterministically.
 *   node tools/tokenomics-sim/run.ts            print the generated markdown
 *   node tools/tokenomics-sim/run.ts --write    refresh the tables in docs/protocol/TOKENOMICS-SIMULATION.md
 *   node tools/tokenomics-sim/run.ts --check    exit 1 if the doc is stale
 * Requires the built contracts (npm run build -w @waronsaas/contracts) and Node >= 22.18 (type stripping).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { report, spliceInto } from "./sim.ts";

const DOC = fileURLToPath(new URL("../../docs/protocol/TOKENOMICS-SIMULATION.md", import.meta.url));
const generated = report();
const mode = process.argv[2];
if (mode === "--write" || mode === "--check") {
  const doc = readFileSync(DOC, "utf8");
  const next = spliceInto(doc, generated);
  if (mode === "--write") {
    writeFileSync(DOC, next);
    console.log(`updated ${DOC}`);
  } else if (next !== doc) {
    console.error("TOKENOMICS-SIMULATION.md is stale: run node tools/tokenomics-sim/run.ts --write");
    process.exit(1);
  } else {
    console.log("TOKENOMICS-SIMULATION.md is current");
  }
} else {
  console.log(generated);
}
