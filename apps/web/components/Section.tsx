/**
 * An ops-document section: heavy rule, numbered title, then body.
 * `title` is rendered exactly as written (no CSS re-casing); write labels in capitals.
 */
export function Section({
  n,
  title,
  id,
  aside,
  children,
}: {
  n?: string;
  title: React.ReactNode;
  id: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const hid = `${id}-h`;
  return (
    <section className="sec" id={id} aria-labelledby={hid}>
      <div className="sec-h">
        <h2 id={hid}>
          {n ? <span className="n">{n}</span> : null}
          {title}
        </h2>
        {aside ? <span className="label">{aside}</span> : null}
      </div>
      <div className="sec-b">{children}</div>
    </section>
  );
}
