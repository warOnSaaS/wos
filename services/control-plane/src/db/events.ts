import { CONTRACTS_VERSION, type DomainEventBody, DomainEventBody as DomainEventBodySchema } from "@waronsaas/contracts";
import type { Tx } from "@waronsaas/db";

/** Actor kinds allowed in wos.events.actor_kind (state-machines.ts `Actor`). */
export type EventActor = "contributor" | "maintainer" | "system" | "github";

/**
 * Event types a transition needs but events.ts does not define yet (blockers/B-0002-control-plane.md).
 * They are written as PRIVATE events so the one-event-per-transition rule holds in the database; the
 * API never returns them (they do not parse as DomainEvent) until the contract adds them.
 */
export type PendingEventType =
  | "document.state_changed"
  | "round.cancelled"
  | "contribution.state_changed"
  | "proposal.state_changed"
  | "blocker.state_changed"
  | "inventory_version.state_changed";

export type EventBody = DomainEventBody | { type: PendingEventType; v: 1; visibility: "private"; payload: Record<string, unknown> };

export interface EventMeta {
  aggregateKind: string;
  aggregateId: string;
  actor: EventActor;
  actorAccountId: string | null;
  idempotencyKey?: string | null;
}

/** Inserts one domain event (append-only) in the caller's transaction and returns its id. */
export async function insertEvent(tx: Tx, body: EventBody, meta: EventMeta): Promise<number> {
  if (!isPending(body.type)) {
    const parsed = DomainEventBodySchema.safeParse(body);
    if (!parsed.success) throw new Error(`event ${body.type} does not match events.ts: ${parsed.error.message}`);
  }
  const [row] = await tx<{ id: string }[]>`
    insert into wos.events (type, v, visibility, aggregate_kind, aggregate_id, actor_account_id, actor_kind, payload, contracts_version, idempotency_key)
    values (${body.type}, ${body.v}, ${body.visibility}, ${meta.aggregateKind}, ${meta.aggregateId}, ${meta.actorAccountId},
            ${meta.actor}, ${tx.json(body.payload as never)}, ${CONTRACTS_VERSION}, ${meta.idempotencyKey ?? null})
    returning id`;
  return Number(row!.id);
}

const PENDING = new Set<string>([
  "document.state_changed",
  "round.cancelled",
  "contribution.state_changed",
  "proposal.state_changed",
  "blocker.state_changed",
  "inventory_version.state_changed",
]);

function isPending(type: string): boolean {
  return PENDING.has(type);
}
