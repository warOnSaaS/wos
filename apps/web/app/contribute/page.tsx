import Link from "next/link";
import { getCliRelease, INSTALL_PS1_URL, INSTALL_SH_URL } from "@/lib/cli-release";
import { CONTRIBUTE_MD_PATH, CONTRIBUTE_STEPS, contributeStatus } from "@/lib/contribute";
import { pageMetadata } from "@/lib/seo";
import { Section } from "@/components/Section";

export const metadata = pageMetadata({
  title: "How to contribute",
  description:
    "How to contribute to warOnSaaS with the wos command: prerequisites, install, sign in, link GitHub, enable Build, check your machine, pick up work. With an honest status of what works today.",
  path: "/contribute",
});

// The CLI's release state comes from the GitHub API (lib/cli-release.ts), refreshed hourly.
export const revalidate = 3600;

export default async function Contribute() {
  const status = contributeStatus(await getCliRelease());
  return (
    <>
      <div className="title">
        <p className="label">ENLISTMENT // HOW TO CONTRIBUTE</p>
        <h1>How to contribute</h1>
        <p>A few commands in a terminal. Your own AI subscription does the work; wOS hands out the tasks and checks them.</p>
      </div>

      <Section n="01" title="STATUS" id="status">
        <dl className="kv">
          <div>
            <dt>WORKS</dt>
            <dd>{status.works.join(" ")}</dd>
          </div>
          <div>
            <dt>NOT YET</dt>
            <dd>{status.notYet.join(" ")}</dd>
          </div>
        </dl>
      </Section>

      <Section n="02" title="STEPS" id="steps" aside={<a href={CONTRIBUTE_MD_PATH}>FOR AGENTS: CONTRIBUTE.MD</a>}>
        <ol className="proc">
          {CONTRIBUTE_STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="proc__n" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                {s.cmds ? (
                  <pre className="term">
                    {s.cmds.map((c, j) => (
                      <span key={c}>
                        {j ? "\n" : null}
                        <code>{c}</code>
                      </span>
                    ))}
                  </pre>
                ) : null}
                {s.note ? <p className="fine">{s.note}</p> : null}
              </div>
            </li>
          ))}
        </ol>
        <p className="fine">
          Read the install scripts before running them: <a href={INSTALL_SH_URL}>install.sh</a>,{" "}
          <a href={INSTALL_PS1_URL}>install.ps1</a>. Every command explains itself with <code>wos --help</code>.
        </p>
      </Section>

      <Section title="NEXT" id="next">
        <div className="cmds-row">
          <Link className="cmd" href="/how-it-works">HOW IT WORKS</Link>
          <Link className="cmd" href="/faq">FAQ</Link>
          <Link className="cmd" href="/whitepaper">WHITE PAPER</Link>
        </div>
      </Section>
    </>
  );
}
