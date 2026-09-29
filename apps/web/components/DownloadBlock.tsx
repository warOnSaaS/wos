import { CLI, DOWNLOADS, PREREQUISITES, SIGN_IN } from "@/lib/site";

/** Equipment: desktop builds, CLI, requirements. Used on / and /download. */
export function DownloadBlock() {
  return (
    <div className="equip">
      <div>
        <h3>wOS Desktop</h3>
        <p>Pick a target, a feature and a task. Press BUILD.</p>
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
        <h3>wOS CLI</h3>
        <p>Install with npm.</p>
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
        <h3>Requirements</h3>
        <p>{SIGN_IN}</p>
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
