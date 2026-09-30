/** A tiny cookie-keeping client for driving wOS Web in tests (no real browser). */
type Fetchable = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };

export class Browser {
  private readonly jar = new Map<string, string>();
  constructor(private readonly app: Fetchable) {}

  private absorb(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const i = pair!.indexOf("=");
      const name = pair!.slice(0, i).trim();
      const value = pair!.slice(i + 1).trim();
      const expired = attrs.some((a) => /max-age=0\b/i.test(a.trim())) || value === "";
      if (expired) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  async go(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.jar.size > 0) headers.set("cookie", [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const res = await this.app.request(path, { ...init, headers });
    this.absorb(res);
    return res;
  }

  get(path: string) {
    return this.go(path);
  }

  post(path: string, form: Record<string, string>) {
    return this.go(path, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
  }

  /** Follows one redirect. */
  async follow(res: Response): Promise<Response> {
    const loc = res.headers.get("location");
    if (!loc) throw new Error(`no redirect (HTTP ${res.status})`);
    return this.get(loc);
  }
}

export const csrfIn = (html: string) => /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? "";
export const navIn = (html: string) => [...html.matchAll(/<a href="([^"]+)"[^>]*data-app="([^"]+)"/g)].map((m) => `${m[2]}:${m[1]}`);
