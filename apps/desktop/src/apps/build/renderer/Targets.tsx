/**
 * The spec's flow: Sniper List -> target (Salesforce) -> capability (CRM) -> feature -> claimable ABU ->
 * model picker -> BUILD. Views are pure (tested with renderToStaticMarkup); containers load via window.wos.
 */
import type { AbuSummary, AppFeatureDetail, AppFeatureSummary, Me, ModelRef, TargetDetail, TargetSummary } from "@waronsaas/contracts";
import { useEffect, useMemo, useState } from "react";
import { type BuilderModelChoice, type RunInfo, splitBridgeError } from "../../shared/ipc.js";
import { Bar, Cells, Crumbs, Empty, Loading, Notice, Section, Title } from "../components/ui.js";
import { pct, upper } from "../lib/format.js";
import { useLoad, wos } from "../lib/hooks.js";

export type Route =
  | { name: "targets" }
  | { name: "target"; slug: string }
  | { name: "feature"; slug: string; targetName: string; feature: string; capability: string };

// ------------------------------------------------------------------------------------ Sniper List

export function SniperListView({ targets, onOpen }: { targets: TargetSummary[]; onOpen: (slug: string) => void }) {
  const ranked = [...targets].sort((a, b) => a.rank - b.rank);
  return (
    <>
      <Title label="SNIPER LIST / RANKED TARGETS" title="PICK A TARGET">
        <p>
          Each target is a product the one warOnSaaS suite must fully replace. Progress is real: it counts only mapped, specified and merged
          work. Nothing is rounded up.
        </p>
      </Title>
      {ranked.length === 0 ? (
        <Empty title="NO TARGETS">The control plane lists no targets yet.</Empty>
      ) : (
        <table className="tbl" data-testid="targets">
          <thead>
            <tr>
              <th>RANK</th>
              <th>TARGET</th>
              <th>WHAT IT IS</th>
              <th>ROADMAP</th>
              <th className="num">MAPPED</th>
              <th className="num">SPECIFIED</th>
              <th className="num">BUILT</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((t) => (
              <tr
                key={t.slug}
                className={t.rank === 0 ? "row--link row--self" : "row--link"}
                onClick={() => onOpen(t.slug)}
                data-testid={`target-${t.slug}`}
              >
                <td>{t.rank === 0 ? "TGT-00" : `TGT-${String(t.rank).padStart(2, "0")}`}</td>
                <th scope="row">{t.name}</th>
                <td className="dim">{t.whatItIs}</td>
                <td>{t.roadmap ? `V${t.roadmap.version} ${upper(t.roadmap.state)}` : "NOT OPENED"}</td>
                <td className="num">{pct(t.progress.mappedBp)}</td>
                <td className="num">{pct(t.progress.specifiedBp)}</td>
                <td className="num">
                  <Bar bp={t.progress.builtBp} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export function SniperList({ go }: { go: (r: Route) => void }) {
  const [data] = useLoad(() => wos().listTargets(), []);
  if (data.state === "loading") return <Loading what="THE SNIPER LIST" />;
  if (data.state === "error") return <Notice label="COULD NOT LOAD THE SNIPER LIST">{`${data.code}. ${data.message}`}</Notice>;
  return <SniperListView targets={data.value} onOpen={(slug) => go({ name: "target", slug })} />;
}

// ------------------------------------------------------------------------------------ target

export function TargetView({
  target,
  onBack,
  onFeature,
}: {
  target: TargetDetail;
  onBack: () => void;
  onFeature: (capability: string, feature: AppFeatureSummary) => void;
}) {
  const inScope = target.surfaces.filter((s) => s.status === "in_scope");
  const excluded = target.surfaces.filter((s) => s.status === "excluded");
  return (
    <>
      <Crumbs items={[{ label: "SNIPER LIST", onClick: onBack }, { label: target.name }]} />
      <Title label={`${target.rank === 0 ? "TGT-00" : `TGT-${String(target.rank).padStart(2, "0")}`} / ${target.repo}`} title={target.name}>
        <p>{target.whatItIs}</p>
      </Title>
      <Cells
        rows={[
          ["MAPPED", pct(target.progress.mappedBp)],
          ["SPECIFIED", pct(target.progress.specifiedBp)],
          ["BUILT", pct(target.progress.builtBp)],
          ["ROADMAP", target.roadmap ? `V${target.roadmap.version} ${upper(target.roadmap.state)}` : "NOT OPENED"],
        ]}
      />
      <Section n="01" title="CAPABILITIES" aside={`${target.capabilities.length} IN THE ROADMAP`}>
        {target.capabilities.length === 0 ? (
          <Empty title="NO ROADMAP YET">
            Nothing is mapped for {target.name}. Capabilities appear when the roadmap reaches consensus and merges. 0% is 0%.
          </Empty>
        ) : (
          target.capabilities.map((c) => (
            <div className="cap" key={c.key} data-testid={`capability-${c.key}`}>
              <div className="cap-h">
                <h3>
                  {c.title} <span className="dim">/ {c.key}</span>
                </h3>
                <span className="label">
                  WEIGHT {pct(c.weightBp)} / SPECIFIED {pct(c.specifiedBp)} / BUILT {pct(c.builtBp)}
                </span>
              </div>
              <p className="dim">{c.summary}</p>
              {c.features.length === 0 ? (
                <p className="label">{c.mapped ? "NO FEATURES IN THIS CAPABILITY" : "NOT MAPPED YET: NO FEATURES"}</p>
              ) : (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>FEATURE</th>
                      <th>STATE</th>
                      <th>CONTRACT</th>
                      <th className="num">UNIT POINTS</th>
                      <th className="num">BUILT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.features.map((f) => (
                      <tr key={f.key} className="row--link" onClick={() => onFeature(c.key, f)} data-testid={`feature-${f.key}`}>
                        <th scope="row">{f.title}</th>
                        <td>{upper(f.state)}</td>
                        <td>{f.contract ? `V${f.contract.version} ${upper(f.contract.state)}` : "NONE YET"}</td>
                        <td className="num">
                          {f.mergedPoints} OF {f.relevantPoints} MERGED
                        </td>
                        <td className="num">
                          <Bar bp={f.builtBp} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))
        )}
      </Section>
      <Section n="02" title="SURFACES" aside="D13: EVERY SURFACE THE PRODUCT SHIPS">
        {target.surfaces.length === 0 ? (
          <Empty title="NO SURFACES LISTED">The inventory has not listed this product's surfaces yet.</Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>SURFACE</th>
                <th>STATUS</th>
                <th className="num">SPECIFIED</th>
                <th className="num">BUILT</th>
              </tr>
            </thead>
            <tbody>
              {[...inScope, ...excluded].map((s) => (
                <tr key={s.surface}>
                  <th scope="row">{upper(s.surface)}</th>
                  <td>{s.status === "in_scope" ? "IN SCOPE" : `EXCLUDED: ${s.reason ?? "NO REASON GIVEN"}`}</td>
                  <td className="num">{pct(s.specifiedBp)}</td>
                  <td className="num">{pct(s.builtBp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </>
  );
}

export function Target({ slug, go }: { slug: string; go: (r: Route) => void }) {
  const [data] = useLoad(() => wos().getTarget(slug), [slug]);
  if (data.state === "loading") return <Loading what={slug} />;
  if (data.state === "error") return <Notice label="COULD NOT LOAD THE TARGET">{`${data.code}. ${data.message}`}</Notice>;
  return (
    <TargetView
      target={data.value}
      onBack={() => go({ name: "targets" })}
      onFeature={(capability, f) => go({ name: "feature", slug, targetName: data.value.name, feature: f.key, capability })}
    />
  );
}

// ------------------------------------------------------------------------------------ feature + BUILD

export interface BuildPanelProps {
  me: Me | null;
  abu: AbuSummary | null;
  models: BuilderModelChoice[] | null;
  model: ModelRef | null;
  onModel: (m: ModelRef) => void;
  onBuild: () => void;
  starting: boolean;
  lastRun: RunInfo | null;
  error: string | null;
  onRefreshModels: () => void;
}

export function BuildPanelView(p: BuildPanelProps) {
  const available = (p.models ?? []).filter((m) => m.available);
  const unavailable = (p.models ?? []).filter((m) => !m.available);
  const chosen = available.find((m) => m.ref === p.model) ?? null;
  const blockers: string[] = [];
  if (!p.me) blockers.push("SIGN IN FIRST.");
  else if (!p.me.github) blockers.push("LINK GITHUB FIRST: every lease needs a linked GitHub (D8).");
  else if (!p.me.canContribute) blockers.push("THIS ACCOUNT MAY NOT CONTRIBUTE RIGHT NOW.");
  if (!p.abu) blockers.push("PICK A UNIT ABOVE.");
  else if (p.abu.claimable !== true) blockers.push(`${p.abu.key} IS NOT CLAIMABLE BY YOU NOW (STATE ${upper(p.abu.state)}).`);
  if (p.models && available.length === 0)
    blockers.push("NO BUILDER MODEL IS ATTESTED ON THIS DEVICE. Install and sign in to claude or codex, then RUN STATUS.");
  else if (!chosen) blockers.push("PICK A MODEL.");
  const running = p.lastRun?.state === "running";
  return (
    <div data-testid="build-panel">
      <p className="label" style={{ marginBottom: "0.75rem" }}>
        UNIT: {p.abu ? `${p.abu.key} / ${p.abu.title} / ${p.abu.sizePoints} POINTS` : "NONE SELECTED"}
      </p>
      <div className="label" style={{ marginBottom: "0.5rem" }}>
        BUILDER MODEL (D15: YOUR CHOICE PER LEASE; ONLY MODELS THIS DEVICE HAS ATTESTED)
      </div>
      {p.models === null ? (
        <Loading what="ATTESTED MODELS" />
      ) : available.length === 0 ? null : (
        <div className="picker" role="radiogroup" aria-label="Builder model">
          {available.map((m) => (
            <label key={m.ref} data-testid={`model-${m.ref}`}>
              <input type="radio" name="model" value={m.ref} checked={p.model === m.ref} onChange={() => p.onModel(m.ref)} />
              <strong>{m.label}</strong>
              <span className="dim">{m.modelId}</span>
              <span className="dim">
                VIA {m.cli.toUpperCase()}
                {m.isDefault ? " / POLICY DEFAULT" : ""}
              </span>
            </label>
          ))}
        </div>
      )}
      {unavailable.length > 0 ? (
        <ul className="dash fine" style={{ marginBottom: "1rem" }}>
          {unavailable.map((m) => (
            <li key={m.ref}>
              <span>
                {m.label} NOT OFFERED: {m.reason}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="fine" style={{ marginBottom: "1rem" }}>
        ONE CLAUDE BUILD (OPUS) AND ONE CODEX BUILD (ASTRA OR SOL) CAN RUN AT THE SAME TIME, ON DIFFERENT UNITS.
      </p>
      <div className="btn-row">
        <button
          className="btn btn--primary"
          type="button"
          disabled={blockers.length > 0 || p.starting}
          onClick={p.onBuild}
          data-testid="build"
        >
          {p.starting ? "CLAIMING..." : chosen ? `BUILD WITH ${chosen.label}` : "BUILD"}
        </button>
        <button className="btn btn--quiet" type="button" onClick={p.onRefreshModels}>
          RUN STATUS
        </button>
      </div>
      {blockers.length > 0 ? (
        <ul className="dash fine" style={{ marginTop: "1rem" }} data-testid="build-blockers">
          {blockers.map((b) => (
            <li key={b}>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {p.error ? <Notice label="NOT STARTED">{p.error}</Notice> : null}
      {p.lastRun ? (
        <Notice
          label={`LAST RUN ON THIS UNIT: ${running ? "RUNNING" : p.lastRun.state === "passed" ? "PASSED" : "FAILED"}`}
          quiet={running}
        >
          {running ? "FOLLOW IT IN THE ACTIVITY PANE." : p.lastRun.explanation}
        </Notice>
      ) : null}
    </div>
  );
}

export function FeatureView({
  feature,
  targetName,
  capability,
  abus,
  abusNote,
  selected,
  onSelect,
  onBack,
  onTarget,
  panel,
}: {
  feature: AppFeatureDetail;
  targetName: string;
  capability: string;
  abus: AbuSummary[];
  abusNote: string | null;
  selected: string | null;
  onSelect: (id: string) => void;
  onBack: () => void;
  onTarget: () => void;
  panel: BuildPanelProps;
}) {
  return (
    <>
      <Crumbs
        items={[
          { label: "SNIPER LIST", onClick: onBack },
          { label: targetName, onClick: onTarget },
          { label: capability.toUpperCase() },
          { label: feature.title },
        ]}
      />
      <Title label={`FEATURE / ${feature.key} / ${upper(feature.state)}`} title={feature.title}>
        <p>{feature.summary}</p>
      </Title>
      <Cells
        rows={[
          ["SPECIFIED", pct(feature.specifiedBp)],
          ["BUILT", pct(feature.builtBp)],
          ["UNIT POINTS", `${feature.mergedPoints} OF ${feature.relevantPoints}`],
          ["CONTRACT", feature.contract ? `V${feature.contract.version} ${upper(feature.contract.state)}` : "NONE YET"],
        ]}
      />
      <Section n="01" title="UNITS YOU CAN BUILD" aside={`${abus.filter((a) => a.claimable === true).length} CLAIMABLE`}>
        {abusNote ? <p className="fine">{abusNote}</p> : null}
        {abus.length === 0 ? (
          <Empty title="NO UNITS">
            This feature has no atomic build units yet. They appear when its Feature Contract and build graph merge.
          </Empty>
        ) : (
          <table className="tbl" data-testid="abus">
            <thead>
              <tr>
                <th>UNIT</th>
                <th>TITLE</th>
                <th>STATE</th>
                <th>CLAIMABLE</th>
                <th className="num">POINTS</th>
                <th>REQUIREMENTS</th>
              </tr>
            </thead>
            <tbody>
              {abus.map((a) => (
                <tr
                  key={a.id}
                  className="row--link"
                  aria-selected={selected === a.id}
                  onClick={() => onSelect(a.id)}
                  data-testid={`abu-${a.key}`}
                >
                  <th scope="row">{a.key}</th>
                  <td>{a.title}</td>
                  <td>{upper(a.state)}</td>
                  <td>{a.claimable === true ? "YES" : a.claimable === false ? "NO" : "SIGN IN TO SEE"}</td>
                  <td className="num">{a.sizePoints}</td>
                  <td className="dim">{a.requirements.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      <Section n="02" title="BUILD">
        <BuildPanelView {...panel} />
      </Section>
      <Section n="03" title="REQUIREMENTS" aside="THIS APP'S PROFILE">
        {feature.requirements.length === 0 ? (
          <Empty title="NO REQUIREMENTS YET" />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>KEY</th>
                <th>STATEMENT</th>
                <th>SURFACES</th>
                <th>BUILT</th>
              </tr>
            </thead>
            <tbody>
              {feature.requirements.map((r) => (
                <tr key={r.key}>
                  <th scope="row">{r.key}</th>
                  <td>{r.statement}</td>
                  <td className="dim">{r.surfaces.map(upper).join(", ")}</td>
                  <td>{r.built ? "YES" : "NO"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </>
  );
}

export function Feature({
  slug,
  targetName,
  feature,
  capability,
  me,
  go,
  runs,
}: {
  slug: string;
  targetName: string;
  feature: string;
  capability: string;
  me: Me | null;
  go: (r: Route) => void;
  runs: RunInfo[];
}) {
  const [detail] = useLoad(() => wos().getFeature(slug, feature), [slug, feature]);
  const [claimable, reloadClaimable] = useLoad(
    () => (me?.canContribute ? wos().listClaimableAbus(slug, feature) : Promise.resolve(null)),
    [slug, feature, me?.canContribute],
  );
  const [modelsTick, setModelsTick] = useState(0);
  const [models] = useLoad(
    () =>
      modelsTick > 0
        ? wos()
            .status()
            .then(() => wos().builderModels())
        : wos().builderModels(),
    [modelsTick],
  );
  const [settings] = useLoad(() => wos().getSettings(), []);
  const [selected, setSelected] = useState<string | null>(null);
  const [model, setModel] = useState<ModelRef | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preselect: the settings' preferred model when attested, else the policy default.
  useEffect(() => {
    if (models.state !== "ready" || model) return;
    const avail = models.value.filter((m) => m.available);
    const pref = settings.state === "ready" ? settings.value.preferredModel : null;
    const pick = avail.find((m) => m.ref === pref) ?? avail.find((m) => m.isDefault) ?? null;
    if (pick) setModel(pick.ref);
  }, [models, settings, model]);

  const abus: AbuSummary[] = useMemo(() => {
    if (claimable.state === "ready" && claimable.value) return claimable.value;
    return detail.state === "ready" ? detail.value.abus : [];
  }, [claimable, detail]);

  useEffect(() => {
    if (!selected) {
      const first = abus.find((a) => a.claimable === true);
      if (first) setSelected(first.id);
    }
  }, [abus, selected]);

  if (detail.state === "loading") return <Loading what={feature} />;
  if (detail.state === "error") return <Notice label="COULD NOT LOAD THE FEATURE">{`${detail.code}. ${detail.message}`}</Notice>;

  const abu = abus.find((a) => a.id === selected) ?? null;
  const lastRun = abu ? ([...runs].reverse().find((r) => r.kind === "build" && r.subject === abu.id) ?? null) : null;
  const abusNote = !me?.canContribute
    ? "CLAIMABILITY IS COMPUTED FOR SIGNED-IN CONTRIBUTORS WITH A LINKED GITHUB."
    : claimable.state === "error"
      ? `COULD NOT LIST CLAIMABLE UNITS: ${claimable.code}. ${claimable.message}`
      : null;

  const onBuild = () => {
    if (!abu || !model) return;
    setError(null);
    setStarting(true);
    wos()
      .build(abu.id, model)
      .then(() => {
        setStarting(false);
        reloadClaimable();
      })
      .catch((e: unknown) => {
        setStarting(false);
        const { code, message } = splitBridgeError(e);
        setError(`${code}. ${message}`);
      });
  };

  return (
    <FeatureView
      feature={detail.value}
      targetName={targetName}
      capability={capability}
      abus={abus}
      abusNote={abusNote}
      selected={selected}
      onSelect={setSelected}
      onBack={() => go({ name: "targets" })}
      onTarget={() => go({ name: "target", slug })}
      panel={{
        me,
        abu,
        models: models.state === "ready" ? models.value : models.state === "error" ? [] : null,
        model,
        onModel: setModel,
        onBuild,
        starting,
        lastRun,
        error: error ?? (models.state === "error" ? `COULD NOT READ THE ATTESTED MODELS: ${models.code}. ${models.message}` : null),
        onRefreshModels: () => setModelsTick((t) => t + 1),
      }}
    />
  );
}
