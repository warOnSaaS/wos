import type { Faq } from "@/lib/content";

/** Native details/summary: works with JavaScript disabled. */
export function FaqList({ faq }: { faq: Faq[] }) {
  return (
    <div className="faq">
      {faq.map((f) => (
        <details key={f.q}>
          <summary>{f.q}</summary>
          <p>{f.a}</p>
        </details>
      ))}
    </div>
  );
}
