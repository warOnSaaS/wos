import { STEPS } from "@/lib/content";

/** The seven steps. `detailed` adds the jargon as small print. */
export function Procedure({ detailed = false }: { detailed?: boolean }) {
  return (
    <ol className="proc">
      {STEPS.map((s, i) => (
        <li key={s.title}>
          <span className="proc__n" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
          <div>
            <h3>{s.title}</h3>
            <p>{s.summary}</p>
            {detailed ? <p className="fine">{s.detail}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
