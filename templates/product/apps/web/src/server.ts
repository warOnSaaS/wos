/** `node dist/server.mjs`: wOS Web on a plain Node HTTP server (Docker, self-hosting). */
import { createServer } from "node:http";
import { serveFetch } from "../../api/src/node-http.js";
import { bootWeb } from "./boot.js";

const app = bootWeb(process.env);
const port = Number(process.env.PORT ?? 3000);
const server = createServer(serveFetch((req) => app.fetch(req)));
server.listen(port, () => process.stdout.write(`wOS Web listening on :${port}\n`));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
