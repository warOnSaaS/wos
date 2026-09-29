import { DomainEvent, type DomainEventBody, REWARD_SCHEDULE_V1 } from "@waronsaas/contracts";
import type { AwardFact, ContributionFact, RewardFacts } from "../src/index.js";

export const schedule = REWARD_SCHEDULE_V1;

/** Stable, valid v4-shaped uuids: u(1) = 00000000-0000-4000-8000-000000000001. */
export function u(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

// Fixture times are relative to the clock (D7), never pinned absolute dates.
export const NOW = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
export const DAY = 86_400_000;
export const at = (offsetDays: number) => new Date(Date.parse(NOW) + offsetDays * DAY).toISOString();

let nextId = 1;
/** Builds an event and parses it against the contract, so fixtures are always valid events. */
export function ev(
  body: { type: DomainEventBody["type"]; visibility: "public" | "private"; payload: object },
  occurredAt = NOW,
): DomainEvent {
  return DomainEvent.parse({
    id: nextId++,
    occurredAt,
    actorAccountId: null,
    actorKind: "system",
    aggregateKind: body.type.split(".")[0]!,
    aggregateId: "x",
    contractsVersion: "4.0.0",
    v: 1,
    ...body,
  });
}

export function facts(extra: Partial<RewardFacts> = {}): RewardFacts {
  return { now: NOW, bootstrapSelfReviewed: false, ...extra };
}

export const ALICE = u(0xa11ce);
export const BOB = u(0xb0b);
export const CAROL = u(0xca401);

export function contribution(c: Partial<ContributionFact> & Pick<ContributionFact, "category">): ContributionFact {
  return { id: u(0xc0), accountId: ALICE, state: "accepted", independence: "independent", ...c };
}

export function accepted(c: ContributionFact, occurredAt = NOW): DomainEvent {
  return ev(
    {
      type: "contribution.accepted",
      visibility: "public",
      payload: { contributionId: c.id, accountId: c.accountId, category: c.category },
    },
    occurredAt,
  );
}

export function award(a: Partial<AwardFact> & Pick<AwardFact, "id">): AwardFact {
  return {
    accountId: ALICE,
    amount: 60,
    category: "implementation",
    contributionId: u(0xc0),
    poolId: null,
    scheduleVersion: "rewards.v1",
    releaseAfter: at(-1),
    released: false,
    reversed: false,
    blockedByBootstrap: false,
    ...a,
  };
}
