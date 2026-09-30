import { readFileSync } from "node:fs";
import { join } from "node:path";

// The wOS CLI installer for macOS and Linux: `curl -fsSL https://waronsaas.com/install.sh | sh`.
// Source: apps/web/install/install.sh (tested by apps/cli/test/release.test.ts and the cli-release workflow).
export const dynamic = "force-static";

export function GET() {
  return new Response(readFileSync(join(process.cwd(), "install", "install.sh"), "utf8"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
