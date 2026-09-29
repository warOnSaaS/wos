/**
 * The ONE way the control plane changes a state column (DOMAIN-MODEL.md section 3):
 *   1. the transition must exist in the machine table and allow the actor;
 *   2. one guarded UPDATE `... where id = $id and state = $from [and row_version = $v] [and <guard>]`;
 *   3. zero rows => 409 CONFLICT (the caller's transaction rolls back);
 *   4. exactly one wos.events row in the same transaction.
 */
import { type Actor, findTransition, type Machine } from "@waronsaas/contracts";
import type { Tx } from "@waronsaas/db";
import type postgres from "postgres";
import { ApiFailure } from "../errors.js";
import { type EventBody, type EventActor, insertEvent } from "./events.js";

export interface TransitionSpec<S extends string, E extends string> {
  machine: Machine<S, E>;
  /** Table in schema wos. */
  table: string;
  id: string;
  from: S;
  event: E;
  actor: EventActor;
  actorAccountId: string | null;
  rowVersion?: number;
  /** Extra columns written by the same UPDATE. */
  set?: Record<string, unknown>;
  /** Extra guard, re-checked inside the UPDATE (e.g. `expires_at <= now()`). */
  guard?: postgres.PendingQuery<postgres.Row[]>;
  /** The event for this transition. */
  emit: EventBody;
  aggregateKind: string;
}

type FaultHook = (info: { table: string; event: string; id: string }) => void;
let faultAfterUpdate: FaultHook | null = null;

/** Test hook: throw after the guarded UPDATE and before the event insert (proves both roll back together). */
export function setTransitionFaultHook(hook: FaultHook | null): void {
  faultAfterUpdate = hook;
}

export async function transition<S extends string, E extends string>(tx: Tx, spec: TransitionSpec<S, E>): Promise<Record<string, unknown>> {
  const t = findTransition(spec.machine, spec.from, spec.event);
  if (!t) throw new Error(`${spec.machine.name}: no transition ${spec.from} --${spec.event}-->`);
  if (!t.actor.includes(spec.actor as Actor)) throw new Error(`${spec.machine.name}: ${spec.actor} may not ${spec.event}`);
  const set: Record<string, unknown> = { ...(spec.set ?? {}), state: t.to };
  const rows = await tx`
    update ${tx(`wos.${spec.table}`)}
       set ${tx(set as Record<string, postgres.ParameterOrJSON<never>>)}, row_version = row_version + 1
     where id = ${spec.id} and state = ${spec.from}
       ${spec.rowVersion === undefined ? tx`` : tx`and row_version = ${spec.rowVersion}`}
       ${spec.guard ? tx`and ${spec.guard}` : tx``}
    returning *`;
  if (rows.length === 0) {
    throw new ApiFailure("CONFLICT", `${spec.machine.name} ${spec.id} is no longer ${spec.from}; re-read and decide`, {
      machine: spec.machine.name,
      from: spec.from,
      event: spec.event,
    });
  }
  faultAfterUpdate?.({ table: spec.table, event: spec.event, id: spec.id });
  await insertEvent(tx, spec.emit, {
    aggregateKind: spec.aggregateKind,
    aggregateId: spec.id,
    actor: spec.actor,
    actorAccountId: spec.actorAccountId,
  });
  return rows[0] as Record<string, unknown>;
}
