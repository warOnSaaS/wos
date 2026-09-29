import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { TOKEN_DISCLAIMER } from "@/lib/site";

export const metadata = pageMetadata({
  title: "Leaderboard",
  description:
    "The warOnSaaS contributor leaderboard, ranked by accepted work. No accepted contributions yet: the war starts at zero.",
  path: "/leaderboard",
});

export default function Leaderboard() {
  return (
    <>
      <section className="hero" aria-labelledby="h">
        <div className="wrap">
          <p className="kicker">Ranked by accepted work</p>
          <h1 id="h">Leaderboard</h1>
          <p className="lede">Contributors are ranked by the WOS tokens they earn for accepted work.</p>
        </div>
      </section>

      <section className="section" aria-label="Rankings">
        <div className="wrap">
          <div className="empty">
            <p className="empty__big">No accepted contributions yet</p>
            <p>
              Nothing has been merged, so nobody is on the board. The first accepted roadmap change, contract, review
              or build unit will put its author at the top.
            </p>
            <div className="actions">
              <Link className="btn" href="/download">Download wOS</Link>
              <Link className="btn btn--ghost" href="/how-it-works">How it works</Link>
            </div>
          </div>
          <p className="fine" style={{ marginTop: "1.5rem" }}>
            {TOKEN_DISCLAIMER} They are not cryptocurrency and cannot be transferred or sold.
          </p>
        </div>
      </section>
    </>
  );
}
