import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { TOKEN_DISCLAIMER } from "@/lib/site";
import { Section } from "@/components/Section";

export const metadata = pageMetadata({
  title: "Leaderboard",
  description:
    "The warOnSaaS contributor leaderboard, ranked by accepted work. No accepted contributions yet: the war starts at zero.",
  path: "/leaderboard",
});

export default function Leaderboard() {
  return (
    <>
      <div className="title">
        <p className="label">LEADERBOARD // RANKED BY ACCEPTED WORK</p>
        <h1>Leaderboard</h1>
        <p>Contributors are ranked by WOS tokens earned for accepted work.</p>
      </div>

      <Section n="01" title="RANKINGS" id="rankings" aside="ENTRIES: 0">
        <div className="empty">
          <strong>No accepted contributions yet</strong>
          <p>Nothing has been merged. The board is empty. The first accepted roadmap change, contract, review or build unit takes rank 1.</p>
        </div>
        <div className="cmds-row">
          <Link className="cmd" href="/contribute">HOW TO CONTRIBUTE</Link>
          <Link className="cmd" href="/how-it-works">PROCEDURE</Link>
        </div>
        <p className="fine">{TOKEN_DISCLAIMER} They are not cryptocurrency and cannot be transferred or sold.</p>
      </Section>
    </>
  );
}
