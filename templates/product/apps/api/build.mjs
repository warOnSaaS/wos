// Builds wOS Core into dist/ (server.mjs for Docker, cli.mjs for migrations, vercel.mjs for core.waronsaas.com).
import { fileURLToPath } from "node:url";
import { bundle } from "../../modules/core/esbuild.mjs";

await bundle(fileURLToPath(new URL(".", import.meta.url)), { server: "src/server.ts", cli: "src/cli.ts", vercel: "src/vercel.ts" });
