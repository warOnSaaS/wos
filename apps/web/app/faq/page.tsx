import Link from "next/link";
import { FAQ } from "@/lib/content";
import { faqLd, pageMetadata } from "@/lib/seo";
import { Section } from "@/components/Section";
import { FaqList } from "@/components/FaqList";
import { JsonLd } from "@/components/JsonLd";

export const metadata = pageMetadata({
  title: "FAQ",
  description:
    "Questions about warOnSaaS: why everything is at 0%, how sign-in works, who pays for the AI, who reviews the work, and what WOS tokens are.",
  path: "/faq",
});

export default function FaqPage() {
  return (
    <>
      <div className="title">
        <p className="label">FAQ // QUESTIONS AND ANSWERS</p>
        <h1>FAQ</h1>
        <p className="lead">Short answers. The full detail is in the <Link href="/briefing">briefing</Link>.</p>
      </div>

      <Section n="01" title="QUESTIONS" id="questions" aside={`${FAQ.length} ENTRIES`}>
        <FaqList faq={FAQ} />
      </Section>

      <JsonLd data={faqLd(FAQ)} />
    </>
  );
}
