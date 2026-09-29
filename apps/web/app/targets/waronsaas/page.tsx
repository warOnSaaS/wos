import Link from "next/link";
import { roadmapState, targetStatus } from "@/data/targets";
import {
  WOS_PROPOSAL_LABEL,
  WOS_ZERO_REASON,
  wosCapabilities,
  wosCounts,
  wosTarget as t,
  type WosStatus,
} from "@/data/wos-roadmap";
import { PROGRESS_METRICS } from "@/lib/content";
import { breadcrumbLd, pageMetadata } from "@/lib/seo";
import { Section } from "@/components/Section";
import { Bar } from "@/components/Bar";
import { JsonLd } from "@/components/JsonLd";

export const metadata = pageMetadata({
  title: "TGT-00: warOnSaaS builds itself",
  description:
    "warOnSaaS is its own first target. The proposed V1 feature list for wOS, in the same roadmap format every target uses, with honest status: only the static v0 website exists.",
  path: "/targets/waronsaas",
  defaultImage: false,
});

function Tag({ status }: { status: WosStatus }) {
  const cls = status === "EXISTS" ? "tag tag--solid" : status === "IN PROGRESS" ? "tag" : "tag tag--dim";
  return <span className={cls}>{status}</span>;
}

export default function WosDossier() {
  const c = wosCounts();
  const header: [string, string][] = [
    ["ID", t.id],
    ["DESIGNATION", "warOnSaaS"],
    ["SHORT NAME", "wOS"],
    ["STATUS", targetStatus(t)],
    ["ROADMAP", roadmapState(t)],
    ["CONTRIBUTORS", "0"],
  ];

  return (
    <>
      <div className="title">
        <nav className="crumbs" aria-label="Breadcrumb">
          <ol>
            <li><Link href="/">Home</Link></li>
            <li><Link href="/#targets">Targets</Link></li>
            <li><span aria-current="page">{t.id}</span></li>
          </ol>
        </nav>
        <p className="label">TARGET DOSSIER // {t.id} // DOGFOOD</p>
        <h1>warOnSaaS builds itself</h1>
        <p className="lead">
          warOnSaaS is its own first target. wOS will be built with the same process it runs for every other target:
          roadmap, Feature Contracts, build units, independent review, gated PRs.
        </p>
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
              <span className="readout__n">{t[m.key]}%</span>
              <Bar value={t[m.key]} cells={20} showValue={false} />
              <p className="fine">{m.means}</p>
            </div>
          ))}
        </div>
        <p><strong>Why 0%:</strong> {WOS_ZERO_REASON}</p>
      </Section>

      <Section n="03" title="STATE OF WORK" id="state">
        <dl className="kv">
          <div>
            <dt>Public website</dt>
            <dd>Exists. This site is the static v0: pages rendered at build time, data from a file, every number 0%.</dd>
          </div>
          <div>
            <dt>Architecture</dt>
            <dd>In progress. Phase 0: shared contracts, schemas and protocols. Nothing merged yet.</dd>
          </div>
          <div>
            <dt>Everything else</dt>
            <dd>Not started.</dd>
          </div>
        </dl>
      </Section>

      <Section n="04" title="FEATURE PROPOSAL" id="proposal" aside={WOS_PROPOSAL_LABEL.toUpperCase()}>
        <p>
          The V1 feature list, written in the roadmap format every target will use: capabilities, and features under
          each. It is a proposal. It becomes the roadmap only when Fable and Astra both report no material gaps.
        </p>
        <dl className="cells">
          <div><dt>CAPABILITIES</dt><dd>{c.capabilities}</dd></div>
          <div><dt>FEATURES</dt><dd>{c.features}</dd></div>
          <div><dt>EXISTS</dt><dd>{c.exists}</dd></div>
          <div><dt>IN PROGRESS</dt><dd>{c.inProgress}</dd></div>
          <div><dt>NOT STARTED</dt><dd>{c.notStarted}</dd></div>
        </dl>
        <ol className="caps">
          {wosCapabilities.map((cap) => (
            <li key={cap.id} id={cap.id.toLowerCase()}>
              <div className="cap-h">
                <h3>
                  <span className="dim">{cap.id}</span> {cap.name}
                </h3>
                <Tag status={cap.status} />
              </div>
              <p>{cap.summary}</p>
              {cap.note ? <p className="fine">{cap.note}</p> : null}
              <ul className="feats" aria-label={`${cap.name} features`}>
                {cap.features.map((f) => (
                  <li key={f.name}>
                    <span>
                      {f.name}
                      {f.note ? <span className="fine">{f.note}</span> : null}
                    </span>
                    <Tag status={f.status} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        <p className="fine">
          Source: the founder’s V1 specification and decisions. Status is shape and words only: EXISTS is a filled tag,
          IN PROGRESS an outlined tag, NOT STARTED a faint tag.
        </p>
      </Section>

      <Section n="05" title="HOW TO CONTRIBUTE" id="contribute">
        <p>
          The same way as any target, once the process exists: propose changes to the canonical roadmap, then build and
          review leased units. Until the control plane exists there is nothing to lease.
        </p>
        <div className="cmds-row">
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
