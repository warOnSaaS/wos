-- 0010_bugs_and_maintenance.sql — DRAFT: the versioned additions after the protocol v1 freeze (D62): D61 bugs and
-- maintenance (economy side), the D60 protocol delta, D63 one queue with the queue bonus. Owner: Protocol Architect.
-- DO NOT APPLY TO PRODUCTION (like 0007, which it extends; main's 0008 build release and 0009 web_app client commute with both).
--
-- Engine-first (D51): the procedure lives in packages/contracts/src/protocol/rules.ts (effectiveBugSeverity,
-- triageConfirmationRefusals, receiptRouteRefusals BUG_TRIAGE / BUG_FIX, bugReportOutcome, holdReleaseLabelRefusals,
-- ageingIssueEpoch, workEligibilityRefusals, rankWorkNext, nextClaimTerms) and engine.ts (queueBasePrice). The records
-- bound are the planning side's (contracts 5.7.0 bugs.ts: BUG-n keys, TriageDecision and its canonical hash). This
-- migration adds only invariants a service bug must not be able to break:
--   B1  one triage record per bug, append-only: an agent decision is the triage lease holder's, on a bug_triage
--       budget pinned to a reward policy with bug rules (v1 has none: fails closed); a maintainer decision is a
--       maintainer's; nobody triages their own (or a related account's) report or a bug blamed on their receipt; a
--       duplicate names an EARLIER bug whose outcome acts; wont_fix is a maintainer's. Introducer, window flag,
--       window and policy are DERIVED.
--   B2  maintainer confirmations (ratified, severity_corrected, resolved): one of each kind per bug, by a maintainer
--       unrelated to the reporter and the decider. A critical severity is effective only once confirmed.
--   B3  receipts: BUG_TRIAGE is the decider's, on its task and lease, bound to the decision hash, only once the decision
--       is confirmed; BUG_FIX needs outcome fix, a budget bound to the bug and its EFFECTIVE severity, a lease, a fixer
--       who did not triage it and is not the in-window introducer; BUG_REPORT is one per bug, the first reporter's,
--       once resolved, never the in-window introducer's, within the pinned per-epoch cap.
--   B4  the introducer's offset (policy switch introducerOffsetEqualsReportPay): cites the bug, the introducing receipt
--       and the introducer, once, equal to the report's allocations.
--   H1  (D60 delta item 4) a hold release label (architecture_hold:ADR-nnn | bug_hold:BUG-n) only on a cancelled release.
--   Q1  (D63) a claim earns the queue bonus only in queue mode; a task whose lease snapshot withholds the bonus is
--       allocated at most its base price floor(reserved x 10000 / (10000 + bonus)); the rest stays in R.
-- Sweeps have no receipt type: they are paid only through confirmed reports.
--
-- Review 09 fix pass (R09-1..R09-6): the claim terms are REQUIRED for work pinned to a policy with a queue bonus and
-- bound to that coefficient, one set of terms per task (Q1); the route follows the commissioned budget basis in both
-- directions (`basis.taskKind`, `basis.bug`; B3) and a triage is decided only on a bug_triage budget for that bug (B1);
-- a fix resolves a bug only while its BUG_FIX receipt is live-countable (B3); a fix budget is priced at the severity
-- effective at issuance and pins the decision revision it used (F1); v2 prices abu_revision and architecture_author.

-- ============================================================================================
-- Types
-- ============================================================================================
alter table wos.contribution_receipts drop constraint contribution_receipts_contribution_type_check;
alter table wos.contribution_receipts add constraint contribution_receipts_contribution_type_check check (contribution_type in (
  'APPLICATION_ROADMAP', 'FEATURE_SPECIFICATION', 'ARCHITECTURE_RESOLUTION', 'IMPLEMENTATION', 'AGENT_REVIEW', 'HUMAN_REVIEW',
  'SECURITY', 'INTEGRATION', 'DOCUMENTATION', 'OTHER_PROTOCOL_APPROVED', 'PROPOSAL', 'BUG_REPORT', 'AUDIT_RERUN',
  'BUG_TRIAGE', 'BUG_FIX'));

-- The bug rules of a pinned reward policy, or null (reward-policy.v1 has none).
create or replace function wos.bug_rules(reward_version text) returns jsonb
language sql stable security definer set search_path = wos, pg_temp as $$
  select d.body -> 'bugs' from wos.policy_documents d where d.kind = 'reward' and d.version = reward_version
$$;

-- Review 09 R09-1: the queue bonus of a pinned reward policy, or null (v1 has none: no claim terms).
create or replace function wos.queue_bonus(reward_version text) returns integer
language sql stable security definer set search_path = wos, pg_temp as $$
  select (d.body -> 'queue' ->> 'queueBonusBp')::integer from wos.policy_documents d where d.kind = 'reward' and d.version = reward_version
$$;

-- Review 09 R09-4: a receipt counts only while live-countable (ACTIVE, RATIFIED, FINAL_BY_SILENCE).
create or replace function wos.receipt_live(r uuid) returns boolean
language sql stable security definer set search_path = wos, pg_temp as $$
  select coalesce(wos.receipt_status(r) in ('ACTIVE', 'RATIFIED', 'FINAL_BY_SILENCE'), false)
$$;

create or replace function wos.bug_number(k text) returns integer
language sql immutable as $$ select substr(k, 5)::integer $$;

-- ============================================================================================
-- B1: triage records
-- ============================================================================================
create table wos.bug_triage_decisions (
  bug_id                     uuid primary key,
  bug_key                    text not null unique check (bug_key ~ '^BUG-[0-9]{1,9}$'),
  decision_sha256            text not null unique check (decision_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  outcome                    text not null check (outcome in ('fix', 'contract_revision', 'duplicate', 'not_reproducible', 'not_a_bug', 'wont_fix')),
  severity                   text check (severity in ('low', 'medium', 'high', 'critical')),
  duplicate_of_bug_key       text references wos.bug_triage_decisions (bug_key),
  decided_by                 text not null check (decided_by in ('agent', 'maintainer')),
  triage_task_id             uuid unique references wos.task_budgets (task_id),
  triage_lease_id            uuid references wos.leases (id),
  decider_account_id         uuid not null references wos.accounts (id),   -- server-set for an agent: the lease holder
  reporter_account_id        uuid not null references wos.accounts (id),   -- the account the intake authenticated
  introducing_receipt_id     uuid references wos.contribution_receipts (id),
  introducer_account_id      uuid references wos.accounts (id),           -- server-set from the introducing receipt
  introduced_within_window   boolean not null default false,              -- server-set
  window_days                integer not null default 0,                  -- server-set from the pinned policy
  policy_version             text not null default '',                    -- server-set
  decided_at                 timestamptz not null default now(),          -- server-set
  check ((outcome in ('fix', 'contract_revision')) = (severity is not null)),
  check ((outcome = 'duplicate') = (duplicate_of_bug_key is not null)),
  check (duplicate_of_bug_key is distinct from bug_key),
  check (outcome <> 'wont_fix' or decided_by = 'maintainer'),
  check ((decided_by = 'agent') = (triage_task_id is not null) and (triage_task_id is null) = (triage_lease_id is null)),
  check (outcome in ('fix', 'contract_revision') or introducing_receipt_id is null)
);

create or replace function wos.check_bug_triage_decision() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  b wos.task_budgets;
  l wos.leases;
  rules jsonb;
  intro wos.contribution_receipts;
  root wos.bug_triage_decisions;
begin
  perform pg_advisory_xact_lock(hashtext('wos.bug:' || new.bug_id));
  new.decided_at := clock_timestamp();
  if new.decided_by = 'agent' then
    select * into b from wos.task_budgets where task_id = new.triage_task_id;
    select * into l from wos.leases where id = new.triage_lease_id;
    if b.task_id is null or b.kind <> 'execution' or l.id is null or l.task_id <> b.task_id
       or b.basis ->> 'taskKind' is distinct from 'bug_triage' or b.basis ->> 'bug' is distinct from new.bug_key then
      raise exception 'wos: an agent triage is made under the lease of a bug_triage budget commissioned for this bug' using errcode = 'check_violation';
    end if;
    if exists (select 1 from wos.task_budget_releases r where r.task_id = b.task_id) then
      raise exception 'wos: the triage task''s budget was released' using errcode = 'check_violation';
    end if;
    new.decider_account_id := l.account_id;
    new.policy_version := b.policy_version;
  else
    if not wos.is_maintainer(new.decider_account_id) then
      raise exception 'wos: a maintainer decision is a maintainer''s' using errcode = 'check_violation';
    end if;
    new.policy_version := coalesce((select e.policy_versions ->> 'reward' from wos.epochs e
      where e.starts_at <= new.decided_at and new.decided_at < e.ends_at order by e.epoch_number desc limit 1), '');
  end if;
  rules := wos.bug_rules(new.policy_version);
  if rules is null or (rules ->> 'introducerWindowDays') is null then
    raise exception 'wos: the pinned reward policy (%) has no bug rules (D61 starts at reward-policy.v2)', nullif(new.policy_version, '')
      using errcode = 'check_violation';
  end if;
  new.window_days := (rules ->> 'introducerWindowDays')::integer;
  if wos.related_accounts(new.reporter_account_id, new.decider_account_id) then
    raise exception 'wos: the reporter (or a related account) does not triage its own report' using errcode = 'check_violation';
  end if;
  if new.duplicate_of_bug_key is not null then
    select * into root from wos.bug_triage_decisions where bug_key = new.duplicate_of_bug_key;
    if root.outcome not in ('fix', 'contract_revision') or wos.bug_number(root.bug_key) >= wos.bug_number(new.bug_key) then
      raise exception 'wos: a duplicate names an EARLIER bug whose outcome acts on it' using errcode = 'check_violation';
    end if;
  end if;
  new.introducer_account_id := null;
  new.introduced_within_window := false;
  if new.introducing_receipt_id is not null then
    select * into intro from wos.contribution_receipts where id = new.introducing_receipt_id;
    new.introducer_account_id := intro.account_id;
    new.introduced_within_window := intro.qualified_at >= new.decided_at - make_interval(days => new.window_days);
    if wos.related_accounts(intro.account_id, new.decider_account_id) then
      raise exception 'wos: the introducer (or a related account) does not triage a bug blamed on its receipt' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger bug_triage_decisions_b1 before insert on wos.bug_triage_decisions for each row execute function wos.check_bug_triage_decision();

-- ============================================================================================
-- B2: maintainer confirmations
-- ============================================================================================
create table wos.bug_triage_confirmations (
  bug_id                 uuid not null references wos.bug_triage_decisions (bug_id),
  kind                   text not null check (kind in ('ratified', 'severity_corrected', 'resolved')),
  corrected_severity     text check (corrected_severity in ('low', 'medium', 'high', 'critical')),
  maintainer_account_id  uuid not null references wos.accounts (id),
  created_at             timestamptz not null default now(),
  primary key (bug_id, kind),
  check ((kind = 'severity_corrected') = (corrected_severity is not null))
);

create or replace function wos.check_bug_triage_confirmation() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  d wos.bug_triage_decisions;
begin
  perform pg_advisory_xact_lock(hashtext('wos.bug:' || new.bug_id));
  new.created_at := clock_timestamp();
  select * into d from wos.bug_triage_decisions where bug_id = new.bug_id;
  if not wos.is_maintainer(new.maintainer_account_id)
     or wos.related_accounts(new.maintainer_account_id, d.reporter_account_id)
     or wos.related_accounts(new.maintainer_account_id, d.decider_account_id) then
    raise exception 'wos: a confirmation is a maintainer''s, unrelated to the reporter and the decider' using errcode = 'check_violation';
  end if;
  if new.kind = 'severity_corrected' and d.outcome not in ('fix', 'contract_revision') then
    raise exception 'wos: only an acting outcome has a severity to correct' using errcode = 'check_violation';
  end if;
  if new.kind = 'resolved' and d.outcome <> 'contract_revision' then
    raise exception 'wos: resolved records a merged contract revision (a fix is resolved by its BUG_FIX receipt)' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger bug_triage_confirmations_b2 before insert on wos.bug_triage_confirmations for each row execute function wos.check_bug_triage_confirmation();

-- The effective severity (rules effectiveBugSeverity): corrected wins; critical only once confirmed; null otherwise.
create or replace function wos.bug_effective_severity(b uuid) returns text
language sql stable security definer set search_path = wos, pg_temp as $$
  select case
    when d.outcome not in ('fix', 'contract_revision') then null
    when c.corrected_severity is not null then c.corrected_severity
    when d.severity = 'critical' and not exists (select 1 from wos.bug_triage_confirmations r where r.bug_id = b and r.kind = 'ratified') then null
    else d.severity end
  from wos.bug_triage_decisions d
  left join wos.bug_triage_confirmations c on c.bug_id = d.bug_id and c.kind = 'severity_corrected'
  where d.bug_id = b
$$;

-- ============================================================================================
-- B3: bug receipts
-- ============================================================================================
create or replace function wos.check_bug_receipt() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  d wos.bug_triage_decisions;
  b wos.task_budgets;
  eff text;
  cap integer;
  confirmed boolean;
  has_fix boolean;
begin
  -- Review 09 R09-3: the route follows the commissioned budget, in both directions.
  if new.task_id is not null then
    select * into b from wos.task_budgets where task_id = new.task_id;
    if coalesce(b.basis ? 'bug' and b.basis ->> 'taskKind' in ('abu_build', 'abu_revision'), false) <> (new.contribution_type = 'BUG_FIX') then
      raise exception 'wos: a fix task''s receipt is BUG_FIX, and BUG_FIX is paid only on a commissioned fix task' using errcode = 'check_violation';
    end if;
    if coalesce(b.basis ->> 'taskKind' = 'bug_triage', false) <> (new.contribution_type = 'BUG_TRIAGE') then
      raise exception 'wos: a bug_triage task''s receipt is BUG_TRIAGE, and BUG_TRIAGE is paid only on a bug_triage task' using errcode = 'check_violation';
    end if;
  end if;
  if new.contribution_type not in ('BUG_REPORT', 'BUG_TRIAGE', 'BUG_FIX') then
    return new;
  end if;
  if new.subject_kind <> 'bug' then
    raise exception 'wos: a % receipt''s subject is the bug', new.contribution_type using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('wos.bug:' || new.subject_id));
  select * into d from wos.bug_triage_decisions where bug_id = new.subject_id;
  if d.bug_id is null then
    raise exception 'wos: a % needs the bug''s triage record', new.contribution_type using errcode = 'check_violation';
  end if;
  eff := wos.bug_effective_severity(d.bug_id);
  -- Review 09 R09-4: a fix resolves the bug only while its BUG_FIX receipt is live-countable, never by row existence.
  has_fix := exists (select 1 from wos.contribution_receipts f where f.contribution_type = 'BUG_FIX' and f.subject_kind = 'bug'
                     and f.subject_id = d.bug_id and wos.receipt_live(f.id));
  if new.contribution_type = 'BUG_TRIAGE' then
    if d.decided_by <> 'agent' or d.triage_task_id is distinct from new.task_id or d.decider_account_id <> new.account_id
       or d.triage_lease_id is distinct from new.lease_id then
      raise exception 'wos: a BUG_TRIAGE receipt is the decider''s, on its triage task and lease' using errcode = 'check_violation';
    end if;
    if new.body ->> 'decisionSha256' is distinct from d.decision_sha256 then
      raise exception 'wos: a BUG_TRIAGE receipt is bound to the decision''s canonical hash' using errcode = 'check_violation';
    end if;
    confirmed := case d.outcome
      when 'fix' then has_fix or exists (select 1 from wos.bug_triage_confirmations c where c.bug_id = d.bug_id and c.kind = 'ratified')
      when 'contract_revision' then exists (select 1 from wos.bug_triage_confirmations c where c.bug_id = d.bug_id and c.kind in ('ratified', 'resolved'))
      when 'duplicate' then true   -- the earlier, acting root was checked when the record was written (B1)
      else exists (select 1 from wos.bug_triage_confirmations c where c.bug_id = d.bug_id and c.kind = 'ratified') end;
    if not confirmed or (d.outcome in ('fix', 'contract_revision') and eff is null) then
      raise exception 'wos: a triage is paid once its decision is confirmed (a critical severity by a maintainer)' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if d.introduced_within_window and wos.related_accounts(d.introducer_account_id, new.account_id) then
    raise exception 'wos: the introducer (or a related account) is not paid for a bug blamed on its receipt within the window'
      using errcode = 'check_violation';
  end if;
  if new.contribution_type = 'BUG_FIX' then
    if d.outcome <> 'fix' then
      raise exception 'wos: a BUG_FIX needs the bug''s triage outcome fix' using errcode = 'check_violation';
    end if;
    if wos.related_accounts(d.decider_account_id, new.account_id) then
      raise exception 'wos: nobody both triages and fixes one bug' using errcode = 'check_violation';
    end if;
    select * into b from wos.task_budgets where task_id = new.task_id;
    if b.task_id is null or b.kind <> 'execution' or new.lease_id is null then
      raise exception 'wos: a BUG_FIX is paid from an execution budget, under its lease' using errcode = 'check_violation';
    end if;
    -- Review 09 R09-6: the quote pinned at issuance (F1 validated it and pinned the decision revision) stands; a later
    -- correction affects future commissions and the ranking only.
    if b.basis ->> 'bug' is distinct from d.bug_key or not (b.basis ? 'severityRevision') then
      raise exception 'wos: the fix budget is commissioned for this bug at the severity effective at its issuance' using errcode = 'check_violation';
    end if;
    if wos.bug_rules(b.policy_version) is null then
      raise exception 'wos: the fix budget''s pinned reward policy (%) has no bug rules', nullif(b.policy_version, '') using errcode = 'check_violation';
    end if;
    return new;
  end if;
  -- BUG_REPORT
  if d.outcome not in ('fix', 'contract_revision') then
    raise exception 'wos: a report is paid only when its bug''s outcome is fix or contract_revision' using errcode = 'check_violation';
  end if;
  if exists (select 1 from wos.contribution_receipts c where c.contribution_type = 'BUG_REPORT' and c.subject_kind = 'bug' and c.subject_id = new.subject_id) then
    raise exception 'wos: one paid report per bug' using errcode = 'unique_violation';
  end if;
  if new.dedup_key <> 'bug:' || d.bug_key then
    raise exception 'wos: a bug report''s dedup key is bug:<BUG-n> (one paid report per bug)' using errcode = 'check_violation';
  end if;
  if d.reporter_account_id <> new.account_id then
    raise exception 'wos: only the first reporter of a bug is paid' using errcode = 'check_violation';
  end if;
  if not (case d.outcome when 'fix' then has_fix
          else exists (select 1 from wos.bug_triage_confirmations c where c.bug_id = d.bug_id and c.kind = 'resolved') end) then
    raise exception 'wos: a report is paid once the bug is resolved (fix accepted, or contract revision merged)' using errcode = 'check_violation';
  end if;
  if eff is null then
    raise exception 'wos: the bug has no effective severity yet' using errcode = 'check_violation';
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
-- F1 (review 09 R09-3, R09-6): commissioning metadata of bug budgets
-- ============================================================================================
create or replace function wos.check_bug_budget() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  d wos.bug_triage_decisions;
begin
  if new.basis ->> 'taskKind' = 'bug_triage' then
    if new.kind <> 'execution' or not (new.basis ? 'bug') then
      raise exception 'wos: a bug_triage budget is an execution budget commissioned for one bug (basis bug)' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if not (new.basis ? 'bug') then
    return new;
  end if;
  if new.basis ->> 'taskKind' not in ('abu_build', 'abu_revision') or new.kind <> 'execution' then
    raise exception 'wos: a fix budget is an abu_build or abu_revision execution budget' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('wos.bug:' || (select bug_id from wos.bug_triage_decisions where bug_key = new.basis ->> 'bug')));
  select * into d from wos.bug_triage_decisions where bug_key = new.basis ->> 'bug';
  if d.bug_id is null or d.outcome <> 'fix' then
    raise exception 'wos: a fix budget is commissioned for a bug whose triage outcome is fix' using errcode = 'check_violation';
  end if;
  if new.basis ->> 'severity' is distinct from wos.bug_effective_severity(d.bug_id) then
    raise exception 'wos: a fix budget is priced at the severity effective at its issuance (%)', coalesce(wos.bug_effective_severity(d.bug_id), 'none: a critical severity is confirmed by a maintainer first')
      using errcode = 'check_violation';
  end if;
  -- The decision revision the quote used: the confirmations on record at issuance (server-set).
  new.basis := new.basis || jsonb_build_object('severityRevision', (select count(*) from wos.bug_triage_confirmations c where c.bug_id = d.bug_id));
  return new;
end $$;
create trigger task_budgets_d61 before insert on wos.task_budgets for each row execute function wos.check_bug_budget();

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
  if coalesce((wos.bug_rules(d.policy_version) ->> 'introducerOffsetEqualsReportPay')::boolean, false) is not true then
    raise exception 'wos: the pinned policy (%) has no introducer offset', d.policy_version using errcode = 'check_violation';
  end if;
  if not d.introduced_within_window or new.receipt_id is distinct from d.introducing_receipt_id
     or new.beneficiary_kind <> 'person' or new.beneficiary_id is distinct from d.introducer_account_id then
    raise exception 'wos: an introducer offset cites a bug blamed within the window, its introducing receipt and the introducer'
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
-- H1 (D60 delta item 4): public hold labels on releases
-- ============================================================================================
alter table wos.task_budget_releases add column hold_label text
  check (hold_label ~ '^(architecture_hold:ADR-[0-9]{3,}|bug_hold:BUG-[0-9]{1,9})$');
alter table wos.task_budget_releases add constraint task_budget_releases_hold_label_cancelled check (hold_label is null or reason = 'cancelled');

-- ============================================================================================
-- Q1 (D63): the queue bonus
-- ============================================================================================
create or replace function wos.check_claim_snapshot() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  bonus integer;
  c jsonb := new.body -> 'claim';
begin
  -- Review 09 R09-1: the terms are bound to the reward policy the lease's task budget PINNED.
  bonus := wos.queue_bonus((select b.policy_version from wos.leases l join wos.task_budgets b on b.task_id = l.task_id where l.id = new.lease_id));
  if bonus is null then
    if new.body ? 'claim' then
      raise exception 'wos: pinned v1 work (or unbudgeted work) carries no claim terms' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if jsonb_typeof(c) is distinct from 'object' or c ->> 'mode' is null or c ->> 'mode' not in ('queue', 'self_pick')
     or jsonb_typeof(c -> 'queueBonusBp') is distinct from 'number' or jsonb_typeof(c -> 'bonusApplies') is distinct from 'boolean' then
    raise exception 'wos: v2 work needs complete claim terms (mode, queueBonusBp, bonusApplies)' using errcode = 'check_violation';
  end if;
  if (c ->> 'queueBonusBp')::numeric <> bonus then
    raise exception 'wos: the claim''s queue bonus differs from the pinned policy''s (% bp)', bonus using errcode = 'check_violation';
  end if;
  if (c ->> 'bonusApplies')::boolean and c ->> 'mode' <> 'queue' then
    raise exception 'wos: only a queue claim earns the queue bonus' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger run_policy_snapshots_d63 before insert on wos.run_policy_snapshots for each row execute function wos.check_claim_snapshot();

create or replace function wos.check_queue_bonus() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  t uuid;
  b wos.task_budgets;
  bonus integer;
  terms jsonb;
  payable numeric;
begin
  select c.task_id into t from wos.contribution_receipts c where c.id = new.receipt_id;
  if t is null then
    return null;
  end if;
  select * into b from wos.task_budgets where task_id = t;
  bonus := wos.queue_bonus(b.policy_version);
  if bonus is null then
    return null;   -- frozen v1 work: the whole reservation (0007 I8 bounds)
  end if;
  -- Review 09 R09-1: ONE task-level entitlement: every participating receipt's lease snapshot carries the same terms.
  if exists (select 1 from wos.contribution_receipts c left join wos.run_policy_snapshots s on s.lease_id = c.lease_id
              where c.task_id = t and (s.lease_id is null or not (s.body ? 'claim'))) then
    raise exception 'wos: every receipt of v2 work carries its lease''s claim terms' using errcode = 'check_violation';
  end if;
  if (select count(distinct s.body -> 'claim') from wos.contribution_receipts c join wos.run_policy_snapshots s on s.lease_id = c.lease_id where c.task_id = t) <> 1 then
    raise exception 'wos: one task-level entitlement: the participating leases carry different claim terms' using errcode = 'check_violation';
  end if;
  select s.body -> 'claim' into terms from wos.contribution_receipts c join wos.run_policy_snapshots s on s.lease_id = c.lease_id where c.task_id = t limit 1;
  -- Review 09 R09-2: the engine's payable base (taskPayableBase) from the REAL reservation.
  payable := case when (terms ->> 'bonusApplies')::boolean then b.reserved_base else floor(b.reserved_base::numeric * 10000 / (10000 + bonus)) end;
  if (select sum(x.amount_base) from wos.allocations x join wos.contribution_receipts r on r.id = x.receipt_id where r.task_id = t) > payable then
    raise exception 'wos: a task claimed without the queue bonus is allocated at most its base price (the bonus stays in R)'
      using errcode = 'check_violation';
  end if;
  return null;
end $$;
create constraint trigger allocations_queue_bonus after insert on wos.allocations deferrable initially deferred
  for each row execute function wos.check_queue_bonus();

-- ============================================================================================
-- Append-only, grants, RLS (as 0007 section S)
-- ============================================================================================
do $$
declare
  t text;
begin
  foreach t in array array['bug_triage_decisions', 'bug_triage_confirmations'] loop
    perform wos.protocol_append_only(t);
    execute format('alter table wos.%I enable row level security', t);
    execute format('grant select, insert on wos.%I to wos_app', t);
    execute format('create policy public_read on wos.%I for select to wos_app using (true)', t);
    execute format('create policy privileged_write on wos.%I for insert to wos_app with check (wos.is_privileged())', t);
  end loop;
end $$;
