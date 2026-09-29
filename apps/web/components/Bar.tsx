import { formatPercent } from "@/lib/data-source";

/**
 * Text progress bar: [##........]   0%. Takes basis points (0..10000) as the API returns them;
 * the printed value is always formatPercent(bp). The bar itself is decorative.
 */
export function Bar({ bp, cells = 10, showValue = true }: { bp: number; cells?: number; showValue?: boolean }) {
  const filled = Math.max(0, Math.min(cells, Math.floor((bp / 10000) * cells)));
  return (
    <span className="bar">
      <span className="bar__track" aria-hidden="true">
        [{"#".repeat(filled)}
        {".".repeat(cells - filled)}]
      </span>
      {showValue ? (
        <>
          {" "}
          <span className="bar__val">{formatPercent(bp).padStart(4, " ")}</span>
        </>
      ) : null}
    </span>
  );
}
