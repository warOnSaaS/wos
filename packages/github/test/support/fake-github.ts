/**
 * A fake GitHub for tests: a `fetch` implementation that serves the REST, GraphQL and OAuth
 * endpoints the wOS App uses, backed by a real content-addressed git object store (SHA-1 over
 * canonical git object encodings), so tree and commit ids equal what `git` computes.
 *
 * Response shapes follow the GitHub REST docs. It is NOT a recording of the live API: there is no
 * wOS App yet. The request sequence the App sends is recorded against golden files in ../fixtures.
 * App requests must carry a valid RS256 JWT for the configured App id; installation requests a
 * token minted by /app/installations/{id}/access_tokens.
 */
import { execFileSync } from "node:child_process";
import { createHash, createPublicKey, verify as verifySig } from "node:crypto";

export type ObjType = "blob" | "tree" | "commit";
interface Obj {
  type: ObjType;
  raw: Buffer;
}
type TreeEntry = { mode: string; name: string; sha: string };
type Dir = Map<string, { mode: string; sha: string; dir?: Dir }>;

export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  auth: "jwt" | "installation" | "user" | "basic" | "none";
}

export interface FakePull {
  number: number;
  node_id: string;
  head: string;
  base: string;
  title: string;
  body: string;
  draft: boolean;
  state: "open" | "closed";
  locked: boolean;
  labels: string[];
  comments: string[];
  auto_merge: boolean;
  enqueued: boolean;
  maintainer_can_modify: boolean;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function hashObject(type: ObjType, content: Buffer): string {
  return createHash("sha1")
    .update(Buffer.concat([Buffer.from(`${type} ${content.length}\0`), content]))
    .digest("hex");
}

function gitNameKey(e: { name: string; mode: string }): string {
  return e.mode === "40000" ? `${e.name}/` : e.name;
}

export class FakeGithub {
  readonly objects = new Map<string, Obj>();
  readonly refs = new Map<string, Map<string, string>>();
  readonly requests: RecordedRequest[] = [];
  readonly pulls = new Map<string, FakePull[]>();
  readonly statuses: Array<{ repo: string; sha: string; state: string; context: string; description: string; target_url?: string }> = [];
  readonly issues: Array<{ repo: string; number: number; title: string; body: string; labels: string[] }> = [];
  readonly graphqlCalls: Array<{ query: string; variables: Record<string, unknown> }> = [];
  readonly revokedTokens: string[] = [];
  readonly installations = new Map<string, number>();
  /** Scripted OAuth token endpoint responses, consumed in order. */
  readonly oauthQueue: Array<Record<string, unknown>> = [];
  users = new Map<string, { id: number; login: string; created_at: string; avatar_url: string | null }>();
  /** Force a failure on the next request matching `method path-prefix`. */
  readonly failNext: Array<{ method: string; pathPrefix: string; status: number; message: string }> = [];
  /** When set, GraphQL enablePullRequestAutoMerge answers with this error message. */
  autoMergeError: string | null = null;
  /** When true, recursive tree listings report truncated: true (forces the walk fallback). */
  truncateTrees = false;
  private tokens = new Map<string, number>();
  private nextNumber = 1;
  private readonly publicKey;

  constructor(
    private readonly opts: {
      appId: string;
      publicKeyPem: string;
      clientId: string;
      clientSecret: string;
      apiBase: string;
      oauthBase: string;
    },
  ) {
    this.publicKey = createPublicKey(opts.publicKeyPem);
  }

  // ---- object store --------------------------------------------------------------------------

  put(type: ObjType, raw: Buffer): string {
    const sha = hashObject(type, raw);
    this.objects.set(sha, { type, raw });
    return sha;
  }

  get(sha: string, type?: ObjType): Obj {
    const o = this.objects.get(sha);
    if (!o || (type && o.type !== type)) throw new HttpError(404, `No ${type ?? "object"} found for sha ${sha}`);
    return o;
  }

  writeTree(entries: TreeEntry[]): string {
    const sorted = [...entries].sort((a, b) => Buffer.compare(Buffer.from(gitNameKey(a)), Buffer.from(gitNameKey(b))));
    const parts = sorted.map((e) => Buffer.concat([Buffer.from(`${e.mode} ${e.name}\0`), Buffer.from(e.sha, "hex")]));
    return this.put("tree", Buffer.concat(parts));
  }

  readTree(sha: string): TreeEntry[] {
    const raw = this.get(sha, "tree").raw;
    const out: TreeEntry[] = [];
    let i = 0;
    while (i < raw.length) {
      const sp = raw.indexOf(0x20, i);
      const nul = raw.indexOf(0, sp);
      out.push({
        mode: raw.subarray(i, sp).toString(),
        name: raw.subarray(sp + 1, nul).toString(),
        sha: raw.subarray(nul + 1, nul + 21).toString("hex"),
      });
      i = nul + 21;
    }
    return out;
  }

  readCommit(sha: string): { tree: string; parents: string[]; author: string; committer: string; message: string } {
    const text = this.get(sha, "commit").raw.toString("utf8");
    const split = text.indexOf("\n\n");
    const headers = text.slice(0, split).split("\n");
    const tree = headers.find((h) => h.startsWith("tree "))!.slice(5);
    const parents = headers.filter((h) => h.startsWith("parent ")).map((h) => h.slice(7));
    const author = headers.find((h) => h.startsWith("author "))!.slice(7);
    const committer = headers.find((h) => h.startsWith("committer "))!.slice(10);
    return { tree, parents, author, committer, message: text.slice(split + 2) };
  }

  /** Flattened `path -> {mode, sha}` of a tree (like `git ls-tree -r`). */
  flatten(treeSha: string, prefix = ""): Map<string, { mode: string; sha: string }> {
    const out = new Map<string, { mode: string; sha: string }>();
    for (const e of this.readTree(treeSha)) {
      const p = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.mode === "40000") for (const [k, v] of this.flatten(e.sha, p)) out.set(k, v);
      else out.set(p, { mode: e.mode, sha: e.sha });
    }
    return out;
  }

  /** Imports every object and branch of a local git repository (the "recorded" upstream state). */
  importGitRepo(dir: string, fullName: string, installationId = 4242): void {
    const out = execFileSync("git", ["-C", dir, "cat-file", "--batch-all-objects", "--batch"], { maxBuffer: 1 << 28 });
    let i = 0;
    while (i < out.length) {
      const nl = out.indexOf(0x0a, i);
      const [sha, type, size] = out.subarray(i, nl).toString().split(" ") as [string, ObjType, string];
      const raw = out.subarray(nl + 1, nl + 1 + Number(size));
      i = nl + 1 + Number(size) + 1;
      if (type !== "blob" && type !== "tree" && type !== "commit") continue;
      const got = this.put(type, Buffer.from(raw));
      if (got !== sha) throw new Error(`fake object store disagrees with git for ${sha}`);
    }
    const refs = execFileSync("git", ["-C", dir, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"], { encoding: "utf8" });
    const map = this.refsOf(fullName);
    for (const line of refs.split("\n").filter(Boolean)) {
      const [ref, sha] = line.split(" ");
      map.set(ref!, sha!);
    }
    this.installations.set(fullName.toLowerCase(), installationId);
  }

  refsOf(fullName: string): Map<string, string> {
    const key = fullName.toLowerCase();
    let m = this.refs.get(key);
    if (!m) {
      m = new Map();
      this.refs.set(key, m);
    }
    return m;
  }

  pullsOf(fullName: string): FakePull[] {
    const key = fullName.toLowerCase();
    let p = this.pulls.get(key);
    if (!p) {
      p = [];
      this.pulls.set(key, p);
    }
    return p;
  }

  private isAncestor(ancestor: string, of: string): boolean {
    const seen = new Set<string>();
    const stack = [of];
    while (stack.length) {
      const s = stack.pop()!;
      if (s === ancestor) return true;
      if (seen.has(s)) continue;
      seen.add(s);
      stack.push(...this.readCommit(s).parents);
    }
    return false;
  }

  private loadDir(treeSha: string | null): Dir {
    const dir: Dir = new Map();
    if (treeSha) for (const e of this.readTree(treeSha)) dir.set(e.name, { mode: e.mode, sha: e.sha });
    return dir;
  }

  private saveDir(dir: Dir): string | null {
    const entries: TreeEntry[] = [];
    for (const [name, e] of dir) {
      if (e.dir) {
        const sha = this.saveDir(e.dir);
        if (sha) entries.push({ mode: "40000", name, sha });
      } else entries.push({ mode: e.mode, name, sha: e.sha });
    }
    if (entries.length === 0) return null;
    return this.writeTree(entries);
  }

  /** POST /git/trees semantics: base_tree plus path entries (nested paths allowed, sha null deletes). */
  createTree(baseTree: string | null, edits: Array<{ path: string; mode: string; type: string; sha: string | null }>): string {
    const root = this.loadDir(baseTree);
    for (const edit of edits) {
      const segs = edit.path.split("/");
      let dir = root;
      for (let i = 0; i < segs.length - 1; i++) {
        const seg = segs[i]!;
        let e = dir.get(seg);
        if (e?.mode !== "40000") {
          if (edit.sha === null) throw new HttpError(422, `GitRPC::BadObjectState: ${edit.path} not in tree`);
          e = { mode: "40000", sha: "", dir: new Map() };
          dir.set(seg, e);
        }
        if (!e.dir) e.dir = this.loadDir(e.sha);
        dir = e.dir;
      }
      const leaf = segs[segs.length - 1]!;
      if (edit.sha === null) {
        if (!dir.has(leaf)) throw new HttpError(422, `GitRPC::BadObjectState: ${edit.path} not in tree`);
        dir.delete(leaf);
      } else {
        if (edit.type === "blob") this.get(edit.sha, "blob");
        dir.set(leaf, { mode: edit.mode, sha: edit.sha });
      }
    }
    return this.saveDir(root) ?? this.writeTree([]);
  }

  // ---- HTTP ----------------------------------------------------------------------------------

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const rawBody = typeof init?.body === "string" ? init.body : init?.body ? String(init.body) : "";
    let body: unknown = null;
    if (rawBody) {
      const ct = headers.get("content-type") ?? "";
      body = ct.includes("x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(rawBody)) : JSON.parse(rawBody);
    }
    const path = url.pathname
      .split("/")
      .map((s) => decodeURIComponent(s))
      .join("/");
    const query = Object.fromEntries(url.searchParams);
    try {
      if (url.origin === this.opts.oauthBase) return this.json(200, this.oauth(path, body as Record<string, string>));
      if (url.origin !== this.opts.apiBase) throw new Error(`fake GitHub: unexpected host ${url.origin} (no live network in tests)`);
      const auth = this.authenticate(headers.get("authorization"));
      this.requests.push({ method, path, query, body, auth: auth.kind });
      const fail = this.failNext.findIndex((f) => f.method === method && path.startsWith(f.pathPrefix));
      if (fail !== -1) {
        const f = this.failNext.splice(fail, 1)[0]!;
        throw new HttpError(f.status, f.message);
      }
      const { status, data } = this.route(method, path, query, body, auth);
      return this.json(status, data);
    } catch (e) {
      if (e instanceof HttpError) return this.json(e.status, { message: e.message, documentation_url: "https://docs.github.com/rest" });
      throw e;
    }
  };

  private json(status: number, data: unknown): Response {
    if (status === 204) return new Response(null, { status });
    return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
  }

  private authenticate(h: string | null): { kind: RecordedRequest["auth"]; installationId?: number; token?: string } {
    if (!h) return { kind: "none" };
    const [scheme, value] = h.split(" ") as [string, string];
    if (/^bearer$/i.test(scheme) && value.split(".").length === 3) {
      const [hd, pl, sig] = value.split(".") as [string, string, string];
      const ok = verifySig("RSA-SHA256", Buffer.from(`${hd}.${pl}`), this.publicKey, Buffer.from(sig, "base64url"));
      const payload = JSON.parse(Buffer.from(pl, "base64url").toString()) as { iss: string | number; exp: number };
      if (!ok || String(payload.iss) !== this.opts.appId || payload.exp * 1000 < Date.now())
        throw new HttpError(401, "A JSON web token could not be decoded");
      return { kind: "jwt" };
    }
    if (/^basic$/i.test(scheme)) {
      const [id, secret] = Buffer.from(value, "base64").toString().split(":");
      if (id !== this.opts.clientId || secret !== this.opts.clientSecret) throw new HttpError(401, "Bad credentials");
      return { kind: "basic" };
    }
    const inst = this.tokens.get(value);
    if (inst !== undefined) return { kind: "installation", installationId: inst, token: value };
    if (value.startsWith("ghu_")) return { kind: "user", token: value };
    throw new HttpError(401, "Bad credentials");
  }

  private requireInstallation(auth: { kind: string; installationId?: number }, owner: string, repo: string): string {
    const full = `${owner}/${repo}`.toLowerCase();
    if (auth.kind !== "installation" || this.installations.get(full) !== auth.installationId) {
      throw new HttpError(auth.kind === "none" ? 401 : 404, "Not Found");
    }
    return full;
  }

  private commitJson(sha: string) {
    const c = this.readCommit(sha);
    const person = (s: string) => {
      const m = /^(.*) <(.*)> (\d+) ([+-]\d{4})$/.exec(s)!;
      return { name: m[1], email: m[2], date: new Date(Number(m[3]) * 1000).toISOString().replace(".000Z", "Z") };
    };
    return {
      sha,
      node_id: `C_${sha.slice(0, 12)}`,
      tree: { sha: c.tree, url: `${this.opts.apiBase}/git/trees/${c.tree}` },
      parents: c.parents.map((p) => ({ sha: p, url: "", html_url: "" })),
      message: c.message,
      author: person(c.author),
      committer: person(c.committer),
      verification: { verified: false, reason: "unsigned", signature: null, payload: null },
    };
  }

  private route(
    method: string,
    path: string,
    query: Record<string, string>,
    body: unknown,
    auth: { kind: RecordedRequest["auth"]; installationId?: number; token?: string },
  ): { status: number; data: unknown } {
    const b = (body ?? {}) as Record<string, unknown>;
    let m: RegExpExecArray | null;

    m = method === "GET" ? /^\/repos\/([^/]+)\/([^/]+)\/installation$/.exec(path) : null;
    if (m) {
      if (auth.kind !== "jwt") throw new HttpError(401, "requires JWT");
      const id = this.installations.get(`${m[1]}/${m[2]}`.toLowerCase());
      if (id === undefined) throw new HttpError(404, "Not Found");
      return { status: 200, data: { id, app_id: Number(this.opts.appId), account: { login: m[1] }, target_type: "Organization" } };
    }
    m = method === "POST" ? /^\/app\/installations\/(\d+)\/access_tokens$/.exec(path) : null;
    if (m) {
      if (auth.kind !== "jwt") throw new HttpError(401, "requires JWT");
      const token = `ghs_fake${this.tokens.size + 1}`;
      this.tokens.set(token, Number(m[1]));
      return {
        status: 201,
        data: {
          token,
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
          permissions: { contents: "write", pull_requests: "write", statuses: "write", issues: "write" },
          repository_selection: "selected",
        },
      };
    }
    if (method === "GET" && path === "/user") {
      if (auth.kind !== "user") throw new HttpError(401, "Requires authentication");
      const u = this.users.get(auth.token!);
      if (!u) throw new HttpError(401, "Bad credentials");
      return { status: 200, data: { ...u, type: "User" } };
    }
    m = method === "DELETE" ? /^\/applications\/([^/]+)\/token$/.exec(path) : null;
    if (m) {
      if (auth.kind !== "basic") throw new HttpError(404, "Not Found");
      this.revokedTokens.push(String(b.access_token));
      this.users.delete(String(b.access_token));
      return { status: 204, data: null };
    }
    if (method === "POST" && path === "/graphql") {
      if (auth.kind !== "installation") throw new HttpError(401, "Bad credentials");
      const q = String(b.query);
      const vars = (b.variables ?? {}) as Record<string, unknown>;
      this.graphqlCalls.push({ query: q, variables: vars });
      const pr = [...this.pulls.values()].flat().find((p) => p.node_id === vars.pullRequestId);
      if (!pr) return { status: 200, data: { data: null, errors: [{ type: "NOT_FOUND", message: "Could not resolve to a node" }] } };
      if (q.includes("enablePullRequestAutoMerge")) {
        if (this.autoMergeError) return { status: 200, data: { data: null, errors: [{ message: this.autoMergeError }] } };
        pr.auto_merge = true;
        return { status: 200, data: { data: { enablePullRequestAutoMerge: { clientMutationId: null } } } };
      }
      if (q.includes("enqueuePullRequest")) {
        pr.enqueued = true;
        return { status: 200, data: { data: { enqueuePullRequest: { clientMutationId: null } } } };
      }
      throw new HttpError(400, "unsupported query");
    }

    m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)$/.exec(path);
    if (!m) throw new HttpError(404, "Not Found");
    const full = this.requireInstallation(auth, m[1]!, m[2]!);
    const rest = m[3]!;
    const refs = this.refsOf(full);

    m = method === "GET" ? /^\/git\/commits\/([0-9a-f]{40})$/.exec(rest) : null;
    if (m) return { status: 200, data: this.commitJson(m[1]!) };
    if (method === "POST" && rest === "/git/blobs") {
      const content = b.encoding === "base64" ? Buffer.from(String(b.content), "base64") : Buffer.from(String(b.content), "utf8");
      const sha = this.put("blob", content);
      return { status: 201, data: { sha, url: `${this.opts.apiBase}/repos/${full}/git/blobs/${sha}` } };
    }
    if (method === "POST" && rest === "/git/trees") {
      const tree = b.tree as Array<{ path: string; mode: string; type: string; sha: string | null }>;
      for (const e of tree) {
        if (!["100644", "100755", "040000", "160000", "120000"].includes(e.mode))
          throw new HttpError(422, `Invalid tree info: mode ${e.mode}`);
        if (e.path.startsWith(".github/workflows/")) {
          throw new HttpError(403, "refusing to allow a GitHub App to create or update workflow without `workflows` permission");
        }
      }
      const sha = this.createTree((b.base_tree as string | undefined) ?? null, tree);
      return {
        status: 201,
        data: {
          sha,
          url: "",
          tree: this.readTree(sha).map((e) => ({ path: e.name, mode: e.mode, type: e.mode === "40000" ? "tree" : "blob", sha: e.sha })),
          truncated: false,
        },
      };
    }
    m = method === "GET" ? /^\/git\/trees\/([0-9a-f]{40})$/.exec(rest) : null;
    if (m) {
      let treeSha = m[1]!;
      const o = this.get(treeSha);
      if (o.type === "commit") treeSha = this.readCommit(treeSha).tree;
      const entries: Array<{ path: string; mode: string; type: string; sha: string }> = [];
      const walk = (sha: string, prefix: string, recursive: boolean) => {
        for (const e of this.readTree(sha)) {
          const p = prefix ? `${prefix}/${e.name}` : e.name;
          const type = e.mode === "40000" ? "tree" : e.mode === "160000" ? "commit" : "blob";
          entries.push({ path: p, mode: e.mode === "40000" ? "040000" : e.mode, type, sha: e.sha });
          if (recursive && type === "tree") walk(e.sha, p, true);
        }
      };
      const recursive = query.recursive !== undefined && !this.truncateTrees;
      walk(treeSha, "", recursive);
      return {
        status: 200,
        data: { sha: treeSha, url: "", tree: entries, truncated: query.recursive !== undefined && this.truncateTrees },
      };
    }
    if (method === "POST" && rest === "/git/commits") {
      const parents = (b.parents as string[]) ?? [];
      for (const p of parents) this.get(p, "commit");
      this.get(String(b.tree), "tree");
      const a = (b.author ?? { name: "waronsaas-wos[bot]", email: "bot@example.invalid" }) as {
        name: string;
        email: string;
        date?: string;
      };
      const c = (b.committer ?? a) as { name: string; email: string; date?: string };
      const stamp = (d?: string) => `${Math.floor((d ? Date.parse(d) : Date.now()) / 1000)} +0000`;
      const text = [
        `tree ${b.tree}`,
        ...parents.map((p) => `parent ${p}`),
        `author ${a.name} <${a.email}> ${stamp(a.date)}`,
        `committer ${c.name} <${c.email}> ${stamp(c.date)}`,
        "",
        String(b.message),
      ].join("\n");
      const sha = this.put("commit", Buffer.from(text, "utf8"));
      return { status: 201, data: this.commitJson(sha) };
    }
    m = method === "GET" ? /^\/git\/ref\/(heads\/.+)$/.exec(rest) : null;
    if (m) {
      const sha = refs.get(`refs/${m[1]}`);
      if (!sha) throw new HttpError(404, "Not Found");
      return { status: 200, data: { ref: `refs/${m[1]}`, node_id: "REF", url: "", object: { sha, type: "commit", url: "" } } };
    }
    if (method === "POST" && rest === "/git/refs") {
      const ref = String(b.ref);
      if (!ref.startsWith("refs/heads/")) throw new HttpError(422, "Reference name must start with refs/");
      if (refs.has(ref)) throw new HttpError(422, "Reference already exists");
      this.get(String(b.sha), "commit");
      refs.set(ref, String(b.sha));
      return { status: 201, data: { ref, node_id: "REF", url: "", object: { sha: b.sha, type: "commit", url: "" } } };
    }
    m = method === "PATCH" ? /^\/git\/refs\/(heads\/.+)$/.exec(rest) : null;
    if (m) {
      const ref = `refs/${m[1]}`;
      const cur = refs.get(ref);
      if (!cur) throw new HttpError(422, "Reference does not exist");
      const next = String(b.sha);
      this.get(next, "commit");
      if (!b.force && !this.isAncestor(cur, next)) throw new HttpError(422, "Update is not a fast forward");
      refs.set(ref, next);
      return { status: 200, data: { ref, node_id: "REF", url: "", object: { sha: next, type: "commit", url: "" } } };
    }
    m = method === "DELETE" ? /^\/git\/refs\/(heads\/.+)$/.exec(rest) : null;
    if (m) {
      const ref = `refs/${m[1]}`;
      if (!refs.delete(ref)) throw new HttpError(422, "Reference does not exist");
      return { status: 204, data: null };
    }
    if (method === "POST" && rest === "/pulls") {
      const head = String(b.head);
      const base = String(b.base);
      if (!refs.has(`refs/heads/${head}`)) throw new HttpError(422, "Validation Failed: head invalid");
      const pulls = this.pullsOf(full);
      if (pulls.some((p) => p.head === head && p.base === base && p.state === "open")) {
        throw new HttpError(422, `Validation Failed: A pull request already exists for ${m ? full.split("/")[0] : ""}:${head}.`);
      }
      const n = this.nextNumber++;
      const pr: FakePull = {
        number: n,
        node_id: `PR_node${n}`,
        head,
        base,
        title: String(b.title),
        body: String(b.body ?? ""),
        draft: Boolean(b.draft),
        state: "open",
        locked: false,
        labels: [],
        comments: [],
        auto_merge: false,
        enqueued: false,
        maintainer_can_modify: Boolean(b.maintainer_can_modify),
      };
      pulls.push(pr);
      return { status: 201, data: this.pullJson(full, pr) };
    }
    if (method === "GET" && rest === "/pulls") {
      const [, headBranch] = (query.head ?? ":").split(":");
      const list = this.pullsOf(full).filter((p) => (!query.head || p.head === headBranch) && (!query.state || p.state === query.state));
      return { status: 200, data: list.map((p) => this.pullJson(full, p)) };
    }
    m = /^\/pulls\/(\d+)$/.exec(rest);
    if (m) {
      const pr = this.pullsOf(full).find((p) => p.number === Number(m![1]));
      if (!pr) throw new HttpError(404, "Not Found");
      if (method === "PATCH") {
        if (typeof b.body === "string") pr.body = b.body;
        if (b.state === "closed") pr.state = "closed";
      }
      return { status: 200, data: this.pullJson(full, pr) };
    }
    m = /^\/issues\/(\d+)\/(labels|comments|lock)$/.exec(rest);
    if (m) {
      const n = Number(m[1]);
      const pr = this.pullsOf(full).find((p) => p.number === n);
      const issue = this.issues.find((i) => i.repo === full && i.number === n);
      if (!pr && !issue) throw new HttpError(404, "Not Found");
      if (m[2] === "labels") {
        const labels = b.labels as string[];
        if (pr) pr.labels.push(...labels);
        return { status: 200, data: labels.map((name) => ({ name })) };
      }
      if (m[2] === "comments") {
        pr?.comments.push(String(b.body));
        return { status: 201, data: { id: 1, body: b.body } };
      }
      if (pr) pr.locked = true;
      return { status: 204, data: null };
    }
    m = method === "POST" ? /^\/statuses\/([0-9a-f]{40})$/.exec(rest) : null;
    if (m) {
      this.get(m[1]!, "commit");
      const description = String(b.description ?? "");
      if (description.length > 140) throw new HttpError(422, "description is too long (maximum is 140 characters)");
      this.statuses.push({
        repo: full,
        sha: m[1]!,
        state: String(b.state),
        context: String(b.context),
        description,
        target_url: b.target_url as string | undefined,
      });
      return { status: 201, data: { id: this.statuses.length, state: b.state, context: b.context } };
    }
    if (method === "POST" && rest === "/issues") {
      const n = this.nextNumber++;
      this.issues.push({ repo: full, number: n, title: String(b.title), body: String(b.body ?? ""), labels: (b.labels as string[]) ?? [] });
      return { status: 201, data: { number: n, html_url: `https://github.com/${full}/issues/${n}`, title: b.title } };
    }
    throw new HttpError(404, `fake GitHub: no route for ${method} ${path}`);
  }

  private pullJson(full: string, pr: FakePull) {
    const [owner] = full.split("/");
    return {
      number: pr.number,
      node_id: pr.node_id,
      html_url: `https://github.com/${full}/pull/${pr.number}`,
      state: pr.state,
      locked: pr.locked,
      title: pr.title,
      body: pr.body,
      draft: pr.draft,
      auto_merge: pr.auto_merge ? { merge_method: "merge" } : null,
      head: { ref: pr.head, label: `${owner}:${pr.head}`, sha: this.refsOf(full).get(`refs/heads/${pr.head}`) ?? null },
      base: { ref: pr.base, label: `${owner}:${pr.base}` },
      user: { login: "waronsaas-wos[bot]", type: "Bot" },
      labels: pr.labels.map((name) => ({ name })),
    };
  }

  private oauth(path: string, body: Record<string, string>): Record<string, unknown> {
    if (path === "/login/device/code") {
      if (body.client_id !== this.opts.clientId) return { error: "invalid_client" };
      return {
        device_code: "dc_fake_1",
        user_code: "WOS1-2345",
        verification_uri: "https://github.com/login/device",
        expires_in: 899,
        interval: 5,
      };
    }
    if (path === "/login/oauth/access_token") {
      if (body.client_id !== this.opts.clientId) return { error: "incorrect_client_credentials" };
      if (body.code !== undefined && body.client_secret !== this.opts.clientSecret) return { error: "incorrect_client_credentials" };
      const next = this.oauthQueue.shift();
      if (!next) return { error: "authorization_pending" };
      return next;
    }
    throw new HttpError(404, "Not Found");
  }
}
