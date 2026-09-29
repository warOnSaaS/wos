import Link from "next/link";
import { notFound } from "next/navigation";
import { getTarget, roadmapStatus, roadmapTitle, targets } from "@/data/targets";
import { PROGRESS_METRICS } from "@/lib/content";
import { breadcrumbLd, pageMetadata } from "@/lib/seo";
import { LINKS, TOKEN_DISCLAIMER } from "@/lib/site";
import { Progress } from "@/components/Progress";
import { JsonLd } from "@/components/JsonLd";

export const dynamicParams = false;

export function generateStaticParams() {
  return targets.map((t) => ({ slug: t.slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const t = getTarget(slug);
  if (!t) return {};
  return pageMetadata({
    title: `Open-source ${t.name} alternative`,
    description: `warOnSaaS is building an open-source, self-hostable ${t.name} alternative, one feature at a time. ${t.whatItIs} Progress today: mapped ${t.mapped}%, specified ${t.specified}%, built ${t.built}%.`,
    path: `/targets/${t.slug}`,
  });
}

export default async function TargetPage({ params }: Props) {
  const { slug } = await params;
  const t = getTarget(slug);
  if (!t) notFound();
  const position = targets.findIndex((x) => x.slug === t.slug) + 1;

  return (
    <>
      <section className="hero" aria-labelledby="t-h">
        <div className="wrap">
          <nav className="crumbs" aria-label="Breadcrumb">
            <ol>
              <li><Link href="/">Home</Link></li>
              <li><Link href="/#sniper-list">Sniper List</Link></li>
              <li><span aria-current="page">{t.name}</span></li>
            </ol>
          </nav>
          <p className="kicker">Target {String(position).padStart(2, "0")} of {targets.length}</p>
          <h1 id="t-h">Open-source {t.name} alternative</h1>
          <p className="lede">
            {t.name}: {t.whatItIs.charAt(0).toLowerCase() + t.whatItIs.slice(1)} warOnSaaS is building an open-source
            replacement you can run yourself, one feature at a time.
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="progress-h">
        <div className="wrap grid-2">
          <div>
            <h2 id="progress-h">Progress</h2>
            <p>
              Three separate numbers, measured independently. Nothing has started yet, so all three are zero.
            </p>
            <dl className="facts">
              {PROGRESS_METRICS.map((m) => (
                <div key={m.key}>
                  <dt>{m.label}</dt>
                  <dd>{m.means}</dd>
                </div>
              ))}
            </dl>
          </div>
          <Progress target={t} size="lg" />
        </div>
      </section>

      <section className="section" aria-labelledby="replaces-h">
        <div className="wrap grid-2">
          <div>
            <h2 id="replaces-h">What it replaces</h2>
            <p>{t.name} is {t.whatItIs.charAt(0).toLowerCase() + t.whatItIs.slice(1)}</p>
            <p>In broad strokes, the replacement will cover:</p>
            <ul className="covers">
              {t.replacementCovers.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <p className="fine">
              The public roadmap decides the exact scope. This list is a starting outline, not a promise of every
              feature.
            </p>
          </div>
          <div>
            <h2>Status</h2>
            <dl className="facts">
              <div>
                <dt>Roadmap</dt>
                <dd>
                  {t.roadmapPr ? <a href={t.roadmapPr}>{roadmapTitle(t)}</a> : roadmapStatus(t)}
                </dd>
              </div>
              <div>
                <dt>Self-hosted</dt>
                <dd>{t.selfHosted ? "Available" : "Not available yet"}</dd>
              </div>
              <div>
                <dt>Hosted</dt>
                <dd>{t.hosted ? "Running" : "Not running yet"}</dd>
              </div>
              <div>
                <dt>Contributors</dt>
                <dd>None yet</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="contribute-h">
        <div className="wrap">
          <h2 id="contribute-h">How to contribute to this roadmap</h2>
          <ol className="steps">
            <li className="step">
              <span className="step__num" aria-hidden="true">1</span>
              <div>
                <h3 className="step__title">Find the one roadmap</h3>
                <p>
                  Everything for this target goes into a single public pull request called “{roadmapTitle(t)}”.{" "}
                  {t.roadmapPr ? (
                    <a href={t.roadmapPr}>Open the roadmap.</a>
                  ) : (
                    <>
                      It has not been opened yet. When it is, it will appear in the{" "}
                      <a href={LINKS.pullRequests}>warOnSaaS pull requests on GitHub</a> and on this page.
                    </>
                  )}
                </p>
              </div>
            </li>
            <li className="step">
              <span className="step__num" aria-hidden="true">2</span>
              <div>
                <h3 className="step__title">Propose a change to it</h3>
                <p>
                  Spot a missing feature, a wrong assumption or a gap? Propose a change to the roadmap itself. Please
                  do not start a separate roadmap: one plan per target keeps everyone building the same thing.
                </p>
              </div>
            </li>
            <li className="step">
              <span className="step__num" aria-hidden="true">3</span>
              <div>
                <h3 className="step__title">Two AIs test it</h3>
                <p>
                  Fable (Claude, by Anthropic) and Astra (ChatGPT, by OpenAI) each try to prove the roadmap is
                  incomplete, without seeing each other’s answer. Rounds continue until both say there are no
                  material gaps.
                </p>
              </div>
            </li>
            <li className="step">
              <span className="step__num" aria-hidden="true">4</span>
              <div>
                <h3 className="step__title">Then build it</h3>
                <p>
                  Once features have agreed contracts, <Link href="/download">download wOS</Link>, pick {t.name}, pick a
                  feature and a task, and press BUILD. Accepted work earns WOS tokens. {TOKEN_DISCLAIMER}
                </p>
              </div>
            </li>
          </ol>
          <p className="fine" style={{ marginTop: "1.5rem" }}>
            {t.name} is a trademark of its owner. warOnSaaS is not affiliated with it. See{" "}
            <Link href="/how-it-works">how it works</Link> for the full process.
          </p>
        </div>
      </section>

      <JsonLd
        data={breadcrumbLd([
          { name: "Home", path: "/" },
          { name: `${t.name} alternative`, path: `/targets/${t.slug}` },
        ])}
      />
    </>
  );
}
