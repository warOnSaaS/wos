import { STEPS } from "@/lib/content";

/** How it works. `detailed` adds the small-print jargon under each step. */
export function Steps({ detailed = false, headingLevel = 3 }: { detailed?: boolean; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <ol className="steps">
      {STEPS.map((s, i) => (
        <li key={s.title} className="step">
          <span className="step__num" aria-hidden="true">{i + 1}</span>
          <div>
            <H className="step__title">{s.title}</H>
            <p>{s.summary}</p>
            {detailed ? <p className="fine">{s.detail}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
