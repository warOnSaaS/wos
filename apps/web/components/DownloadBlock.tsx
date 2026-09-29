import { CLI, DOWNLOADS, PREREQUISITES, SIGN_IN } from "@/lib/site";

/** Equipment: desktop builds, CLI, prerequisites. Used on / and /download. */
export function DownloadBlock({ headingLevel = 3 }: { headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="equip">
      <div>
        <H className="h3">wOS Desktop</H>
        <p className="dim">Pick a target, a feature and a task. Press BUILD.</p>
        <ul className="dl">
          {DOWNLOADS.map((d) => (
            <li key={d.os}>
              <a className="cmd" href={d.href}>
                <span>[ {d.label} ]</span>
                <span className="dim">{d.file}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <H className="h3">wos CLI</H>
        <p className="dim">Install with npm:</p>
        <pre className="term"><code>{CLI.install}</code></pre>
        <dl className="clist">
          {CLI.commands.map((c) => (
            <div key={c.cmd}>
              <dt><code>{c.cmd}</code></dt>
              <dd>{c.what}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div>
        <H className="h3">Requirements</H>
        <p className="dim">{SIGN_IN}</p>
        <ul className="checks">
          {PREREQUISITES.map((p) => (
            <li key={p.name}>
              <span>{p.href ? <a href={p.href}>{p.name}</a> : p.name}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
