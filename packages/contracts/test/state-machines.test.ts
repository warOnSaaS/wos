import { describe, expect, it } from "vitest";
import { ALL_MACHINES, AttemptMachine, DocumentMachine, findTransition } from "../src/index.js";

describe("state machines", () => {
  for (const m of ALL_MACHINES) {
    describe(m.name, () => {
      const states = new Set<string>(m.states);

      it("only references declared states", () => {
        for (const s of [...m.initial, ...m.terminal]) expect(states.has(s)).toBe(true);
        for (const t of m.transitions) {
          expect(states.has(t.from), `${t.from} in ${m.name}`).toBe(true);
          expect(states.has(t.to), `${t.to} in ${m.name}`).toBe(true);
          expect(t.actor.length).toBeGreaterThan(0);
          expect(t.guard.length).toBeGreaterThan(10);
        }
      });

      it("is deterministic: at most one transition per (from, event)", () => {
        const seen = new Set<string>();
        for (const t of m.transitions) {
          const k = `${t.from}|${t.event}`;
          expect(seen.has(k), `duplicate ${k} in ${m.name}`).toBe(false);
          seen.add(k);
        }
      });

      it("terminal states have no outgoing transitions except self-loops", () => {
        for (const t of m.transitions) {
          if ((m.terminal as readonly string[]).includes(t.from)) expect(t.to).toBe(t.from);
        }
      });

      it("every non-terminal state has a way out and every state is reachable", () => {
        const reachable = new Set<string>(m.initial);
        let grew = true;
        while (grew) {
          grew = false;
          for (const t of m.transitions) {
            if (reachable.has(t.from) && !reachable.has(t.to)) {
              reachable.add(t.to);
              grew = true;
            }
          }
        }
        for (const s of m.states) expect(reachable.has(s), `${s} unreachable in ${m.name}`).toBe(true);
        for (const s of m.states) {
          if ((m.terminal as readonly string[]).includes(s)) continue;
          expect(
            m.transitions.some((t) => t.from === s && t.to !== s),
            `${s} is a dead end in ${m.name}`,
          ).toBe(true);
        }
      });
    });
  }

  it("the attempt pipeline follows LEASE -> BUILD -> VERIFY -> REVIEW -> QUALIFY -> PR", () => {
    const path = [
      ["leased", "start_build", "building"],
      ["building", "start_verify", "verifying"],
      ["verifying", "submit_changeset", "submitted"],
      ["submitted", "candidate_committed", "candidate_pushed"],
      ["candidate_pushed", "ci_passed", "in_review"],
      ["in_review", "round_passed_and_qualified", "qualified"],
      ["qualified", "pr_opened", "pr_open"],
      ["pr_open", "pr_merged", "merged"],
    ] as const;
    for (const [from, event, to] of path) expect(findTransition(AttemptMachine, from, event)?.to).toBe(to);
    // No transition reaches pr_open except from qualified (D9: no PR before qualification).
    expect(AttemptMachine.transitions.filter((t) => t.to === "pr_open").map((t) => t.from)).toEqual(["qualified"]);
  });

  it("documents reach consensus only from a review round", () => {
    expect(DocumentMachine.transitions.filter((t) => t.to === "consensus").map((t) => t.from)).toEqual(["in_review"]);
    expect(DocumentMachine.transitions.filter((t) => t.to === "merged").every((t) => t.from === "consensus")).toBe(true);
  });
});
