import type { Block } from "@/lib/briefing";

/** Renders one block of the briefing. Diagrams are plain text with a text label for screen readers. */
export function BriefingBlock({ block }: { block: Block }) {
  switch (block.type) {
    case "p":
      return <p>{block.text}</p>;
    case "note":
      return <p className="fine">{block.text}</p>;
    case "list":
      return (
        <ul className="dash">
          {block.items.map((i) => <li key={i}><span>{i}</span></li>)}
        </ul>
      );
    case "steps":
      return (
        <ol className="rules">
          {block.items.map((i, n) => (
            <li key={i}>
              <span aria-hidden="true">{String(n + 1).padStart(2, "0")}</span>
              <span>{i}</span>
            </li>
          ))}
        </ol>
      );
    case "kv":
      return (
        <dl className="kv">
          {block.rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      );
    case "diagram":
      return (
        <figure style={{ margin: 0 }}>
          <pre className="diagram" role="img" aria-label={block.label}>{block.lines.join("\n")}</pre>
          <figcaption className="fine" style={{ marginTop: "0.5rem" }}>{block.label}.</figcaption>
        </figure>
      );
  }
}
