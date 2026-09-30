/**
 * Settings: the environment this device's apps use (Settings -> Environment, WOS-APP-PROTOCOL section 8), Build on
 * this device (the device half of S-40), local build preferences, the device, and the session.
 */
import type { Me } from "@waronsaas/contracts";
import { type FormEvent, useEffect, useState } from "react";
import { type AppInfo, type LocalSettings, type ShellState, splitBridgeError } from "../../shared/ipc.js";
import { Empty, KV, Loading, Notice, Section, Title } from "../components/ui.js";
import { upper } from "../lib/format.js";
import { useLoad, wos } from "../lib/hooks.js";

export interface EnvironmentActions {
  onEnvironment: (url: string | null) => void;
  onEnvSignIn: (email: string) => void;
  onEnvCode: (code: string) => void;
  onEnvSignOut: () => void;
}

export function EnvironmentSection({ shell, busy, ...act }: { shell: ShellState; busy: boolean } & EnvironmentActions) {
  const env = shell.environment;
  const d = env.descriptor;
  const [url, setUrl] = useState(env.url);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  useEffect(() => setUrl(env.url), [env.url]);
  const submitUrl = (e: FormEvent) => {
    e.preventDefault();
    act.onEnvironment(url.trim());
  };
  return (
    <Section n="01" title="ENVIRONMENT" aside={env.isDefault ? "wOS CLOUD" : "SELF-HOSTED OR OTHER"}>
      <p className="fine" style={{ marginBottom: "0.75rem" }}>
        Where this device's apps get their data. Sessions are per environment: signing in to one never signs in to another. Build does not
        use it: Build always works with api.waronsaas.com and your wOS account.
      </p>
      <KV
        rows={[
          ["ADDRESS", env.url],
          ["NAME", d ? d.name : "UNKNOWN"],
          ["KIND", d ? (d.kind === "cloud" ? "wOS CLOUD" : "SELF-HOSTED") : "UNKNOWN"],
          ["wOS CORE", d ? d.coreVersion : "UNKNOWN"],
          [
            "SIGN-IN",
            d ? (d.auth.kind === "wos_cloud" ? "wOS ACCOUNT" : d.auth.kind === "local" ? "THIS ENVIRONMENT'S OWN" : "OIDC") : "UNKNOWN",
          ],
          [
            "SESSION",
            env.session.signedIn
              ? `SIGNED IN${env.session.role ? ` AS ${upper(env.session.role)}` : ""}${env.session.expiresAt ? ` UNTIL ${env.session.expiresAt}` : ""}`
              : "NOT SIGNED IN",
          ],
        ]}
      />
      {env.problem ? (
        <Notice label="ENVIRONMENT PROBLEM" quiet>
          {env.problem}
        </Notice>
      ) : null}
      <form className="field" onSubmit={submitUrl} style={{ marginTop: "1rem" }}>
        <label className="label" htmlFor="env-url">
          ENVIRONMENT ADDRESS (HTTPS; HTTP ONLY FOR A CORE ON THIS MACHINE)
        </label>
        <input id="env-url" type="text" maxLength={512} value={url} onChange={(e) => setUrl(e.target.value)} data-testid="env-url" />
        <div className="btn-row">
          <button className="btn" type="submit" disabled={busy || !url.trim() || url.trim() === env.url} data-testid="env-set">
            USE THIS ENVIRONMENT
          </button>
          {!env.isDefault ? (
            <button
              className="btn btn--quiet"
              type="button"
              disabled={busy}
              onClick={() => act.onEnvironment(null)}
              data-testid="env-cloud"
            >
              BACK TO wOS CLOUD
            </button>
          ) : null}
        </div>
      </form>
      {d?.auth.kind === "local" ? (
        env.session.signedIn ? (
          <div className="btn-row" style={{ marginTop: "0.5rem" }}>
            <span className="dim">
              SIGNED IN TO {d.name} AS {env.session.email ?? "UNKNOWN"}
            </span>
            <button className="btn btn--quiet" type="button" disabled={busy} onClick={act.onEnvSignOut} data-testid="env-sign-out">
              SIGN OUT OF THIS ENVIRONMENT
            </button>
          </div>
        ) : env.session.waitingForCode ? (
          <form
            className="field"
            onSubmit={(e) => {
              e.preventDefault();
              act.onEnvCode(code.trim());
            }}
          >
            <label className="label" htmlFor="env-code">
              THE CODE {d.name} EMAILED TO {env.session.email ?? "YOU"}
            </label>
            <input id="env-code" type="text" maxLength={9} value={code} onChange={(e) => setCode(e.target.value)} data-testid="env-code" />
            <div className="btn-row">
              <button className="btn btn--primary" type="submit" disabled={busy || !code.trim()}>
                SIGN IN
              </button>
            </div>
          </form>
        ) : (
          <form
            className="field"
            onSubmit={(e) => {
              e.preventDefault();
              act.onEnvSignIn(email.trim());
            }}
          >
            <label className="label" htmlFor="env-email">
              SIGN IN TO {d.name}: YOUR EMAIL ON THIS ENVIRONMENT
            </label>
            <input
              id="env-email"
              type="email"
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="env-email"
            />
            <div className="btn-row">
              <button className="btn btn--primary" type="submit" disabled={busy || !email.trim()}>
                SEND CODE
              </button>
            </div>
          </form>
        )
      ) : null}
    </Section>
  );
}

export function BuildDeviceSection({ shell, onBuildOnDevice }: { shell: ShellState; onBuildOnDevice: (on: boolean) => void }) {
  const b = shell.build;
  return (
    <>
      <label className="check" style={{ marginBottom: "0.75rem" }}>
        <input type="checkbox" checked={b.onDevice} onChange={(e) => onBuildOnDevice(e.target.checked)} data-testid="build-on-device" />
        <span>
          USE BUILD ON THIS DEVICE
          <span className="fine" style={{ display: "block" }}>
            Lets wOS run the claude, codex and git processes, create worktrees under its workspace and attest your CLIs on this machine. Off
            by default. Build also needs to be enabled for one of your organizations.
          </span>
        </span>
      </label>
      <KV
        rows={[
          ["ENABLED FOR AN ORGANIZATION", b.entitled ? `YES (${b.entitledOrgs.length})` : "NO"],
          ["ON FOR THIS DEVICE", b.onDevice ? "YES" : "NO"],
          ["BUILD", b.open ? "ON" : "OFF"],
          ["LAST CHECKED", b.checkedAt ?? "NEVER"],
        ]}
      />
      {b.reason ? (
        <Notice label="BUILD IS OFF" quiet>
          {b.reason}
        </Notice>
      ) : null}
    </>
  );
}

export function SettingsView({
  settings,
  me,
  info,
  shell,
  busy = false,
  onChange,
  onLogout,
  onOpen,
  onBuildOnDevice,
  ...env
}: {
  settings: LocalSettings;
  me: Me | null;
  info: AppInfo;
  shell: ShellState;
  busy?: boolean;
  onChange: (patch: Partial<LocalSettings>) => void;
  onLogout: () => void;
  onOpen: (url: string) => void;
  onBuildOnDevice: (on: boolean) => void;
} & EnvironmentActions) {
  const [deviceName, setDeviceName] = useState(settings.deviceName);
  useEffect(() => setDeviceName(settings.deviceName), [settings.deviceName]);
  return (
    <>
      <Title label="SETTINGS / THIS DEVICE" title="SETTINGS" />
      <EnvironmentSection shell={shell} busy={busy} {...env} />
      <Section n="02" title="BUILD" aside="S-40">
        <BuildDeviceSection shell={shell} onBuildOnDevice={onBuildOnDevice} />
        <label className="check" style={{ margin: "1rem 0" }}>
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
      <Section n="03" title="DEVICE">
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
      <Section n="04" title="ACCOUNT PREFERENCES" aside="READ ONLY IN wOS DESKTOP">
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
      <Section n="05" title="SESSION">
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

export function Settings({
  me,
  info,
  shell,
  onShell,
  onLoggedOut,
}: {
  me: Me | null;
  info: AppInfo;
  shell: ShellState;
  onShell: (s: ShellState) => void;
  onLoggedOut: () => void;
}) {
  const [data, reload] = useLoad(() => wos().getSettings(), []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (data.state === "loading") return <Loading what="SETTINGS" />;
  if (data.state === "error") return <Notice label="COULD NOT LOAD SETTINGS">{`${data.code}. ${data.message}`}</Notice>;
  const fail = (e: unknown) => {
    const { code, message } = splitBridgeError(e);
    setError(`${code}. ${message}`);
  };
  const act = (p: Promise<ShellState>) => {
    setBusy(true);
    setError(null);
    p.then(onShell)
      .then(reload)
      .catch(fail)
      .finally(() => setBusy(false));
  };
  return (
    <>
      {error ? <Notice label="NOT DONE">{error}</Notice> : null}
      <SettingsView
        settings={data.value}
        me={me}
        info={info}
        shell={shell}
        busy={busy}
        onChange={(patch) => wos().setSettings(patch).then(reload).catch(fail)}
        onLogout={() => wos().logout().then(onLoggedOut).catch(fail)}
        onOpen={(url) => wos().openExternal(url).catch(fail)}
        onBuildOnDevice={(on) => act(wos().setBuildOnDevice(on))}
        onEnvironment={(url) => act(wos().setEnvironment(url))}
        onEnvSignIn={(email) => act(wos().environmentSignIn(email))}
        onEnvCode={(code) => act(wos().environmentSignInCode(code))}
        onEnvSignOut={() => act(wos().environmentSignOut())}
      />
    </>
  );
}
