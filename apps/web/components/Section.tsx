/** An ops-document section: numbered header bar, then body. */
export function Section({
  n,
  title,
  id,
  aside,
  children,
}: {
  n?: string;
  title: string;
  id?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const hid = `${id ?? title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-h`;
  return (
    <section className="sec" id={id} aria-labelledby={hid}>
      <div className="sec-h">
        <h2 id={hid}>
          {n ? <span className="dim">{n} // </span> : null}
          {title}
        </h2>
        {aside ? <span className="label">{aside}</span> : null}
      </div>
      <div className="sec-b">{children}</div>
    </section>
  );
}
