import { ROE } from "@/lib/content";

export function Rules() {
  return (
    <ol className="rules">
      {ROE.map((r, i) => (
        <li key={r}>
          <span aria-hidden="true">R-{i + 1}</span>
          <span>{r}</span>
        </li>
      ))}
    </ol>
  );
}
