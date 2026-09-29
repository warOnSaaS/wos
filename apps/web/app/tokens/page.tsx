import Link from "next/link";
import { TOKENS } from "@/lib/content";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "WOS tokens",
  description:
    "WOS tokens are in-app credits with no cash value, earned per person for accepted work on warOnSaaS: roadmaps, contracts, code, reviews, security work and completion bonuses.",
  path: "/tokens",
});

export default function Tokens() {
  return (
    <>
      <section className="hero" aria-labelledby="h">
        <div className="wrap">
          <p className="kicker">Keeping score</p>
          <h1 id="h">WOS tokens</h1>
          <p className="lede">{TOKENS.intro}</p>
          <p className="disclaimer">{TOKENS.disclaimer}</p>
        </div>
      </section>

      <section className="section" aria-labelledby="earn-h">
        <div className="wrap">
          <h2 id="earn-h">What earns tokens</h2>
          <ul className="earn">
            {TOKENS.earnedFor.map((e) => (
              <li key={e.what}>
                <strong>{e.what}</strong>
                <span>{e.how}</span>
              </li>
            ))}
          </ul>
          <p style={{ marginTop: "1.5rem" }}>
            <strong>{TOKENS.rule}</strong>
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="not-h">
        <div className="wrap grid-2">
          <div>
            <h2 id="not-h">What tokens are not</h2>
            <p>{TOKENS.notCrypto}</p>
            <p>{TOKENS.disclaimer}</p>
          </div>
          <div className="panel">
            <p>No tokens have been earned yet, because no work has been accepted yet.</p>
            <p>
              <Link href="/leaderboard">See the leaderboard</Link>
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
