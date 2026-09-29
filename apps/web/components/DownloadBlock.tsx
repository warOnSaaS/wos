import { CLI, DOWNLOADS, PREREQUISITES } from "@/lib/site";

/** Desktop buttons, CLI and prerequisites. Used on / and /download. */
export function DownloadBlock({ headingLevel = 3 }: { headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="download">
      <div className="download__col">
        <H className="h3">wOS Desktop</H>
        <p>The desktop app. Pick a target, a feature and a task, then press BUILD.</p>
        <ul className="dl-buttons">
          {DOWNLOADS.map((d) => (
            <li key={d.os}>
              <a className="btn" href={d.href}>
                {d.label}
                <span className="btn__sub">{d.file}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
      <div className="download__col">
        <H className="h3">Or use the command line</H>
        <p>Install the wos CLI with npm:</p>
        <pre className="code"><code>{CLI.install}</code></pre>
        <p>Then:</p>
        <dl className="cmds">
          {CLI.commands.map((c) => (
            <div key={c.cmd}>
              <dt><code>{c.cmd}</code></dt>
              <dd>{c.what}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="download__col">
        <H className="h3">Before you start</H>
        <p>You will need:</p>
        <ul className="checklist">
          {PREREQUISITES.map((p) => (
            <li key={p.name}>
              <a href={p.href}>{p.name}</a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
