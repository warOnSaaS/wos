import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { DownloadBlock } from "@/components/DownloadBlock";
import { Section } from "@/components/Section";
import { getCliRelease } from "@/lib/cli-release";

export const metadata = pageMetadata({
  title: "Download wOS",
  description:
    "wOS Desktop is not released yet. The wos command installs with one line once its first release is out; the page reads the release state from GitHub. How to contribute: /contribute.",
  path: "/download",
});

// The CLI's release state comes from the GitHub API (lib/cli-release.ts), refreshed hourly.
export const revalidate = 3600;

export default async function Download() {
  const release = await getCliRelease();
  return (
    <>
      <div className="title">
        <p className="label">EQUIPMENT // wOS</p>
        <h1>Download wOS</h1>
        <p>
          wOS is the build tool. It gives your own Claude Code or Codex CLI one small task at a time and checks the
          work. Today it is the wos command; wOS Desktop is not released yet.
        </p>
        <div className="cmds-row">
          <Link className="cmd" href="/contribute">HOW TO CONTRIBUTE</Link>
        </div>
      </div>

      <Section n="01" title="EQUIPMENT" id="equipment">
        <DownloadBlock release={release} />
      </Section>

      <Section n="02" title="SETUP" id="setup">
        <p>
          The steps, with an honest status of what works today, are on <Link href="/contribute">one page</Link>. The AI
          runs on your machine with your own Claude and ChatGPT sign-ins. <Link href="/how-it-works">Procedure</Link>.
        </p>
      </Section>
    </>
  );
}
