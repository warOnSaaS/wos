/** A minimal Node http <-> fetch adapter (no @hono/node-server dependency). */
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

export function serveFetch(handler: (req: Request) => Promise<Response> | Response) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = `http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (Array.isArray(v)) for (const x of v) headers.append(k, x);
        else if (v !== undefined) headers.set(k, v);
      }
      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      const request = new Request(url, {
        method: req.method,
        headers,
        body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
        ...(hasBody ? { duplex: "half" } : {}),
      } as RequestInit);
      const response = await handler(request);
      const out: Record<string, string | string[]> = {};
      response.headers.forEach((v, k) => {
        if (k !== "set-cookie") out[k] = v;
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) out["set-cookie"] = cookies;
      res.writeHead(response.status, out);
      if (response.body) {
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) res.write(chunk);
      }
      res.end();
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(`internal error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}
