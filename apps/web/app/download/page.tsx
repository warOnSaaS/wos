import Link from "next/link";
import { pageMetadata, desktopAppLd } from "@/lib/seo";
import { DownloadBlock } from "@/components/DownloadBlock";
import { JsonLd } from "@/components/JsonLd";
import { TOKEN_DISCLAIMER } from "@/lib/site";

export const metadata = pageMetadata({
  title: "Download wOS Desktop and the wos CLI",
  description:
    "Download wOS Desktop for macOS, Windows or Linux, or install the wos command-line tool with npm, and start building open-source replacements for rented software.",
  path: "/download",
});

export default function Download() {
  return (
    <>
      <section className="hero" aria-labelledby="h">
        <div className="wrap">
          <p className="kicker">Join the build</p>
          <h1 id="h">Download wOS</h1>
          <p className="lede">
            wOS is the app you build with. Pick a target, a feature and a task, press BUILD, and the Claude Code on
            your computer does the work under wOS’s checks.
          </p>
        </div>
      </section>

      <section className="section" aria-label="Downloads">
        <div className="wrap">
          <DownloadBlock headingLevel={2} />
        </div>
      </section>

      <section className="section" aria-labelledby="setup-h">
        <div className="wrap">
          <h2 id="setup-h">Getting set up</h2>
          <ol className="steps">
            <li className="step">
              <span className="step__num" aria-hidden="true">1</span>
              <div>
                <h3 className="step__title">Install the tools</h3>
                <p>
                  Create a GitHub account if you do not have one. Install Claude Code and sign in with your Claude
                  subscription. Install the Codex CLI and sign in with ChatGPT; it is used for reviews. Install git.
                </p>
              </div>
            </li>
            <li className="step">
              <span className="step__num" aria-hidden="true">2</span>
              <div>
                <h3 className="step__title">Install wOS</h3>
                <p>
                  Download wOS Desktop for your computer, or install the command-line tool with{" "}
                  <code>npm install -g @waronsaas/cli</code>.
                </p>
              </div>
            </li>
            <li className="step">
              <span className="step__num" aria-hidden="true">3</span>
              <div>
                <h3 className="step__title">Sign in and check</h3>
                <p>
                  Sign in with GitHub (<code>wos login</code>), then check that everything is ready (
                  <code>wos status</code>).
                </p>
              </div>
            </li>
            <li className="step">
              <span className="step__num" aria-hidden="true">4</span>
              <div>
                <h3 className="step__title">Pick a task and build</h3>
                <p>
                  In the desktop app, pick a target, a feature and a task, and press BUILD. On the command line, run{" "}
                  <code>wos build &lt;task-id&gt;</code>. Accepted work earns WOS tokens. {TOKEN_DISCLAIMER}
                </p>
              </div>
            </li>
          </ol>
          <p className="fine" style={{ marginTop: "1.5rem" }}>
            wOS uses your own Claude and ChatGPT subscriptions; the AI runs on your computer with your sign-in. See{" "}
            <Link href="/how-it-works">how it works</Link> for what happens after you press BUILD.
          </p>
        </div>
      </section>

      <JsonLd data={desktopAppLd} />
    </>
  );
}
