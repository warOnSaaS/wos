// Vercel function entry for api.waronsaas.com. Vercel detects functions from committed files before the
// build runs, so this stub is committed and re-exports the esbuild bundle that `npm run bundle` writes
// (services/control-plane/bundle/index.mjs, git-ignored).
export { default } from "../bundle/index.mjs";
