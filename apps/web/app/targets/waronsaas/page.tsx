import Link from "next/link";
import { targetStatus } from "@/data/targets";
import { WOS_PROPOSAL_LABEL, WOS_ZERO_REASON, wosTarget } from "@/data/wos-roadmap";
import { PROGRESS_METRICS } from "@/lib/content";
import { formatPercent, getTarget, ROADMAP_META, ROADMAP_SOURCE, SURFACE_LABEL } from "@/lib/data-source";
import { breadcrumbLd, pageMetadata } from "@/lib/seo";
import { Section } from "@/components/Section";
import { Bar } from "@/components/Bar";
import { JsonLd } from "@/components/JsonLd";

export const metadata = pageMetadata({
  title: "TGT-00: warOnSaaS builds itself",
  description:
    "warOnSaaS is its own first target. The proposed wOS V1 roadmap, with every capability, feature, surface and weight, read from the repository's roadmap file. Nothing is merged, so every measure is 0%.",
  path: "/targets/waronsaas",
  defaultImage: false,
});

const KEY = { mapped: "mappedBp", specified: "specifiedBp", built: "builtBp" } as const;

export default function WosDossier() {
  const t = getTarget("waronsaas")!.data;
  const features = t.capabilities.reduce((n, c) => n + c.features.length, 0);
  const header: [string, string][] = [
    ["ID", wosTarget.id],
    ["DESIGNATION", "warOnSaaS"],
    ["SHORT NAME", t.productName ?? "wOS"],
    ["REPOSITORY", t.repo],
    ["STATUS", targetStatus(wosTarget)],
    ["ROADMAP", ROADMAP_META.status],
  ];

  return (
    <>
      <div className="title">
        <nav className="crumbs" aria-label="Breadcrumb">
          <ol>
            <li><Link href="/">Home</Link></li>
            <li><Link href="/#targets">Targets</Link></li>
            <li><span aria-current="page">{wosTarget.id}</span></li>
          </ol>
        </nav>
        <p className="label">TARGET DOSSIER // {wosTarget.id} // DOGFOOD</p>
        <h1>warOnSaaS builds itself</h1>
        <p className="lead">
          warOnSaaS is its own first target. wOS is built with the same process it runs for every other target:
          roadmap, Feature Contracts, build units, independent review, gated PRs.
        </p>
        <div className="cmds-row">
          <Link className="cmd" href="/drilldown/waronsaas">OPEN THE DRILLDOWN</Link>
        </div>
      </div>

      <Section n="01" title="HEADER" id="header">
        <dl className="cells cells--text">
          {header.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section n="02" title="PROGRESS" id="progress" aside="THREE INDEPENDENT MEASURES">
        <div className="readout">
          {PROGRESS_METRICS.map((m) => (
            <div key={m.key}>
              <span className="label">{m.label.toUpperCase()}</span>
              <span className="readout__n">{formatPercent(t.progress[KEY[m.key]])}</span>
              <Bar bp={t.progress[KEY[m.key]]} cells={20} showValue={false} />
              <p className="fine">{m.means}</p>
            </div>
          ))}
        </div>
        <p><strong>Why 0%:</strong> {WOS_ZERO_REASON}</p>
      </Section>

      <Section n="03" title="STATE OF WORK" id="state">
        <dl className="kv">
          <div>
            <dt>Architecture</dt>
            <dd>Contracts, database schema and protocols written.</dd>
          </div>
          <div>
            <dt>Wave 1</dt>
            <dd>Control plane, GitHub integration, context and policy, and verification pass their tests locally. Not deployed, not on GitHub yet.</dd>
          </div>
          <div>
            <dt>Wave 2</dt>
            <dd>In progress: planning, rewards, orchestrator, CLI, Desktop and this website.</dd>
          </div>
          <div>
            <dt>Public website</dt>
            <dd>This site. Static, data from files, every number 0%.</dd>
          </div>
        </dl>
        <p className="fine">None of this counts toward the measures above until the roadmap merges and work goes through wOS.</p>
      </Section>

      <Section n="04" title="SURFACES" id="surfaces">
        <table className="tbl">
          <caption>Surfaces wOS ships, from the roadmap.</caption>
          <thead>
            <tr>
              <th scope="col">SURFACE</th>
              <th scope="col">STATUS</th>
              <th scope="col">REPOSITORY</th>
              <th scope="col">SPECIFIED</th>
              <th scope="col">BUILT</th>
            </tr>
          </thead>
          <tbody>
            {t.surfaces.map((s) => (
              <tr key={s.surface}>
                <th scope="row" data-label="SURFACE">{SURFACE_LABEL[s.surface]}</th>
                <td data-label="STATUS">{s.status === "in_scope" ? "IN SCOPE" : `EXCLUDED: ${s.reason ?? ""}`}</td>
                <td data-label="REPOSITORY">{s.repo ?? "—"}</td>
                <td data-label="SPECIFIED"><Bar bp={s.specifiedBp} /></td>
                <td data-label="BUILT"><Bar bp={s.builtBp} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section n="05" title="ROADMAP" id="roadmap" aside={WOS_PROPOSAL_LABEL.toUpperCase()}>
        <p>
          {t.capabilities.length} capabilities and {features} features. Every weight has a written rationale, reasoned by
          the architect. It becomes the roadmap only when Fable and Astra both report no material gaps.
        </p>
        <ol className="caps">
          {t.capabilities.map((cap) => (
            <li key={cap.key}>
              <div className="cap-h">
                <h3>
                  <Link href={`/drilldown/waronsaas/${cap.key}`}>{cap.title}</Link>
                </h3>
                <span className="tag tag--dim">WEIGHT {cap.weightBp} BP</span>
              </div>
              <p>{cap.summary}</p>
              <ul className="feats" aria-label={`${cap.title} features`}>
                {cap.features.map((f) => (
                  <li key={f.key}>
                    <span>
                      <Link href={`/drilldown/waronsaas/${cap.key}/${f.key}`}>{f.title}</Link>
                    </span>
                    <span className="dim">{f.weightBp} bp</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        <p className="fine">
          Source: {ROADMAP_SOURCE.path} ({ROADMAP_SOURCE.status}). Copied verbatim into the site at build. Weights are
          basis points: a capability’s share of wOS, a feature’s share of its capability.
        </p>
      </Section>

      <Section n="06" title="HOW TO CONTRIBUTE" id="contribute">
        <p>
          The same way as any target, once the process is live: propose changes to the canonical roadmap, then build and
          review leased units. Until the control plane is deployed there is nothing to lease.
        </p>
        <div className="cmds-row">
          <Link className="cmd" href="/drilldown/waronsaas">DRILLDOWN</Link>
          <Link className="cmd" href="/briefing">FULL BRIEFING</Link>
          <Link className="cmd" href="/download">DOWNLOAD wOS</Link>
        </div>
      </Section>

      <JsonLd
        data={breadcrumbLd([
          { name: "Home", path: "/" },
          { name: "TGT-00 warOnSaaS", path: "/targets/waronsaas" },
        ])}
      />
    </>
  );
}
