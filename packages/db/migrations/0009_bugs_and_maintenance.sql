-- 0009_bugs_and_maintenance.sql — DRAFT (D61, the first versioned addition after the protocol v1 freeze, D62).
-- Owner: Protocol Architect. DO NOT APPLY TO PRODUCTION (like 0007, which it extends). Numbered 0009 because the
-- architecture branch claims 0008; it depends only on 0007.
--
-- The economy side of bugs and maintenance. Engine-first (D51): the procedure lives in the rules
-- (packages/contracts/src/protocol/rules.ts: budgetModelMicro severity factor, receiptRouteRefusals BUG_TRIAGE /
-- BUG_FIX, bugReportOutcome, nextUnitEligibilityRefusals introducer bar); this migration adds only the invariants a
-- service bug must not be able to break:
--   B1  one triage DECISION per bug, append-only, made by the assigned reviewer of a commissioned triage task pinned to
--       a reward policy that has bug rules (v1 has none: fails closed); never by the first reporter or the introducer
--       (or a related account); the introducer and the within-window flag are DERIVED, never supplied.
--   B2  one paid report per bug (dedup key 'bug:' || bug id), only the decision's first reporter, only when the bug is
--       confirmed and its fix was accepted, never (a relative of) the introducer within the window, at most the pinned
--       per-epoch cap per reporter (serialized per reporter and epoch).
--   B3  a BUG_TRIAGE receipt is the decider's, on the triage task; a BUG_FIX receipt is on an execution budget bound to
--       the bug and its confirmed severity, under a lease, never (a relative of) the introducer within the window.
--   B4  the introducer's offset (the 14-day revert offset, recovered through the existing offsets / holdback path)
--       cites the bug, the introducing receipt and the introducer, at most one per bug, equal to the report's pay.
-- Sweeps have no receipt type: they are paid only through confirmed, fixed bugs (as reports and fixes).

-- ============================================================================================
-- Types
-- ============================================================================================
alter table wos.contribution_receipts drop constraint contribution_receipts_contribution_type_check;
alter table wos.contribution_receipts add constraint contribution_receipts_contribution_type_check check (contribution_type in (
  'APPLICATION_ROADMAP', 'FEATURE_SPECIFICATION', 'ARCHITECTURE_RESOLUTION', 'IMPLEMENTATION', 'AGENT_REVIEW', 'HUMAN_REVIEW',
  'SECURITY', 'INTEGRATION', 'DOCUMENTATION', 'OTHER_PROTOCOL_APPROVED', 'PROPOSAL', 'BUG_REPORT', 'AUDIT_RERUN',
  'BUG_TRIAGE', 'BUG_FIX'));

alter table wos.human_review_assignments drop constraint human_review_assignments_subject_kind_check;
alter table wos.human_review_assignments add constraint human_review_assignments_subject_kind_check
  check (subject_kind in ('attempt', 'document', 'receipt', 'genesis', 'security_report', 'bug'));

-- ============================================================================================
-- B1: triage decisions
-- ============================================================================================
create table wos.bug_triage_decisions (
  bug_id                     uuid primary key,
  triage_task_id             uuid not null unique references wos.human_review_assignments (task_id),
  outcome                    text not null check (outcome in ('confirmed', 'rejected', 'duplicate')),
  severity                   text check (severity in ('low', 'medium', 'high', 'critical')),
  duplicate_of_bug_id        uuid references wos.bug_triage_decisions (bug_id),
  feature_key                text check (length(feature_key) <= 200),
  first_reporter_account_id  uuid references wos.accounts (id),
  first_report_ref           text check (length(first_report_ref) <= 512),
  introducing_receipt_id     uuid references wos.contribution_receipts (id),
  introducer_account_id      uuid references wos.accounts (id),       -- server-set from the introducing receipt
  introduced_within_window   boolean not null default false,          -- server-set: receipt accepted within window_days
  window_days                integer not null default 0,              -- server-set from the triage task's pinned policy
  policy_version             text not null default '',                -- server-set: the triage task's pinned reward policy
  decided_by_account_id      uuid not null references wos.accounts (id),
  decided_at                 timestamptz not null default now(),      -- server-set
  check ((outcome = 'confirmed') = (severity is not null)),
  check ((outcome = 'duplicate') = (duplicate_of_bug_id is not null)),
  check (duplicate_of_bug_id is distinct from bug_id),
  check (outcome = 'confirmed' or introducing_receipt_id is null)
);

-- The bug rules of a pinned reward policy, or null (v1 has none).
create or replace function wos.bug_rules(reward_version text) returns jsonb
language sql stable security definer set search_path = wos, pg_temp as $$
  select d.body -> 'bugs' from wos.policy_documents d where d.kind = 'reward' and d.version = reward_version
$$;

create or replace function wos.check_bug_triage_decision() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  a wos.human_review_assignments;
  b wos.task_budgets;
  rules jsonb;
  intro wos.contribution_receipts;
begin
  perform pg_advisory_xact_lock(hashtext('wos.bug:' || new.bug_id));
  new.decided_at := clock_timestamp();
  select * into a from wos.human_review_assignments where task_id = new.triage_task_id;
  if a.task_id is null or a.subject_kind <> 'bug' or a.subject_id <> new.bug_id or a.reviewer_account_id <> new.decided_by_account_id then
    raise exception 'wos: a triage decision is made by the assigned reviewer of the bug''s own triage task' using errcode = 'check_violation';
  end if;
  select * into b from wos.task_budgets where task_id = new.triage_task_id;
  if b.task_id is null or b.kind <> 'human_review' then
    raise exception 'wos: triage is a commissioned human_review task: the triage task needs its budget' using errcode = 'check_violation';
  end if;
  if exists (select 1 from wos.task_budget_releases r where r.task_id = b.task_id) then
    raise exception 'wos: the triage task''s budget was released' using errcode = 'check_violation';
  end if;
  rules := wos.bug_rules(b.policy_version);
  if rules is null or (rules ->> 'introducerWindowDays') is null then
    raise exception 'wos: the triage task''s pinned reward policy (%) has no bug rules (D61 starts at reward-policy.v2)', nullif(b.policy_version, '')
      using errcode = 'check_violation';
  end if;
  new.policy_version := b.policy_version;
  new.window_days := (rules ->> 'introducerWindowDays')::integer;
  if new.first_reporter_account_id is not null and wos.related_accounts(new.first_reporter_account_id, new.decided_by_account_id) then
    raise exception 'wos: the reporter (or a related account) does not triage its own report' using errcode = 'check_violation';
  end if;
  if new.duplicate_of_bug_id is not null
     and not exists (select 1 from wos.bug_triage_decisions o where o.bug_id = new.duplicate_of_bug_id and o.outcome = 'confirmed') then
    raise exception 'wos: a duplicate points at a confirmed bug' using errcode = 'check_violation';
  end if;
  new.introducer_account_id := null;
  new.introduced_within_window := false;
  if new.introducing_receipt_id is not null then
    select * into intro from wos.contribution_receipts where id = new.introducing_receipt_id;
    new.introducer_account_id := intro.account_id;
    new.introduced_within_window := intro.qualified_at >= new.decided_at - make_interval(days => new.window_days);
    if wos.related_accounts(intro.account_id, new.decided_by_account_id) then
      raise exception 'wos: the introducer (or a related account) does not triage a bug blamed on its receipt' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger bug_triage_decisions_b1 before insert on wos.bug_triage_decisions for each row execute function wos.check_bug_triage_decision();

-- ============================================================================================
-- B2, B3: bug receipts
-- ============================================================================================
create or replace function wos.check_bug_receipt() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  d wos.bug_triage_decisions;
  b wos.task_budgets;
  cap integer;
begin
  if new.contribution_type not in ('BUG_REPORT', 'BUG_TRIAGE', 'BUG_FIX') then
    return new;
  end if;
  if new.subject_kind <> 'bug' then
    raise exception 'wos: a % receipt''s subject is the bug', new.contribution_type using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('wos.bug:' || new.subject_id));
  select * into d from wos.bug_triage_decisions where bug_id = new.subject_id;
  if new.contribution_type = 'BUG_TRIAGE' then
    if d.bug_id is null or d.triage_task_id is distinct from new.task_id or d.decided_by_account_id <> new.account_id then
      raise exception 'wos: a BUG_TRIAGE receipt is the decider''s, on the bug''s triage task' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if d.bug_id is null or d.outcome <> 'confirmed' then
    raise exception 'wos: a % needs the bug''s confirmed triage decision', new.contribution_type using errcode = 'check_violation';
  end if;
  if d.introduced_within_window and wos.related_accounts(d.introducer_account_id, new.account_id) then
    raise exception 'wos: the introducer (or a related account) is not paid for a bug blamed on its receipt within the window'
      using errcode = 'check_violation';
  end if;
  if new.contribution_type = 'BUG_FIX' then
    select * into b from wos.task_budgets where task_id = new.task_id;
    if b.task_id is null or b.kind <> 'execution' or new.lease_id is null then
      raise exception 'wos: a BUG_FIX is paid from an execution budget, under its lease' using errcode = 'check_violation';
    end if;
    if b.basis ->> 'bugId' is distinct from new.subject_id::text or b.basis ->> 'severity' is distinct from d.severity then
      raise exception 'wos: the fix budget is bound to this bug and its confirmed severity (basis bugId, severity)' using errcode = 'check_violation';
    end if;
    if wos.bug_rules(b.policy_version) is null then
      raise exception 'wos: the fix budget''s pinned reward policy (%) has no bug rules', nullif(b.policy_version, '') using errcode = 'check_violation';
    end if;
    return new;
  end if;
  -- BUG_REPORT
  if new.dedup_key <> 'bug:' || new.subject_id then
    raise exception 'wos: a bug report''s dedup key is bug:<bug id> (one paid report per bug)' using errcode = 'check_violation';
  end if;
  if exists (select 1 from wos.contribution_receipts c where c.contribution_type = 'BUG_REPORT' and c.subject_kind = 'bug' and c.subject_id = new.subject_id) then
    raise exception 'wos: one paid report per bug' using errcode = 'unique_violation';
  end if;
  if d.first_reporter_account_id is distinct from new.account_id then
    raise exception 'wos: only the first valid report of a bug is paid' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from wos.contribution_receipts f where f.contribution_type = 'BUG_FIX' and f.subject_kind = 'bug' and f.subject_id = new.subject_id) then
    raise exception 'wos: a bug report is paid when its fix is accepted' using errcode = 'check_violation';
  end if;
  cap := (wos.bug_rules((select e.policy_versions ->> 'reward' from wos.epochs e where e.epoch_number = new.admitted_epoch))
          ->> 'maxBugReportsPaidPerAccountPerEpoch')::integer;
  if cap is null then
    raise exception 'wos: epoch %''s pinned reward policy has no bug rules', new.admitted_epoch using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('wos.bug_reports:' || new.account_id || ':' || new.admitted_epoch));
  if (select count(*) from wos.contribution_receipts c where c.contribution_type = 'BUG_REPORT' and c.account_id = new.account_id
        and c.admitted_epoch = new.admitted_epoch) >= cap then
    raise exception 'wos: the reporter''s paid-report cap (%) for epoch % is reached', cap, new.admitted_epoch using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger contribution_receipts_d61 before insert on wos.contribution_receipts for each row execute function wos.check_bug_receipt();

-- ============================================================================================
-- B4: the introducer's offset
-- ============================================================================================
alter table wos.offsets add column bug_id uuid references wos.bug_triage_decisions (bug_id);
create unique index offsets_one_per_bug on wos.offsets (bug_id) where bug_id is not null;

create or replace function wos.check_bug_offset() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  d wos.bug_triage_decisions;
  report uuid;
begin
  if new.bug_id is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('wos.bug:' || new.bug_id));
  select * into d from wos.bug_triage_decisions where bug_id = new.bug_id;
  if d.outcome <> 'confirmed' or not d.introduced_within_window or new.receipt_id is distinct from d.introducing_receipt_id
     or new.beneficiary_kind <> 'person' or new.beneficiary_id is distinct from d.introducer_account_id then
    raise exception 'wos: an introducer offset cites a confirmed bug blamed within the window, its introducing receipt and the introducer'
      using errcode = 'check_violation';
  end if;
  select c.id into report from wos.contribution_receipts c where c.contribution_type = 'BUG_REPORT' and c.subject_kind = 'bug' and c.subject_id = new.bug_id;
  if report is null or new.amount_base <> (select coalesce(sum(a.amount_base), 0) from wos.allocations a where a.receipt_id = report) then
    raise exception 'wos: the introducer offset equals what the bug''s report was allocated' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger offsets_d61 before insert on wos.offsets for each row execute function wos.check_bug_offset();

-- ============================================================================================
-- Append-only, grants, RLS (as 0007 section S)
-- ============================================================================================
select wos.protocol_append_only('bug_triage_decisions');
alter table wos.bug_triage_decisions enable row level security;
grant select, insert on wos.bug_triage_decisions to wos_app;
create policy public_read on wos.bug_triage_decisions for select to wos_app using (true);
create policy privileged_write on wos.bug_triage_decisions for insert to wos_app with check (wos.is_privileged());
