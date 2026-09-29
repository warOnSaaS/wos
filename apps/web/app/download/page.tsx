import Link from "next/link";
import { pageMetadata, desktopAppLd } from "@/lib/seo";
import { DownloadBlock } from "@/components/DownloadBlock";
import { Section } from "@/components/Section";
import { JsonLd } from "@/components/JsonLd";
import { CLI, TOKEN_DISCLAIMER } from "@/lib/site";

export const metadata = pageMetadata({
  title: "Download wOS Desktop and the wOS CLI",
  description:
    "Download wOS Desktop for macOS, Windows or Linux, or install the wOS CLI with npm. Sign in with your email; link GitHub to contribute.",
  path: "/download",
});

export default function Download() {
  return (
    <>
      <div className="title">
        <p className="label">EQUIPMENT // wOS</p>
        <h1>Download wOS</h1>
        <p>
          wOS is the build tool. Pick a target, a feature and a task. Press BUILD. Your local Claude Code does the work
          under wOS’s checks.
        </p>
      </div>

      <Section n="01" title="EQUIPMENT" id="equipment">
        <DownloadBlock />
      </Section>

      <Section n="02" title="SETUP" id="setup">
        <ol className="proc">
          <li>
            <span className="proc__n" aria-hidden="true">01</span>
            <div>
              <h3>Install wOS</h3>
              <p>
                Download wOS Desktop for your system, or run <code>{CLI.install}</code>.
              </p>
            </div>
          </li>
          <li>
            <span className="proc__n" aria-hidden="true">02</span>
            <div>
              <h3>Sign in</h3>
              <p>
                Sign in with your email (<code>wos login</code>). A magic link is sent to you. No GitHub account is needed
                to sign in.
              </p>
            </div>
          </li>
          <li>
            <span className="proc__n" aria-hidden="true">03</span>
            <div>
              <h3>Link GitHub to contribute</h3>
              <p>To contribute (build, review, propose), link a GitHub account.</p>
            </div>
          </li>
          <li>
            <span className="proc__n" aria-hidden="true">04</span>
            <div>
              <h3>Install the build tools</h3>
              <p>
                Claude Code, signed in with a Claude subscription. The Codex CLI, signed in with ChatGPT, for reviews.
                git. Check with <code>wos status</code>.
              </p>
            </div>
          </li>
          <li>
            <span className="proc__n" aria-hidden="true">05</span>
            <div>
              <h3>Build</h3>
              <p>
                Desktop: pick a target, a feature and a task, press BUILD. CLI: <code>wos build &lt;task-id&gt;</code>.
                Accepted work earns WOS tokens. {TOKEN_DISCLAIMER}
              </p>
            </div>
          </li>
        </ol>
        <p className="fine">
          The AI runs on your machine with your own Claude and ChatGPT sign-ins. <Link href="/how-it-works">Procedure</Link>.
        </p>
      </Section>

      <JsonLd data={desktopAppLd} />
    </>
  );
}
