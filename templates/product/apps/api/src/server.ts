/** `node dist/server.mjs`: wOS Core on a plain Node HTTP server (Docker, self-hosting). */
import { createServer } from "node:http";
import { bootCore } from "./boot.js";
import { serveFetch } from "./node-http.js";

const core = await bootCore(process.env);
const server = createServer(serveFetch((req) => core.app.fetch(req)));
server.listen(core.config.port, () => process.stdout.write(`wOS Core listening on :${core.config.port}\n`));
const stop = () => server.close(() => void core.close().then(() => process.exit(0)));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
