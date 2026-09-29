/** Text progress bar: [##........]   0%. The bar is decorative; the number is the value. */
export function Bar({ value, cells = 10, showValue = true }: { value: number; cells?: number; showValue?: boolean }) {
  const filled = Math.max(0, Math.min(cells, Math.round((value / 100) * cells)));
  return (
    <span className="bar">
      <span className="bar__track" aria-hidden="true">
        [{"#".repeat(filled)}
        {".".repeat(cells - filled)}]
      </span>
      {showValue ? (
        <>
          {" "}
          <span className="bar__val">{String(value).padStart(3, " ")}%</span>
        </>
      ) : null}
    </span>
  );
}
