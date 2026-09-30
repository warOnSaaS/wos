import { readFileSync } from "node:fs";
import { join } from "node:path";

// The wOS CLI installer for Windows: `irm https://waronsaas.com/install.ps1 | iex`.
// Source: apps/web/install/install.ps1 (run on Windows by the cli-release workflow).
export const dynamic = "force-static";

export function GET() {
  return new Response(readFileSync(join(process.cwd(), "install", "install.ps1"), "utf8"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
