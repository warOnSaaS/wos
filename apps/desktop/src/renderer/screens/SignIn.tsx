/**
 * D8: sign in by email (the 8-character code, or the wos://auth link opened on this machine), then link
 * GitHub to contribute. Both flows are the orchestrator's; this screen only collects input and shows
 * the events it streams.
 */
import type { Me } from "@waronsaas/contracts";
import { type FormEvent, useEffect, useState } from "react";
import { type DesktopEvent, splitBridgeError } from "../../shared/ipc.js";
import { Notice } from "../components/ui.js";
import { wos } from "../lib/hooks.js";

type Phase = "email" | "sending" | "code" | "checking";

export function SignIn({ onSignedIn, fake }: { onSignedIn: (me: Me) => void; fake: boolean }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<Phase>("email");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);

  useEffect(
    () =>
      wos().onEvent((e: DesktopEvent) => {
        if (e.kind === "deep_link") setNote(e.detail);
        if (e.kind !== "orchestrator" || e.runId !== null) return;
        const ev = e.event;
        if (ev.type === "sign_in") {
          if (ev.status === "email_sent" || ev.status === "waiting_for_code") setPhase("code");
          if (ev.status === "failed") setError(`SIGN-IN FAILED. ${ev.detail}`);
        }
        if (ev.type === "warning") {
          setError(`${ev.code}. ${ev.message}`);
          setPhase("code");
        }
      }),
    [],
  );

  const start = (ev: FormEvent) => {
    ev.preventDefault();
    setError(null);
    setPhase("sending");
    wos()
      .signIn(email)
      .then(onSignedIn)
      .catch((e: unknown) => {
        const { code: c, message } = splitBridgeError(e);
        if (c === "ABORTED") {
          setPhase("email");
          return;
        }
        setError(`${c}. ${message}`);
        setPhase("email");
      });
  };

  const submitCode = (ev: FormEvent) => {
    ev.preventDefault();
    setError(null);
    setTries((t) => t + 1);
    setPhase("checking");
    wos()
      .submitSignInCode(code)
      .catch((e: unknown) => {
        const { code: c, message } = splitBridgeError(e);
        setError(`${c}. ${message}`);
        setPhase("code");
      });
  };

  const cancel = () => {
    void wos().cancelSignIn();
    setPhase("email");
    setCode("");
    setTries(0);
  };

  return (
    <div className="gate">
      <section>
        <div className="mark">wOS</div>
        <div className="label">wOS DESKTOP / CONTRIBUTOR BUILD ENVIRONMENT</div>
        <h1 style={{ marginTop: "0.75rem" }}>SIGN IN</h1>
        <p style={{ marginTop: "1rem" }}>
          Your account is your email address. wOS sends a sign-in email with an 8-character code and a link. Type the code here, or open the
          link on this machine and wOS picks it up.
        </p>
        <p className="dim">GitHub is only needed to contribute. You link it after signing in.</p>
        <ol className="proc" style={{ marginTop: "2rem" }}>
          <li>
            <span className="n">01</span>
            <span>EMAIL: YOUR ADDRESS</span>
          </li>
          <li>
            <span className="n">02</span>
            <span>CODE: FROM THE EMAIL, OR OPEN ITS LINK HERE</span>
          </li>
          <li>
            <span className="n">03</span>
            <span>GITHUB: LINK IT TO TAKE WORK</span>
          </li>
        </ol>
      </section>
      <section>
        {phase === "email" || phase === "sending" ? (
          <form onSubmit={start}>
            <div className="label" style={{ marginBottom: "1.25rem" }}>
              STEP 01 OF 03
            </div>
            <div className="field">
              <label className="label" htmlFor="email">
                EMAIL
              </label>
              <input
                id="email"
                data-testid="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={phase === "sending"}
              />
            </div>
            <div className="btn-row">
              <button className="btn btn--primary" type="submit" disabled={phase === "sending" || !email} data-testid="send">
                {phase === "sending" ? "SENDING..." : "SEND SIGN-IN EMAIL"}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={submitCode}>
            <div className="label" style={{ marginBottom: "1.25rem" }}>
              STEP 02 OF 03
            </div>
            <p>
              EMAIL SENT TO <strong>{email}</strong>. It expires in 15 minutes.
            </p>
            <div className="field">
              <label className="label" htmlFor="code">
                8-CHARACTER CODE
              </label>
              <input
                id="code"
                data-testid="code"
                className="code-input"
                type="text"
                autoComplete="one-time-code"
                spellCheck={false}
                maxLength={9}
                placeholder="XXXX-XXXX"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                disabled={phase === "checking"}
              />
            </div>
            <div className="btn-row">
              <button
                className="btn btn--primary"
                type="submit"
                disabled={phase === "checking" || code.replace("-", "").length !== 8}
                data-testid="verify"
              >
                {phase === "checking" ? "CHECKING..." : "SIGN IN"}
              </button>
              <button className="btn btn--quiet" type="button" onClick={cancel}>
                USE ANOTHER EMAIL
              </button>
            </div>
            <p className="fine" style={{ marginTop: "1.25rem" }}>
              OR OPEN THE LINK IN THE EMAIL ON THIS MACHINE. A link opened on another machine does not sign this one in: it is bound to this
              request.
            </p>
            {tries > 0 ? <p className="fine">ATTEMPTS USED: {tries} OF 5</p> : null}
            {fake ? (
              <Notice label="FAKE CONTROL PLANE" quiet>
                The fake control plane accepts the code ABCD-EFGH.
              </Notice>
            ) : null}
          </form>
        )}
        {note ? (
          <Notice label="DEEP LINK" quiet>
            {note}
          </Notice>
        ) : null}
        {error ? <Notice label="NOT SIGNED IN">{error}</Notice> : null}
      </section>
    </div>
  );
}

export function LinkGithub({ me, onLinked, onLater }: { me: Me; onLinked: (me: Me) => void; onLater: () => void }) {
  const [code, setCode] = useState<{ verificationUri: string; userCode: string } | null>(null);
  const [state, setState] = useState<"idle" | "waiting" | "linked">("idle");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(
    () =>
      wos().onEvent((e) => {
        if (e.kind === "github_code") setCode({ verificationUri: e.verificationUri, userCode: e.userCode });
      }),
    [],
  );

  const link = () => {
    setError(null);
    setState("waiting");
    wos()
      .linkGithub()
      .then((m) => {
        setState("linked");
        onLinked(m);
      })
      .catch((e: unknown) => {
        const { code: c, message } = splitBridgeError(e);
        setState("idle");
        setError(
          c === "GITHUB_LINKED_ELSEWHERE"
            ? "THAT GITHUB ACCOUNT IS LINKED TO ANOTHER wOS ACCOUNT. One GitHub per account, one account per GitHub."
            : c === "GITHUB_RESERVED"
              ? "THAT GITHUB ACCOUNT WAS UNLINKED RECENTLY AND STAYS RESERVED TO ITS wOS ACCOUNT FOR 90 DAYS."
              : `${c}. ${message}`,
        );
      });
  };

  const copy = () => {
    if (!code) return;
    navigator.clipboard
      .writeText(code.userCode)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  return (
    <div className="gate">
      <section>
        <div className="mark">wOS</div>
        <div className="label">SIGNED IN AS {me.email}</div>
        <h1 style={{ marginTop: "0.75rem" }}>LINK GITHUB</h1>
        <p style={{ marginTop: "1rem" }}>
          To take a lease, review, propose or resolve, wOS needs your GitHub identity. Commits are credited to it; rewards stay with this
          account.
        </p>
        <p className="dim">
          wOS reads your GitHub id, login, account age and avatar once and keeps nothing else. You can browse the Sniper List without it.
        </p>
      </section>
      <section>
        <div className="label" style={{ marginBottom: "1.25rem" }}>
          STEP 03 OF 03
        </div>
        {state === "idle" ? (
          <div className="btn-row">
            <button className="btn btn--primary" type="button" onClick={link} data-testid="link-github">
              LINK GITHUB
            </button>
            <button className="btn btn--quiet" type="button" onClick={onLater} data-testid="later">
              LATER
            </button>
          </div>
        ) : null}
        {state === "waiting" ? (
          <>
            {code ? (
              <>
                <p>ON GITHUB, OPEN THIS PAGE AND ENTER THE CODE:</p>
                <p className="selectable">
                  <strong>{code.verificationUri}</strong>
                </p>
                <div className="bigcode" data-testid="github-code">
                  {code.userCode}
                </div>
                <div className="btn-row" style={{ marginTop: "1.25rem" }}>
                  <button className="btn" type="button" onClick={copy}>
                    {copied ? "CODE COPIED" : "COPY CODE"}
                  </button>
                </div>
                <p className="fine" style={{ marginTop: "1rem" }}>
                  wOS does not open this page for you: its link allowlist covers waronsaas.com and github.com/waronsaas only. Type the
                  address into your browser.
                </p>
              </>
            ) : (
              <p>STARTING GITHUB DEVICE FLOW...</p>
            )}
            <p className="label" style={{ marginTop: "1.5rem" }}>
              STATUS: WAITING FOR GITHUB
            </p>
          </>
        ) : null}
        {state === "linked" ? <p>LINKED.</p> : null}
        {error ? <Notice label="NOT LINKED">{error}</Notice> : null}
      </section>
    </div>
  );
}
