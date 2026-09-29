/** Small presentational pieces of the warOnSaaS console look. No colour: state is words and weight. */
import type { ReactNode } from "react";
import { bar, pct } from "../lib/format.js";

export function Bar({ bp, cells = 10 }: { bp: number | null | undefined; cells?: number }) {
  return (
    <span className="bar">
      <span className="bar__track" aria-hidden="true">
        {bar(bp, cells)}
      </span>{" "}
      <span className="bar__val">{pct(bp).padStart(7, " ")}</span>
    </span>
  );
}

export function Section({ n, title, aside, children }: { n?: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="sec">
      <div className="sec-h">
        <h2>
          {n ? <span className="n">{n}</span> : null}
          {title}
        </h2>
        {aside ? <span className="label">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty" data-empty="true">
      <h3>{title}</h3>
      {children ? <div className="dim">{children}</div> : null}
    </div>
  );
}

export function Title({ label, title, children }: { label: string; title: string; children?: ReactNode }) {
  return (
    <header className="title">
      <div className="label">{label}</div>
      <h1>{title}</h1>
      {children}
    </header>
  );
}

export function Crumbs({ items }: { items: Array<{ label: string; onClick?: () => void }> }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {items.map((it, i) => (
        <span key={it.label}>
          {i > 0 ? <span aria-hidden="true">/ </span> : null}
          {it.onClick ? (
            <button type="button" onClick={it.onClick}>
              {it.label}
            </button>
          ) : (
            <span>{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function KV({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Cells({ rows, text = false }: { rows: Array<[string, ReactNode]>; text?: boolean }) {
  return (
    <dl className={text ? "cells cells--text" : "cells"}>
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Notice({ label, children, quiet = false }: { label: string; children: ReactNode; quiet?: boolean }) {
  return (
    <div className={quiet ? "notice notice--quiet" : "notice"} role={quiet ? undefined : "alert"}>
      <span className="label">{label}</span>
      {children}
    </div>
  );
}

export function Loading({ what }: { what: string }) {
  return <p className="dim">LOADING {what}...</p>;
}
