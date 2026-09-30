/**
 * Build: link GitHub to contribute (D8, GitHub device flow through the orchestrator). The device code is shown with a
 * copy button; the GitHub page is typed by the user (S-29: it is outside the openExternal allowlist).
 */
import type { Me } from "@waronsaas/contracts";
import { useEffect, useState } from "react";
import { splitBridgeError } from "../../../shared/ipc.js";
import { Notice } from "../../../renderer/components/ui.js";
import { wos } from "../../../renderer/lib/hooks.js";

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
          BUILD / BEFORE YOUR FIRST LEASE
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
