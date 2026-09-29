/** Work, contribution history, profile and settings: real API shapes, honest empty states. */
import type { LocalStatus, Me } from "@waronsaas/contracts";
import { useEffect, useState } from "react";
import { type AppInfo, type ContributionHistory, type LocalSettings, type MyWork, splitBridgeError } from "../../shared/ipc.js";
import { Cells, Empty, KV, Loading, Notice, Section, Title } from "../components/ui.js";
import { date, upper } from "../lib/format.js";
import { useLoad, wos } from "../lib/hooks.js";

// ------------------------------------------------------------------------------------ work

export function WorkView({ work, onRelease }: { work: MyWork; onRelease: (leaseId: string) => void }) {
  const active = work.leases.filter((l) => l.state === "active");
  return (
    <>
      <Title label="MY WORK / FROM THE CONTROL PLANE" title="LEASES AND ATTEMPTS" />
      <Cells
        rows={[
          ["ACTIVE LEASES", String(active.length)],
          ["TASKS", String(work.tasks.length)],
          ["ATTEMPTS", String(work.attempts.length)],
          ["MERGED", String(work.attempts.filter((a) => a.state === "merged").length)],
        ]}
      />
      <Section n="01" title="ATTEMPTS">
        {work.attempts.length === 0 ? (
          <Empty title="NO ATTEMPTS YET">Pick a unit on the Sniper List and press BUILD. Your attempts appear here.</Empty>
        ) : (
          <table className="tbl" data-testid="attempts">
            <thead>
              <tr>
                <th>UNIT</th>
                <th>STATE</th>
                <th>BUILT WITH</th>
                <th>REPAIRS</th>
                <th>PR</th>
                <th>UPDATED</th>
              </tr>
            </thead>
            <tbody>
              {work.attempts.map((a) => (
                <tr key={a.id}>
                  <th scope="row">{a.abu}</th>
                  <td>{upper(a.state)}</td>
                  <td>{a.builtWith ? `${a.builtWith.model.toUpperCase()} (${a.builtWith.modelId})` : "NOT RECORDED"}</td>
                  <td>{a.repairCount}</td>
                  <td>{a.pr ? `#${a.pr.number}` : "NONE"}</td>
                  <td>{date(a.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      <Section n="02" title="ACTIVE LEASES">
        {active.length === 0 ? (
          <Empty title="NO ACTIVE LEASES" />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>LEASE</th>
                <th>EXPIRES</th>
                <th>HARD DEADLINE</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {active.map((l) => (
                <tr key={l.id}>
                  <th scope="row">{l.id}</th>
                  <td>{l.expiresAt}</td>
                  <td>{l.hardDeadlineAt}</td>
                  <td className="num">
                    <button className="btn btn--quiet" type="button" onClick={() => onRelease(l.id)}>
                      ABANDON
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </>
  );
}

export function Work({ me }: { me: Me | null }) {
  const [data, reload] = useLoad(() => (me?.canContribute ? wos().myWork() : Promise.resolve(null)), [me?.canContribute]);
  const [error, setError] = useState<string | null>(null);
  if (!me?.canContribute)
    return <Empty title="LINK GITHUB TO SEE WORK">Leases and attempts exist only for contributors with a linked GitHub.</Empty>;
  if (data.state === "loading") return <Loading what="YOUR WORK" />;
  if (data.state === "error") return <Notice label="COULD NOT LOAD YOUR WORK">{`${data.code}. ${data.message}`}</Notice>;
  if (!data.value) return null;
  return (
    <>
      {error ? <Notice label="NOT RELEASED">{error}</Notice> : null}
      <WorkView
        work={data.value}
        onRelease={(id) =>
          wos()
            .release(id)
            .then(reload)
            .catch((e: unknown) => {
              const { code, message } = splitBridgeError(e);
              setError(`${code}. ${message}`);
            })
        }
      />
    </>
  );
}

// ------------------------------------------------------------------------------------ contributions

export function ContributionsView({ history, disclaimer }: { history: ContributionHistory; disclaimer: string }) {
  const contributions = history.profile?.contributions ?? [];
  const accepted = contributions.filter((c) => c.state === "accepted").length;
  return (
    <>
      <Title label={`CONTRIBUTION HISTORY / ${history.handle ?? "NO HANDLE"}`} title="CONTRIBUTIONS" />
      <Cells
        rows={[
          ["CONTRIBUTIONS", String(contributions.length)],
          ["ACCEPTED", String(accepted)],
          ["PENDING", String(contributions.filter((c) => c.state === "pending").length)],
          ["SCORE", history.profile?.score === null || history.profile?.score === undefined ? "NOT PUBLIC" : String(history.profile.score)],
        ]}
      />
      <Section n="01" title="ACCEPTED AND PENDING WORK">
        {contributions.length === 0 ? (
          <Empty title="NO CONTRIBUTIONS YET">
            {history.profile ? "Nothing has been accepted or submitted for review under this account yet." : history.ledgerHiddenReason}
          </Empty>
        ) : (
          <table className="tbl" data-testid="contributions">
            <thead>
              <tr>
                <th>CATEGORY</th>
                <th>STATE</th>
                <th>TARGET</th>
                <th>FEATURE / UNIT</th>
                <th>REVIEW</th>
                <th>ACCEPTED</th>
              </tr>
            </thead>
            <tbody>
              {contributions.map((c) => (
                <tr key={c.id}>
                  <th scope="row">{upper(c.category)}</th>
                  <td>{upper(c.state)}</td>
                  <td>{c.target}</td>
                  <td>{c.abu ?? c.feature ?? "NONE"}</td>
                  <td>{upper(c.independence)}</td>
                  <td>{date(c.acceptedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      <Section n="02" title="TOKEN HISTORY" aside={disclaimer}>
        {history.ledger === null ? (
          <Empty title="NOT SHOWN">{history.ledgerHiddenReason}</Empty>
        ) : history.ledger.length === 0 ? (
          <Empty title="NO LEDGER ENTRIES YET">Tokens are awarded for accepted work and held for 14 days.</Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>ENTRY</th>
                <th>KIND</th>
                <th>BUCKET</th>
                <th className="num">AMOUNT</th>
                <th>MEMO</th>
                <th>DATE</th>
              </tr>
            </thead>
            <tbody>
              {history.ledger.map((l) => (
                <tr key={l.entryNo}>
                  <th scope="row">{l.entryNo}</th>
                  <td>{upper(l.kind)}</td>
                  <td>{upper(l.bucket)}</td>
                  <td className="num">{l.amount}</td>
                  <td>{l.memo}</td>
                  <td>{date(l.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </>
  );
}

export function Contributions({ info }: { info: AppInfo }) {
  const [data] = useLoad(() => wos().contributions(), []);
  if (data.state === "loading") return <Loading what="YOUR CONTRIBUTIONS" />;
  if (data.state === "error") return <Notice label="COULD NOT LOAD CONTRIBUTIONS">{`${data.code}. ${data.message}`}</Notice>;
  return <ContributionsView history={data.value} disclaimer={info.tokenDisclaimer} />;
}

// ------------------------------------------------------------------------------------ profile

export function ProfileView({ me, status, disclaimer }: { me: Me; status: LocalStatus | null; disclaimer: string }) {
  return (
    <>
      <Title label="PROFILE / THIS ACCOUNT AND THIS DEVICE" title={me.displayName ?? me.handle ?? me.email} />
      <Section n="01" title="ACCOUNT">
        <KV
          rows={[
            ["EMAIL", me.email],
            ["HANDLE", me.handle ?? "NONE YET (SET WHEN GITHUB IS FIRST LINKED)"],
            ["GITHUB", me.github ? `${me.github.login} / LINKED ${date(me.github.linkedAt)}` : "NOT LINKED"],
            ["MAY CONTRIBUTE", me.canContribute ? "YES" : "NO"],
            ["STATUS", upper(me.status)],
            ["ROLES", me.roles.length ? me.roles.map(upper).join(", ") : "CONTRIBUTOR"],
          ]}
        />
      </Section>
      <Section n="02" title="WOS TOKENS" aside={disclaimer}>
        <Cells
          rows={[
            ["SCORE", String(me.balance.score)],
            ["AVAILABLE", String(me.balance.available)],
            ["HELD", String(me.balance.held)],
          ]}
        />
      </Section>
      <Section n="03" title="THIS DEVICE" aside={status ? `CHECKED ${status.providers[0]?.checkedAt ?? "NEVER"}` : "NOT CHECKED"}>
        {!status ? (
          <Empty title="NO STATUS YET">Run STATUS to check git, the claude and codex CLIs and the toolchain.</Empty>
        ) : (
          <>
            <table className="tbl" data-testid="providers">
              <thead>
                <tr>
                  <th>TOOL</th>
                  <th>INSTALLED</th>
                  <th>VERSION</th>
                  <th>SIGNED IN</th>
                  <th>MODELS</th>
                  <th>PROBLEMS</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">GIT</th>
                  <td>{status.git.installed ? "YES" : "NO"}</td>
                  <td>{status.git.version ?? "NONE"}</td>
                  <td className="dim">N/A</td>
                  <td className="dim">N/A</td>
                  <td>{status.git.installed ? "NONE" : "GIT IS NOT INSTALLED"}</td>
                </tr>
                {status.providers.map((p) => (
                  <tr key={p.provider}>
                    <th scope="row">{p.provider === "claude_cli" ? "CLAUDE" : p.provider === "codex_cli" ? "CODEX" : upper(p.provider)}</th>
                    <td>{p.installed ? "YES" : "NO"}</td>
                    <td>{p.cliVersion ?? "NONE"}</td>
                    <td>{p.signedIn ? `YES (${p.authMethod ?? "UNKNOWN METHOD"})` : "NO"}</td>
                    <td>{p.models.map((m) => m.toUpperCase()).join(", ")}</td>
                    <td>{p.problems.length ? p.problems.join("; ").toUpperCase() : "NONE"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="label" style={{ margin: "1.25rem 0 0.5rem" }}>
              TOOLCHAIN ATTESTATION (D13: DECIDES WHICH NATIVE UNITS THIS DEVICE MAY CLAIM)
            </p>
            {status.toolchain ? (
              <KV
                rows={[
                  ["OS", `${upper(status.toolchain.os)} ${status.toolchain.osVersion}`],
                  ...status.toolchain.tools.map((t): [string, string] => [upper(t.name), t.version]),
                  ["CHECKED", status.toolchain.checkedAt],
                ]}
              />
            ) : (
              <Empty title="NOT ATTESTED YET">The attestation is posted by the first STATUS run with a linked GitHub.</Empty>
            )}
            <p className="label" style={{ margin: "1.25rem 0 0.5rem" }}>
              ROLES THIS DEVICE CAN SERVE
            </p>
            <p>{status.eligibleRoles.length ? status.eligibleRoles.map(upper).join(", ") : "NONE: NO MODEL CLI IS READY."}</p>
            <p className="fine">WORKSPACE: {status.workspaceRoot}</p>
          </>
        )}
      </Section>
    </>
  );
}

export function Profile({
  me,
  info,
  status,
  onStatus,
}: {
  me: Me;
  info: AppInfo;
  status: LocalStatus | null;
  onStatus: (s: LocalStatus) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = () => {
    setBusy(true);
    setError(null);
    wos()
      .status()
      .then(onStatus)
      .catch((e: unknown) => {
        const { code, message } = splitBridgeError(e);
        setError(`${code}. ${message}`);
      })
      .finally(() => setBusy(false));
  };
  return (
    <>
      <div className="btn-row" style={{ float: "right" }}>
        <button className="btn" type="button" onClick={run} disabled={busy} data-testid="run-status">
          {busy ? "CHECKING..." : "RUN STATUS"}
        </button>
      </div>
      {error ? <Notice label="STATUS FAILED">{error}</Notice> : null}
      <ProfileView me={me} status={status} disclaimer={info.tokenDisclaimer} />
    </>
  );
}

// ------------------------------------------------------------------------------------ settings

export function SettingsView({
  settings,
  me,
  info,
  onChange,
  onLogout,
  onOpen,
}: {
  settings: LocalSettings;
  me: Me | null;
  info: AppInfo;
  onChange: (patch: Partial<LocalSettings>) => void;
  onLogout: () => void;
  onOpen: (url: string) => void;
}) {
  const [deviceName, setDeviceName] = useState(settings.deviceName);
  useEffect(() => setDeviceName(settings.deviceName), [settings.deviceName]);
  return (
    <>
      <Title label="SETTINGS / THIS DEVICE" title="SETTINGS" />
      <Section n="01" title="BUILDS">
        <label className="check" style={{ marginBottom: "1rem" }}>
          <input type="checkbox" checked={settings.detachAfterSubmit} onChange={(e) => onChange({ detachAfterSubmit: e.target.checked })} />
          <span>
            STOP FOLLOWING A BUILD AFTER SUBMISSION
            <span className="fine" style={{ display: "block" }}>
              The control plane drives CI, the two reviews, qualification and the PR either way. When on, this device is free for the next
              unit right after VERIFY and submit.
            </span>
          </span>
        </label>
        <div className="field">
          <span className="label">PREFERRED BUILDER MODEL</span>
          <div className="btn-row">
            {(["opus", "astra", "sol"] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={settings.preferredModel === m ? "btn btn--primary" : "btn btn--quiet"}
                aria-pressed={settings.preferredModel === m}
                onClick={() => onChange({ preferredModel: m })}
              >
                {m.toUpperCase()}
              </button>
            ))}
            <button
              type="button"
              className={settings.preferredModel === null ? "btn btn--primary" : "btn btn--quiet"}
              aria-pressed={settings.preferredModel === null}
              onClick={() => onChange({ preferredModel: null })}
            >
              POLICY DEFAULT
            </button>
          </div>
          <span className="fine">Used only when the model is attested on this device; otherwise the policy default is preselected.</span>
        </div>
      </Section>
      <Section n="02" title="DEVICE">
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault();
            onChange({ deviceName });
          }}
        >
          <label className="label" htmlFor="device-name">
            DEVICE NAME (SENT AT SIGN-IN)
          </label>
          <input id="device-name" type="text" maxLength={64} value={deviceName} onChange={(e) => setDeviceName(e.target.value)} />
          <div className="btn-row">
            <button className="btn" type="submit" disabled={deviceName.trim() === settings.deviceName || !deviceName.trim()}>
              SAVE
            </button>
          </div>
        </form>
        <div className="field">
          <label className="label" htmlFor="poll">
            ACTIVITY POLL INTERVAL (SECONDS, 5 TO 300)
          </label>
          <input
            id="poll"
            type="number"
            min={5}
            max={300}
            value={settings.eventsPollSeconds}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isInteger(v) && v >= 5 && v <= 300) onChange({ eventsPollSeconds: v });
            }}
          />
        </div>
      </Section>
      <Section n="03" title="ACCOUNT PREFERENCES" aside="READ ONLY IN wOS DESKTOP">
        {me ? (
          <>
            <KV
              rows={[
                ["DISPLAY NAME", me.displayName ?? "NONE"],
                ["LEADERBOARD", me.leaderboardOptIn ? "OPTED IN" : "NOT OPTED IN"],
                ["PROGRESS EMAILS", me.progressEmails ? "ON" : "OFF"],
                ["FOLLOWED TARGETS", me.followedTargets.length ? me.followedTargets.join(", ") : "NONE"],
              ]}
            />
            <p className="fine" style={{ marginTop: "0.75rem" }}>
              These are stored on the control plane. wOS Desktop cannot change them yet (blocker B-0003-desktop); change them on the
              website.
            </p>
            <div className="btn-row">
              <button className="btn btn--quiet" type="button" onClick={() => onOpen("https://waronsaas.com/")}>
                OPEN waronsaas.com
              </button>
            </div>
          </>
        ) : (
          <Empty title="NOT SIGNED IN" />
        )}
      </Section>
      <Section n="04" title="SESSION AND BUILD">
        <KV
          rows={[
            ["wOS DESKTOP", info.version],
            ["CONTRACTS", info.contractsVersion],
            ["CONTROL PLANE", info.fakeControlPlane ? `${info.apiBaseUrl} (FAKE)` : info.apiBaseUrl],
            ["PLATFORM", upper(info.platform)],
            ["SESSION STORAGE", "OS KEYCHAIN (ELECTRON SAFESTORAGE). NEVER A PLAIN FILE."],
          ]}
        />
        {me ? (
          <div className="btn-row" style={{ marginTop: "1rem" }}>
            <button className="btn" type="button" onClick={onLogout} data-testid="logout">
              SIGN OUT
            </button>
          </div>
        ) : null}
      </Section>
    </>
  );
}

export function Settings({ me, info, onLoggedOut }: { me: Me | null; info: AppInfo; onLoggedOut: () => void }) {
  const [data, reload] = useLoad(() => wos().getSettings(), []);
  const [error, setError] = useState<string | null>(null);
  if (data.state === "loading") return <Loading what="SETTINGS" />;
  if (data.state === "error") return <Notice label="COULD NOT LOAD SETTINGS">{`${data.code}. ${data.message}`}</Notice>;
  const fail = (e: unknown) => {
    const { code, message } = splitBridgeError(e);
    setError(`${code}. ${message}`);
  };
  return (
    <>
      {error ? <Notice label="NOT SAVED">{error}</Notice> : null}
      <SettingsView
        settings={data.value}
        me={me}
        info={info}
        onChange={(patch) => wos().setSettings(patch).then(reload).catch(fail)}
        onLogout={() => wos().logout().then(onLoggedOut).catch(fail)}
        onOpen={(url) => wos().openExternal(url).catch(fail)}
      />
    </>
  );
}
