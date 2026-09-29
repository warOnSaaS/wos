import Link from "next/link";
import { targets } from "@/data/targets";
import { ABOUT } from "@/lib/content";
import { pageMetadata } from "@/lib/seo";
import { Section } from "@/components/Section";

export const metadata = pageMetadata({
  title: "About",
  description:
    "The warOnSaaS mission: open-source, self-hostable replacements for the biggest rented business software, built in public, one feature at a time.",
  path: "/about",
});

export default function About() {
  return (
    <>
      <div className="title">
        <p className="label">ABOUT // MISSION</p>
        <h1>Mission</h1>
        <p>{ABOUT.mission}</p>
      </div>

      <Section n="01" title="REASONS" id="reasons">
        <ol className="rules">
          {ABOUT.why.map((w, i) => (
            <li key={w}>
              <span aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
              <span>{w}</span>
            </li>
          ))}
        </ol>
      </Section>

      <Section n="02" title="METHOD" id="method">
        <p>{ABOUT.how}</p>
        <p>{ABOUT.selfHost}</p>
        <p><Link href="/how-it-works">Full procedure</Link></p>
      </Section>

      <Section n="03" title="POSITION" id="position">
        <p>{ABOUT.zero}</p>
        <p>
          First ten targets:{" "}
          {targets.map((t, i) => (
            <span key={t.slug}>
              <Link href={`/targets/${t.slug}`}>{t.name}</Link>
              {i < targets.length - 1 ? ", " : "."}
            </span>
          ))}
        </p>
      </Section>
    </>
  );
}
