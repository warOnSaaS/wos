// Vercel function entry for core.waronsaas.com (wOS Cloud's Core). Vercel detects functions from committed files before the build runs, so this
// stub is committed and re-exports the esbuild bundle that `npm run build` writes (dist/vercel.mjs, git-ignored).
export { default } from "../dist/vercel.mjs";
