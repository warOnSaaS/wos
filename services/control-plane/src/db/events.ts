import { CONTRACTS_VERSION, type DomainEventBody, DomainEventBody as DomainEventBodySchema } from "@waronsaas/contracts";
import type { Tx } from "@waronsaas/db";

/** Actor kinds allowed in wos.events.actor_kind (state-machines.ts `Actor`). */
export type EventActor = "contributor" | "maintainer" | "system" | "github";

export type EventBody = DomainEventBody;

export interface EventMeta {
  aggregateKind: string;
  aggregateId: string;
  actor: EventActor;
  actorAccountId: string | null;
  idempotencyKey?: string | null;
}

/** Inserts one domain event (append-only) in the caller's transaction and returns its id. */
export async function insertEvent(tx: Tx, body: EventBody, meta: EventMeta): Promise<number> {
  const parsed = DomainEventBodySchema.safeParse(body);
  if (!parsed.success) throw new Error(`event ${body.type} does not match events.ts: ${parsed.error.message}`);
  const [row] = await tx<{ id: string }[]>`
    insert into wos.events (type, v, visibility, aggregate_kind, aggregate_id, actor_account_id, actor_kind, payload, contracts_version, idempotency_key)
    values (${body.type}, ${body.v}, ${body.visibility}, ${meta.aggregateKind}, ${meta.aggregateId}, ${meta.actorAccountId},
            ${meta.actor}, ${tx.json(body.payload as never)}, ${CONTRACTS_VERSION}, ${meta.idempotencyKey ?? null})
    returning id`;
  return Number(row!.id);
}
