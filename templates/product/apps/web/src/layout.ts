/**
 * The wOS Web shell's HTML: monochrome operations console, one monospace face (JetBrains Mono), the `wOS` mark in
 * Geist Mono Bold, off-white on #0b0b0b. No colour, no italic, square corners, labels written in capitals in the
 * source (no text-transform), so warOnSaaS and wOS are never re-cased.
 */
import { ACTIVE_APPS_REFRESH_SECONDS } from "../../../modules/core-contracts/src/index.js";
import type { NavItem } from "../../../modules/core/src/navigation.js";
import { escapeHtml as e } from "../../../modules/core/src/html.js";

export const CSS = `
:root{--bg:#0b0b0b;--fg:#ededea;--body:#d9d9d6;--dim:#a8a8a5;--rule:#3d3d3b;--cell:#141414;color-scheme:dark}
*,*::before,*::after{box-sizing:border-box;border-radius:0!important;box-shadow:none!important;font-style:normal!important}
html,body{margin:0;background:var(--bg);color:var(--body);font:15px/1.6 "JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace}
a{color:var(--fg)}
h1,h2,.mark,.big{font-family:"Geist Mono",ui-monospace,monospace;font-weight:700;color:var(--fg)}
h1{font-size:1.6rem;margin:0 0 .25rem}h2{font-size:1rem;margin:2rem 0 .5rem}
header{display:flex;gap:1.5rem;align-items:center;padding:.75rem 1.25rem;border-bottom:2px solid var(--fg)}
.mark{font-size:1.4rem;letter-spacing:0;text-decoration:none}
header .env{color:var(--dim)}header form{margin-left:auto}
.frame{display:grid;grid-template-columns:14rem 1fr;min-height:calc(100vh - 3.5rem)}
nav{border-right:1px solid var(--rule);padding:1rem 0}
nav a{display:block;padding:.35rem 1.25rem;text-decoration:none;color:var(--body)}
nav a[aria-current=page]{color:var(--fg);border-left:2px solid var(--fg);padding-left:calc(1.25rem - 2px)}
main{padding:1.5rem 2rem;max-width:64rem}
.dim,.label{color:var(--dim)}.label{margin:0}
.big{font-size:3rem;margin:.25rem 0}
.panel{border:1px solid var(--rule);background:var(--cell);padding:1rem 1.25rem;margin:1rem 0}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:.5rem .75rem;border-bottom:1px solid var(--rule);vertical-align:top}
th{color:var(--dim);font-weight:400}
button,input,select{font:inherit;color:var(--fg);background:var(--bg);border:1px solid var(--fg);padding:.4rem .8rem}
button{cursor:pointer}button:hover{background:var(--fg);color:var(--bg)}
form.inline{display:inline}
.narrow{max-width:32rem;margin:4rem auto;padding:0 1.25rem}
.error{border:1px solid var(--fg);padding:.5rem .75rem}
@media (max-width:720px){.frame{grid-template-columns:1fr}nav{border-right:0;border-bottom:1px solid var(--rule)}}
`;

export const FONTS =
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@700&family=JetBrains+Mono:wght@400;700&display=swap">';

export function csp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}' https://fonts.googleapis.com`,
    "font-src https://fonts.gstatic.com",
    "img-src 'self'",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join("; ");
}

function doc(title: string, nonce: string, inner: string, script = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(title)}</title>${FONTS}<style nonce="${nonce}">${CSS}</style></head><body>${inner}${script}</body></html>`;
}

/** A page outside the signed-in shell (sign-in, errors). */
export function bare(opts: { title: string; nonce: string; envName: string | null; body: string }): string {
  const env = opts.envName ? `<span class="env">${e(opts.envName)}</span>` : "";
  return doc(opts.title, opts.nonce, `<header><a class="mark" href="/">wOS</a>${env}</header><div class="narrow">${opts.body}</div>`);
}

export type ShellOpts = {
  title: string;
  nonce: string;
  envName: string;
  envKind: "cloud" | "self_hosted";
  orgLabel: string;
  nav: NavItem[];
  path: string;
  csrf: string;
  /** Sorted active app ids, compared every 60 s to reload when the set changes. */
  activeKey: string;
  body: string;
};

/** The signed-in shell: header, navigation from the active manifests, the page. */
export function shell(o: ShellOpts): string {
  const nav = o.nav
    .map((n) => {
      const current = o.path === n.route || o.path.startsWith(`${n.route}/`);
      return `<a href="${e(n.route)}"${current ? ' aria-current="page"' : ""} data-app="${e(n.app)}">${e(n.title)}</a>`;
    })
    .join("");
  const kind = o.envKind === "cloud" ? "wOS Cloud" : "Self-hosted";
  const header = `<header><a class="mark" href="/">wOS</a><span class="env">${e(o.envName)} · ${kind} · ${e(o.orgLabel)}</span>
<form method="post" action="/sign-out"><input type="hidden" name="csrf" value="${e(o.csrf)}"><button>SIGN OUT</button></form></header>`;
  // Re-read ActiveApps every 60 s and on focus (ACTIVE_APPS_REFRESH_SECONDS); reload when the set changed.
  const script = `<script nonce="${o.nonce}">(()=>{const k=${JSON.stringify(o.activeKey)};const f=()=>fetch("/core/active.json",{credentials:"same-origin"}).then(r=>r.ok?r.json():null).then(j=>{if(j&&j.key!==k)location.reload()}).catch(()=>{});setInterval(f,${ACTIVE_APPS_REFRESH_SECONDS * 1000});addEventListener("focus",f)})()</script>`;
  return doc(o.title, o.nonce, `${header}<div class="frame"><nav aria-label="Apps">${nav}</nav><main>${o.body}</main></div>`, script);
}
