import { TOKEN_DISCLAIMER } from "@waronsaas/contracts";
import { describe, expect, it } from "vitest";
import { rankLeaderboard } from "../src/index.js";
import { ALICE, at, BOB, CAROL, u } from "./support.js";

describe("rankLeaderboard mirrors v_leaderboard", () => {
  it("ranks opted-in active accounts with a handle and positive score, by score then account age", () => {
    const DAN = u(0xda);
    const EVE = u(0xe7e);
    const rows = rankLeaderboard(
      [
        { accountId: ALICE, held: 0, available: 50, score: 50 },
        { accountId: BOB, held: 90, available: 0, score: 90 },
        { accountId: CAROL, held: 0, available: 50, score: 50 },
        { accountId: DAN, held: 0, available: 0, score: 0 },
        { accountId: EVE, held: 0, available: 500, score: 500 },
      ],
      [
        { accountId: ALICE, handle: "alice", optedIn: true, active: true, createdAt: at(-10) },
        { accountId: BOB, handle: "bob", optedIn: true, active: true, createdAt: at(-1) },
        { accountId: CAROL, handle: "carol", optedIn: true, active: true, createdAt: at(-20) },
        { accountId: DAN, handle: "dan", optedIn: true, active: true, createdAt: at(-30) },
        { accountId: EVE, handle: "eve", optedIn: false, active: true, createdAt: at(-30) },
      ],
    );
    expect(rows.map((r) => [r.rank, r.handle, r.score])).toEqual([
      [1, "bob", 90],
      [2, "carol", 50],
      [3, "alice", 50],
    ]);
  });

  it("the disclaimer the public views carry is the D3 wording", () => {
    expect(TOKEN_DISCLAIMER).toBe("WOS tokens are in-app credits with no cash value.");
  });
});
