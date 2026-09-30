import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { Section } from "@/components/Section";
import { renderBlock } from "@/lib/markdown";
import { breadcrumbLd, pageMetadata } from "@/lib/seo";
import { WHITEPAPER_CHANGES_PATH, WHITEPAPER_PATH, WHITEPAPER_READ_PATH } from "@/lib/whitepaper";
import { HISTORY, READABLE_VERSIONS, findVersion, snapshotText, versionDay, versionPath, versionWhitepaper } from "@/lib/whitepaper-history";

// Every version of the white paper in full, as it stood at the last commit that carried it (v0.1: the verbatim
// original). Generated statically from generated/whitepaper-history/ (see scripts/gen-whitepaper-history.mjs).
export const dynamicParams = false;

export function generateStaticParams() {
  return READABLE_VERSIONS.map((v) => ({ version: v.version }));
}

type Props = { params: Promise<{ version: string }> };

export async function generateMetadata({ params }: Props) {
  const { version } = await params;
  return pageMetadata({
    title: `White paper v${version}: full text of this version`,
    description: `The warOnSaaS white paper exactly as it stood at v${version}, from git. The current version is v${HISTORY.current}.`,
    path: versionPath(version),
  });
}

export default async function WhitepaperVersion({ params }: Props) {
  const { version } = await params;
  const v = findVersion(version);
  if (!v?.snapshot) notFound();
  const day = versionDay(v);
  const at = v.lastCommit ?? v.addedIn;
  const changesAnchor = `${WHITEPAPER_CHANGES_PATH}#v${v.version.replace(/\./g, "-")}`;

  return (
    <div className="wrap">
      <div className="sec">
        <p className="label">
          WHITE PAPER V{v.version} · {v.current ? "CURRENT VERSION" : "PAST VERSION"} · FULL TEXT{day ? ` · ${day}` : ""}
        </p>
        <div className="wp-banner" role="note">
          <p>
            <strong>
              {v.current ? `This is v${v.version}, the current version.` : `You are reading v${v.version}. The current version is v${HISTORY.current}.`}
            </strong>{" "}
            {v.current ? null : (
              <>
                Read the current one at <Link href={WHITEPAPER_READ_PATH}>/whitepaper/read</Link>.{" "}
              </>
            )}
            <Link href={changesAnchor}>What changed in v{v.version}, and since</Link>.
          </p>
          <p className="fine">
            {v.snapshot.format === "text"
              ? `${v.note ?? ""} `
              : at
                ? `The text at commit ${at.sha.slice(0, 7)} (${at.date.slice(0, 10)}), the last commit that carried this version. `
                : "The text on main. "}
            <a href={v.snapshot.sourceUrl}>Source on GitHub</a>. Scores given against one version are comparable only with
            scores given against the same version.
          </p>
        </div>
      </div>
      {v.snapshot.format === "text" ? (
        <div className="sec">
          <pre className="wp-pre wp-pre--wrap">
            <code data-verbatim="">{snapshotText(v)}</code>
          </pre>
        </div>
      ) : (
        <div className="brief brief--single wp">
          <div className="brief-body">
            {versionWhitepaper(v).sections.map((s) => (
              <Section key={s.id} n={s.n ?? undefined} title={s.title} id={s.id}>
                {s.blocks.map((b, j) => renderBlock(b, `${s.id}-${j}`))}
              </Section>
            ))}
          </div>
        </div>
      )}
      <JsonLd
        data={breadcrumbLd([
          { name: "warOnSaaS", path: "/" },
          { name: "White paper", path: WHITEPAPER_PATH },
          { name: "Changes", path: WHITEPAPER_CHANGES_PATH },
          { name: `v${v.version}`, path: versionPath(v.version) },
        ])}
      />
    </div>
  );
}
