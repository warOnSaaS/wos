import Link from "next/link";
import { roadmapState, targetStatus, type Target } from "@/data/targets";
import { Bar } from "./Bar";

/**
 * The Sniper List as a table. `self` (TGT-00, warOnSaaS) is shown first and marked.
 * Stacks into records below 900px (CSS only). Headers are written in capitals.
 */
export function TargetTable({ targets, self }: { targets: Target[]; self?: Target }) {
  const rows = self ? [self, ...targets] : targets;
  return (
    <table className="tbl">
      <caption>
        {self ? "TGT-00 is warOnSaaS itself, built with its own process. " : ""}
        TGT-01 to TGT-{String(targets.length).padStart(2, "0")} are the targets, in order. Each row links to its dossier.
      </caption>
      <thead>
        <tr>
          <th scope="col">ID</th>
          <th scope="col">TARGET</th>
          <th scope="col">CATEGORY</th>
          <th scope="col">MAPPED</th>
          <th scope="col">SPECIFIED</th>
          <th scope="col">BUILT</th>
          <th scope="col">ROADMAP</th>
          <th scope="col">STATUS</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr key={t.slug} className={t === self ? "row--self" : undefined}>
            <td data-label="ID">{t.id}</td>
            <th scope="row" data-label="TARGET">
              <Link href={`/targets/${t.slug}`}>{t.name}</Link>
            </th>
            <td data-label="CATEGORY">{t.category}</td>
            <td data-label="MAPPED"><Bar value={t.mapped} /></td>
            <td data-label="SPECIFIED"><Bar value={t.specified} /></td>
            <td data-label="BUILT"><Bar value={t.built} /></td>
            <td data-label="ROADMAP">{roadmapState(t)}</td>
            <td data-label="STATUS">{targetStatus(t)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
