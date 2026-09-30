// Builds wOS Web into dist/ (server.mjs for Docker, vercel.mjs for app.waronsaas.com).
import { fileURLToPath } from "node:url";
import { bundle } from "../../modules/core/esbuild.mjs";

await bundle(fileURLToPath(new URL(".", import.meta.url)), { server: "src/server.ts", vercel: "src/vercel.ts" });
