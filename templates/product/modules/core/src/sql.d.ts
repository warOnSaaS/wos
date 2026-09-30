// Migration files are imported as text: Vite's `?raw` in tests, the esbuild plugin in each app's build.mjs.
declare module "*.sql?raw" {
  const sql: string;
  export default sql;
}
