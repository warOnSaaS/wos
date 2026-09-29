import Link from "next/link";
import { targets } from "@/data/targets";
import { ABOUT } from "@/lib/content";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "About",
  description:
    "The warOnSaaS mission: open-source, self-hostable replacements for the biggest rented business software, built in public, one feature at a time.",
  path: "/about",
});

export default function About() {
  return (
    <>
      <section className="hero" aria-labelledby="h">
        <div className="wrap">
          <p className="kicker">The mission</p>
          <h1 id="h">Own your software</h1>
          <p className="lede">{ABOUT.mission}</p>
        </div>
      </section>

      <section className="section" aria-labelledby="why-h">
        <div className="wrap grid-2">
          <div>
            <h2 id="why-h">Why now</h2>
            <ul className="covers">
              {ABOUT.why.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
          <div>
            <h2>How we work</h2>
            <p>{ABOUT.how}</p>
            <p>{ABOUT.selfHost}</p>
            <p>
              <Link href="/how-it-works">The full process</Link>
            </p>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="zero-h">
        <div className="wrap grid-2">
          <div>
            <h2 id="zero-h">Where we are</h2>
            <p>{ABOUT.zero}</p>
          </div>
          <div className="panel">
            <p>
              <strong>First ten targets:</strong>{" "}
              {targets.map((t, i) => (
                <span key={t.slug}>
                  <Link href={`/targets/${t.slug}`}>{t.name}</Link>
                  {i < targets.length - 1 ? ", " : "."}
                </span>
              ))}
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
