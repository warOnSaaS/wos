import Link from "next/link";
import { roadmapState, targetStatus, type Target } from "@/data/targets";
import { Bar } from "./Bar";

/** The Sniper List as a dense table. Stacks into records below 900px (CSS only). */
export function TargetTable({ targets }: { targets: Target[] }) {
  return (
    <table className="tbl">
      <caption>The Sniper List. {targets.length} targets, in order. Each row links to its dossier.</caption>
      <thead>
        <tr>
          <th scope="col">ID</th>
          <th scope="col">Target</th>
          <th scope="col">Category</th>
          <th scope="col">Mapped</th>
          <th scope="col">Specified</th>
          <th scope="col">Built</th>
          <th scope="col">Roadmap</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {targets.map((t) => (
          <tr key={t.slug}>
            <td data-label="ID">{t.id}</td>
            <th scope="row" data-label="Target">
              <Link href={`/targets/${t.slug}`}>{t.name}</Link>
            </th>
            <td data-label="Category">{t.category}</td>
            <td data-label="Mapped"><Bar value={t.mapped} /></td>
            <td data-label="Specified"><Bar value={t.specified} /></td>
            <td data-label="Built"><Bar value={t.built} /></td>
            <td data-label="Roadmap">{roadmapState(t)}</td>
            <td data-label="Status">{targetStatus(t)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
