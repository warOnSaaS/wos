import type { SourceNote as Note } from "@/lib/data-source";

/** Prints where the numbers on a page come from. */
export function SourceNote({ source }: { source: Note }) {
  return (
    <p className="fine">
      SOURCE: {source.path} ({source.status}). Every percentage is formatPercent of the basis points in that source.
    </p>
  );
}
