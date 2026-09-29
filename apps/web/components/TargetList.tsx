import Link from "next/link";
import { roadmapStatus, type Target } from "@/data/targets";
import { Progress } from "./Progress";

/** The Sniper List: numbered, in order, each with its three bars. */
export function TargetList({ targets, headingLevel = 3 }: { targets: Target[]; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <ol className="targets">
      {targets.map((t, i) => (
        <li key={t.slug} className="target">
          <span className="target__num" aria-hidden="true">
            {String(i + 1).padStart(2, "0")}
          </span>
          <div className="target__body">
            <H className="target__name">
              <Link href={`/targets/${t.slug}`}>{t.name}</Link>
            </H>
            <p className="target__what">{t.whatItIs}</p>
            <p className="target__status">{roadmapStatus(t)}</p>
          </div>
          <Progress target={t} />
        </li>
      ))}
    </ol>
  );
}
