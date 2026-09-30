/**
 * A small Markdown renderer for the white paper (docs/whitepaper/WHITEPAPER.md), run at build time.
 *
 * It supports exactly the subset the paper uses, and nothing else: `#`/`##`/`###`/`####` headings,
 * paragraphs, one-level `-` and `1.` lists, pipe tables, fenced code blocks, `**bold**`, `` `code` ``,
 * `[text](url)` links and bare https:// URLs. No raw HTML is ever passed through: text becomes React
 * text nodes, so nothing in the file can inject markup. Unknown syntax renders as plain text.
 */
import type { ReactNode } from "react";

export type Inline = string;
export type Block =
  | { type: "h"; level: 1 | 2 | 3 | 4; text: Inline; id: string }
  | { type: "p"; text: Inline }
  | { type: "ul"; items: Inline[] }
  | { type: "ol"; items: Inline[]; start: number }
  | { type: "table"; head: Inline[]; rows: Inline[][] }
  | { type: "code"; lines: string[] };

/** A stable, readable anchor id: "16.4 Reservation at issuance" -> "s16-4-reservation-at-issuance". */
export function slug(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[`*]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return /^\d/.test(s) ? `s${s}` : s || "section";
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

export function parse(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  const used = new Map<string, number>();
  const uniq = (id: string) => {
    const n = used.get(id) ?? 0;
    used.set(id, n + 1);
    return n ? `${id}-${n + 1}` : id;
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const text = h[2].trim();
      blocks.push({ type: "h", level: h[1].length as 1 | 2 | 3 | 4, text, id: uniq(slug(text)) });
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push({ type: "code", lines: code });
      continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      blocks.push({ type: "table", head, rows });
      continue;
    }
    if (/^- /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^- /.test(lines[i])) {
        let item = lines[i++].slice(2);
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) item += ` ${lines[i++].trim()}`;
        items.push(item);
      }
      blocks.push({ type: "ul", items });
      continue;
    }
    const ol = line.match(/^(\d+)\.\s/);
    if (ol) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        let item = lines[i++].replace(/^\d+\.\s+/, "");
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) item += ` ${lines[i++].trim()}`;
        items.push(item);
      }
      blocks.push({ type: "ol", items, start: Number(ol[1]) });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4}\s|```|- |\d+\.\s)/.test(lines[i]) &&
      !lines[i].trim().startsWith("|")
    ) {
      para.push(lines[i++].trim());
    }
    blocks.push({ type: "p", text: para.join(" ") });
  }
  return blocks;
}

/** Plain text of an inline string (for ids, tables' data-label, the table of contents). */
export function plain(text: Inline): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
}

const INLINE = /(\*\*(.+?)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*|#[^)\s]+)\))|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

export function inline(text: Inline, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[1]) out.push(<strong key={k}>{inline(m[2], k)}</strong>);
    else if (m[3]) out.push(<code key={k}>{m[4]}</code>);
    else if (m[5]) out.push(<a key={k} href={m[7]}>{inline(m[6], k)}</a>);
    else if (m[8]) out.push(<a key={k} href={m[8]}>{m[8]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function renderBlock(b: Block, key: string): ReactNode {
  switch (b.type) {
    case "h": {
      const Tag = (b.level <= 2 ? "h2" : b.level === 3 ? "h3" : "h4") as "h2" | "h3" | "h4";
      return (
        <Tag key={key} id={b.id}>
          {inline(b.text, key)}
        </Tag>
      );
    }
    case "p":
      return <p key={key}>{inline(b.text, key)}</p>;
    case "ul":
      return (
        <ul key={key} className="dash">
          {b.items.map((it, j) => (
            <li key={j}>
              <span>{inline(it, `${key}-${j}`)}</span>
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={key} className="wp-ol" start={b.start}>
          {b.items.map((it, j) => (
            <li key={j}>
              <span>{inline(it, `${key}-${j}`)}</span>
            </li>
          ))}
        </ol>
      );
    case "table":
      return (
        <div key={key} className="wp-table">
          <table className="tbl">
            <thead>
              <tr>
                {b.head.map((h, j) => (
                  <th key={j} scope="col">
                    {inline(h, `${key}-h${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, j) => (
                <tr key={j}>
                  {r.map((c, k) => (
                    <td key={k} data-label={plain(b.head[k] ?? "")}>
                      <span>{inline(c, `${key}-${j}-${k}`)}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "code":
      return (
        <pre key={key} className="wp-pre">
          <code>{b.lines.join("\n")}</code>
        </pre>
      );
  }
}
