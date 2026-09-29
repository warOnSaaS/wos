/**
 * wOS Desktop main process, production entry (bundled to dist/app/main.mjs). Owns processes, git,
 * worktrees, Claude Code / Codex, the filesystem and verification — all through the ONE orchestrator
 * created in start.ts. The renderer is sandboxed and reaches main only through `window.wos`.
 */
import { appDirOf, startDesktop } from "./start.js";

startDesktop({ appDir: appDirOf(import.meta.url) });
