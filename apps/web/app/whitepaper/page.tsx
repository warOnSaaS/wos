import { JsonLd } from "@/components/JsonLd";
import { Section } from "@/components/Section";
import { renderBlock } from "@/lib/markdown";
import { breadcrumbLd, pageMetadata, whitepaperLd } from "@/lib/seo";
import {
  AGENT_LINKS,
  COMPANIONS,
  HANDOFF_PROMPT,
  WHITEPAPER_PACK_PATH,
  WHITEPAPER_DOWNLOAD_PATH,
  WHITEPAPER_HISTORY_URL,
  WHITEPAPER_MD_PATH,
  WHITEPAPER_META,
  WHITEPAPER_PATH,
  WHITEPAPER_SOURCE_URL,
  WHITEPAPER_V01_URL,
  downloadFilename,
  lastUpdatedDay,
  packFilename,
  whitepaper,
} from "@/lib/whitepaper";

const wp = whitepaper();
const FILE = downloadFilename(wp.version);
const PACK = packFilename(wp.version);

export const metadata = pageMetadata({
  title: `White paper v${wp.version}: for your AI agent`,
  description:
    "The warOnSaaS white paper is written for AI agents. Download it, give it to your agent with the prompt, and get a critical evaluation: is the idea compelling, how important is it, what exists, which edge cases are handled.",
  path: WHITEPAPER_PATH,
  defaultImage: false,
  alternateMarkdown: WHITEPAPER_MD_PATH,
});

// Progressive enhancement only: shows the COPY PROMPT button and copies the prompt. Without JS the
// prompt stays visible and selectable, and every link works. Also opens the full text when a link
// points inside it.
const SCRIPT = `(function(){
var b=document.getElementById("wp-copy"),t=document.getElementById("wp-prompt");
if(b&&t&&navigator.clipboard){b.hidden=false;b.addEventListener("click",function(){
navigator.clipboard.writeText(t.value).then(function(){b.textContent="COPIED";setTimeout(function(){b.textContent="COPY PROMPT"},2000)},function(){t.focus();t.select()})})}
function openFor(){var h=location.hash.slice(1);if(!h)return;var e=document.getElementById(h),d=document.getElementById("full-text");if(e&&d&&d.contains(e)&&!d.open){d.open=true;e.scrollIntoView()}}
window.addEventListener("hashchange",openFor);openFor();})();`;

export default function WhitepaperPage() {
  return (
    <>
      <div className="title">
        <p className="label">WHITE PAPER // v{wp.version} // FOR AI AGENTS</p>
        <h1>This document is written for your AI agent.</h1>
        <p className="lead">
          Give it to your agent. It asks the agent to verify our claims, judge us critically and tell you, in eight
          points, whether the idea is compelling, how important it is, what actually exists and what we missed.
        </p>
      </div>

      <div className="sec handoff" id="handoff" aria-label="Hand the white paper to your agent">
        <div className="handoff-actions">
          <a className="cmd cmd--big" href={WHITEPAPER_DOWNLOAD_PATH} download={FILE}>
            DOWNLOAD FOR YOUR AGENT
          </a>
          <button type="button" className="cmd cmd--big" id="wp-copy" hidden>
            COPY PROMPT
          </button>
          <a className="cmd cmd--big" href={AGENT_LINKS.chatgpt(HANDOFF_PROMPT)} target="_blank" rel="noopener noreferrer">
            OPEN IN CHATGPT
          </a>
          <a className="cmd cmd--big" href={AGENT_LINKS.claude(HANDOFF_PROMPT)} target="_blank" rel="noopener noreferrer">
            OPEN IN CLAUDE
          </a>
        </div>
        <p className="fine">
          {FILE}: the core paper, one Markdown file your agent can read in full. For depth, also{" "}
          <a href={WHITEPAPER_PACK_PATH} download={PACK}>download the full pack</a> ({PACK}: the core plus four companion
          files). OPEN IN CHATGPT and OPEN IN CLAUDE start a new chat with the prompt filled in; the agent opens
          the paper itself. GLM does not accept a pre-filled prompt, so{" "}
          <a href={AGENT_LINKS.glm} target="_blank" rel="noopener noreferrer">open GLM and paste the prompt</a>. On a phone,
          these links open the installed app where your phone supports it.
        </p>

        <label className="label" htmlFor="wp-prompt">
          THE PROMPT
        </label>
        <textarea id="wp-prompt" className="prompt" readOnly rows={12} defaultValue={HANDOFF_PROMPT} />
        <p className="fine">
          Works pasted alone if your agent can browse (it fetches <a href={WHITEPAPER_MD_PATH}>waronsaas.com/whitepaper.md</a>),
          or together with the downloaded file.
        </p>

        <ol className="steps">
          <li>
            <span className="steps__n">1</span>
            <span>
              <strong>Download</strong> the paper: <a href={WHITEPAPER_DOWNLOAD_PATH} download={FILE}>{FILE}</a>.
            </span>
          </li>
          <li>
            <span className="steps__n">2</span>
            <span>
              <strong>Upload</strong> it to your agent (Claude, ChatGPT, GLM or any capable assistant): attach the file
              to a new chat.
            </span>
          </li>
          <li>
            <span className="steps__n">3</span>
            <span>
              <strong>Paste</strong> the prompt above and send. Your agent reports back; a low score is an acceptable
              answer.
            </span>
          </li>
        </ol>

        <dl className="kv">
          <div>
            <dt>Version</dt>
            <dd>{wp.version}</dd>
          </div>
          <div>
            <dt>Last updated</dt>
            <dd>
              {lastUpdatedDay && WHITEPAPER_META.commitUrl ? (
                <>
                  <time dateTime={WHITEPAPER_META.lastUpdated ?? undefined}>{lastUpdatedDay}</time>{" "}
                  <span className="fine">
                    from git, commit <a href={WHITEPAPER_META.commitUrl}>{WHITEPAPER_META.lastCommit?.slice(0, 7)}</a>
                  </span>
                </>
              ) : (
                "No commit yet"
              )}
            </dd>
          </div>
          <div>
            <dt>History</dt>
            <dd>
              <a href={WHITEPAPER_HISTORY_URL}>Every change to this file on GitHub</a>.{" "}
              <a href={WHITEPAPER_SOURCE_URL}>Source</a>. <a href={WHITEPAPER_V01_URL}>v0.1, kept verbatim</a>.
            </dd>
          </div>
          <div>
            <dt>Companion files</dt>
            <dd>
              Optional depth, one Markdown file each:{" "}
              {COMPANIONS.map((c, i) => (
                <span key={c.slug}>
                  {i ? "; " : ""}
                  <a href={`/whitepaper/${c.slug}.md`}>{c.title}</a> ({c.about})
                </span>
              ))}
              . Or all of them in the <a href={WHITEPAPER_PACK_PATH} download={PACK}>full pack</a>.
            </dd>
          </div>
          <div>
            <dt>For browsing agents</dt>
            <dd>
              <a href={WHITEPAPER_MD_PATH}>/whitepaper.md</a> (plain Markdown, shown in the browser)
            </dd>
          </div>
        </dl>
      </div>

      <div className="sec">
        <details className="fulltext" id="full-text">
          <summary>READ THE FULL TEXT</summary>
          <div className="brief wp">
            <nav className="toc" aria-label="White paper contents">
              <p className="label">CONTENTS</p>
              <ol>
                {wp.sections.map((s) => (
                  <li key={s.id}>
                    <span aria-hidden="true">{s.n ?? "--"}</span>
                    <a href={`#${s.id}`}>{s.title}</a>
                  </li>
                ))}
              </ol>
            </nav>

            <div className="brief-body">
              {wp.sections.map((s) => (
                <Section key={s.id} n={s.n ?? undefined} title={s.title} id={s.id}>
                  {s.blocks.map((b, j) => renderBlock(b, `${s.id}-${j}`))}
                </Section>
              ))}
            </div>
          </div>
        </details>
      </div>

      <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
      <JsonLd data={whitepaperLd(wp)} />
      <JsonLd
        data={breadcrumbLd([
          { name: "warOnSaaS", path: "/" },
          { name: "White paper", path: WHITEPAPER_PATH },
        ])}
      />
    </>
  );
}
