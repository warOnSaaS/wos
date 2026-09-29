import Link from "next/link";
import type { TargetSummary } from "@contracts/domain";
import { roadmapState, targetStatus } from "@/data/targets";
import { siteFields } from "@/lib/data-source";
import { Bar } from "./Bar";

/**
 * The Sniper List as a table, from listTargets() (GET /v1/public/targets shape).
 * Rank 0 (warOnSaaS itself) is shown first and marked. Stacks into records below 900px (CSS only).
 */
export function TargetTable({ items }: { items: TargetSummary[] }) {
  const last = items[items.length - 1]?.rank ?? 0;
  return (
    <table className="tbl">
      <caption>
        TGT-00 is warOnSaaS itself, built with its own process. TGT-01 to TGT-{String(last).padStart(2, "0")} are the
        targets, in order. Each row links to its dossier.
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
        {items.map((t) => {
          const site = siteFields(t.slug, t.rank)!;
          return (
            <tr key={t.slug} className={t.rank === 0 ? "row--self" : undefined}>
              <td data-label="ID">{site.id}</td>
              <th scope="row" data-label="TARGET">
                <Link href={`/targets/${t.slug}`}>{t.rank === 0 ? site.name : t.name}</Link>
              </th>
              <td data-label="CATEGORY">{site.category}</td>
              <td data-label="MAPPED"><Bar bp={t.progress.mappedBp} /></td>
              <td data-label="SPECIFIED"><Bar bp={t.progress.specifiedBp} /></td>
              <td data-label="BUILT"><Bar bp={t.progress.builtBp} /></td>
              <td data-label="ROADMAP">{t.roadmap ? "OPEN" : roadmapState(site)}</td>
              <td data-label="STATUS">{targetStatus(site)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
