import Link from "next/link";
import { type CliRelease, cliReleaseLine, INSTALL } from "@/lib/cli-release";
import { CLI, DOWNLOADS, PREREQUISITES, SIGN_IN } from "@/lib/site";

/** Equipment: Desktop (not released), the wos command (release state from GitHub), requirements. Used on / and /download. */
export function DownloadBlock({ release }: { release: CliRelease }) {
  return (
    <div className="equip">
      <div>
        <h3>wOS CLI</h3>
        <p>{cliReleaseLine(release)}</p>
        <pre className="term">
          <code>{INSTALL.unix}</code>
          {"\n"}
          <code>{INSTALL.windows}</code>
        </pre>
        <dl className="clist">
          {CLI.commands.map((c) => (
            <div key={c.cmd}>
              <dt><code>{c.cmd}</code></dt>
              <dd>{c.what}</dd>
            </div>
          ))}
        </dl>
        <p className="fine">
          <Link href="/contribute">How to contribute, step by step</Link>.
        </p>
      </div>
      <div>
        <h3>wOS Desktop</h3>
        <p>Not released yet. It will run the same work with a Build button: pick a target, a feature and a task.</p>
        <ul className="dl">
          {DOWNLOADS.map((d) => (
            <li key={d.os}>
              {d.href ? (
                <a className="cmd" href={d.href}>
                  <span>[ {d.label} ]</span>
                  <span className="dim">{d.file}</span>
                </a>
              ) : (
                <span className="cmd cmd--off">
                  <span>{d.label}</span>
                  <span className="dim">{d.file}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
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
