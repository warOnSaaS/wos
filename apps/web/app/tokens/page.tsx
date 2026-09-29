import Link from "next/link";
import { TOKENS } from "@/lib/content";
import { pageMetadata } from "@/lib/seo";
import { Section } from "@/components/Section";

export const metadata = pageMetadata({
  title: "WOS tokens",
  description:
    "WOS tokens are in-app credits with no cash value, earned per person for accepted work on warOnSaaS: roadmaps, contracts, code, reviews, security work and completion bonuses.",
  path: "/tokens",
});

export default function Tokens() {
  return (
    <>
      <div className="title">
        <p className="label">Tokens // accounting</p>
        <h1>WOS tokens</h1>
        <p>{TOKENS.intro}</p>
      </div>

      <Section n="01" title="Terms" id="terms">
        <p><strong>{TOKENS.disclaimer}</strong></p>
        <p>{TOKENS.notCrypto}</p>
        <p>{TOKENS.rule}</p>
      </Section>

      <Section n="02" title="Earned for" id="earned">
        <dl className="kv">
          {TOKENS.earnedFor.map((e) => (
            <div key={e.what}>
              <dt>{e.what}</dt>
              <dd>{e.how}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section n="03" title="Ledger" id="ledger">
        <p>{TOKENS.balance}</p>
        <Link className="cmd" href="/leaderboard">Leaderboard</Link>
      </Section>
    </>
  );
}
