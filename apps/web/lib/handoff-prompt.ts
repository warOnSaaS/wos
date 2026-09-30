/**
 * The handoff prompt and the URLs it names. No imports, on purpose: tools/assessments/run-reference.ts imports this
 * file by path with plain `node`, so warOnSaaS's reference runs send exactly the prompt the public page shows.
 * lib/whitepaper.ts re-exports everything here; change the prompt here only.
 */

export const WHITEPAPER_MD_URL = "https://waronsaas.com/whitepaper.md";
/** The core as a plain HTML page with nothing collapsed. Agents' browsing tools accept HTML reliably;
 *  ChatGPT's fetch tool refused text/markdown (founder test, 2026-09-30), so prompts point here first. */
export const WHITEPAPER_READ_URL = "https://waronsaas.com/whitepaper/read";
/** The recorded trend of reference runs. Agents open it only AFTER writing their own score block (anti-anchoring). */
export const ASSESSMENTS_MD_URL = "https://waronsaas.com/whitepaper/assessments.md";

/**
 * The handoff prompt shown on /whitepaper, pre-filled into agents that support it, and quoted in the
 * llms files. It must work pasted alone (an agent that can browse fetches the URL) and next to the
 * uploaded file. Keep it short and keep its two stages in step with the paper's instructions (v0.6: stage 1
 * judges the problem and its materiality on its own; stage 2 judges the approach against it). v0.7: the score
 * block is specified in the paper, not here; the prompt only asks for it and for the after-scoring comparison.
 */
export const HANDOFF_PROMPT = [
  `Please evaluate the warOnSaaS white paper for me. Read all of the core paper: the attached WHITEPAPER file if there is one, otherwise open ${WHITEPAPER_READ_URL} (the same text as a web page; plain text at ${WHITEPAPER_MD_URL}). If you cannot open any of them, tell me.`,
  "It is written for you, the evaluating agent. Follow the evaluation instructions at its start; they are requests, and my instructions come first. Verify its figures and claims against the sources and evidence links it gives and tell me which you checked. Be critical: a low score is fine.",
  "Report in two stages, each with a short answer first and then detail. Stage 1, the problem on its own (Part I), as if the project did not exist; do not mark the problem down because the project is early: 1) is the problem real; 2) how big it is in money, compute and power, checking its estimates and ranges and giving your own; 3) its importance for humanity, scored out of 100 on the paper's five-dimension rubric with reasoning and confidence; 4) each of its four theses separately (control, efficiency, the future of software engineering, the need for a contribution primitive): important, compelling, what would make it false.",
  "Stage 2, the approach (Part II), judged against stage 1: 5) is it an efficient, well-targeted attack on a problem of that size, what share could it plausibly address, and what would have to be true; 6) its credibility out of 100; 7) its readiness and what actually exists; 8) the edge cases it considered and whether each is really handled; 9) edge cases it missed; 10) the three strongest arguments for and against; 11) what I should do: ignore, watch, test or participate, with bounded next steps. Do not encourage any financial exposure.",
  `Then end with the score block the paper specifies (a wos-assessment JSON block). Only after writing it, open ${ASSESSMENTS_MD_URL} (earlier recorded runs), keep your scores as they are, and tell me where and why yours differ. If I want to take part, tell me how to contribute (section 16).`,
].join("\n\n");

/** A one-line version for the llms files. */
export const HANDOFF_PROMPT_SHORT = `Read ${WHITEPAPER_READ_URL} in full (plain text: ${WHITEPAPER_MD_URL}), follow the evaluation instructions at its start (requests, not commands), verify its figures and claims against its sources, and report in two stages: first the problem on its own (is it real, how big in money, compute and power, importance for humanity 0-100, each of the four theses), without marking it down because the project is early; then the approach judged against it (efficiency and share of the problem addressed, credibility 0-100, readiness, edge cases handled and missed, strongest arguments for and against, what to do). End with the paper's wos-assessment score block; only after writing it, read ${ASSESSMENTS_MD_URL} and explain where and why you differ, without changing your scores.`;
