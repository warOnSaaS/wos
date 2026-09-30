-- 0014_bootstrap_founder_human_seat.sql — contracts 5.16.0 (D67). Owner: Lead Architect.
-- PRODUCTION MIGRATION: the coordinator applies it through the runner (list with --check first). The control plane
-- built from the same commit tolerates a database without it (it reads the new columns through to_jsonb), so the API
-- may deploy first; the D67 exception simply does not exist until this is applied.
--
--   1. review_policy_switches gains the review policy VERSION (review-policy.v1 -> v2, forward-only) and the bootstrap
--      founder named by v2. A switch may move the fallback, the version, or both; what it leaves out is inherited.
--   2. D67: under review-policy.v2, while bootstrap mode is on, the bootstrap founder (a maintainer) may hold the D53 human
--      seat on a round whose subject the founder's own account authored. The verdict row is marked bootstrap_self (the
--      round's independence follows at reveal). Every other refusal of 0013 stays: never the agent seat of the same round,
--      maintainers only, sealed Astra verdict first (control plane), and nobody else's own work.
-- Touches none of the objects of the draft protocol migrations 0007 and 0010.

-- --------------------------------------------------------------------------------------------
-- 1. Policy versions on the switches
-- --------------------------------------------------------------------------------------------
-- The default fills the existing rows (ADD COLUMN fires no row trigger); new rows get their values from the trigger.
alter table wos.review_policy_switches
  add column policy_version text not null default 'review-policy.v1' check (policy_version in ('review-policy.v1', 'review-policy.v2')),
  add column bootstrap_founder_id uuid references wos.accounts (id);
alter table wos.review_policy_switches alter column policy_version drop default;
alter table wos.review_policy_switches
  add constraint review_policy_switches_v2_names_founder check (policy_version = 'review-policy.v1' or bootstrap_founder_id is not null);

create or replace function wos.check_review_policy_switch() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  last wos.review_policy_switches%rowtype;
  versions constant text[] := array['review-policy.v1', 'review-policy.v2'];
  prev_version text;
  prev_fallback text;
begin
  perform pg_advisory_xact_lock(hashtext('wos.review_policy_switches'));
  select * into last from wos.review_policy_switches order by seq desc limit 1;
  prev_version := coalesce(last.policy_version, 'review-policy.v1');
  prev_fallback := coalesce(last.fallback, 'none');
  if new.seq <> coalesce(last.seq, 0) + 1 then
    raise exception 'wos: review policy switch % is not the next one (%)', new.seq, coalesce(last.seq, 0) + 1 using errcode = 'check_violation';
  end if;
  new.fallback := coalesce(new.fallback, prev_fallback);
  new.policy_version := coalesce(new.policy_version, prev_version);
  new.bootstrap_founder_id := coalesce(new.bootstrap_founder_id, last.bootstrap_founder_id);
  if array_position(versions, new.policy_version) < array_position(versions, prev_version) then
    raise exception 'wos: review policy versions only move forward (% is in force)', prev_version using errcode = 'check_violation';
  end if;
  if last.bootstrap_founder_id is not null and new.bootstrap_founder_id <> last.bootstrap_founder_id then
    raise exception 'wos: the bootstrap founder is fixed once review-policy.v2 names one' using errcode = 'check_violation';
  end if;
  if new.fallback = prev_fallback and new.policy_version = prev_version then
    raise exception 'wos: the review policy fallback is already % and the version is already %', new.fallback, new.policy_version
      using errcode = 'check_violation';
  end if;
  if new.policy_version = 'review-policy.v2' and new.policy_version <> prev_version then
    if new.bootstrap_founder_id is null
       or not exists (select 1 from wos.account_roles ar where ar.account_id = new.bootstrap_founder_id and ar.role = 'maintainer') then
      raise exception 'wos: review-policy.v2 names the bootstrap founder, a maintainer' using errcode = 'check_violation';
    end if;
    if not coalesce((select (value ->> 'enabled')::boolean from wos.platform_settings where key = 'bootstrap_mode'), false) then
      raise exception 'wos: review-policy.v2 is a bootstrap exception (D67) and bootstrap has ended' using errcode = 'check_violation';
    end if;
  end if;
  if not exists (select 1 from wos.account_roles ar where ar.account_id = new.switched_by and ar.role = 'maintainer') then
    raise exception 'wos: only a maintainer switches the review policy' using errcode = 'check_violation';
  end if;
  perform 1 from wos.rounds where state = 'awaiting_reviews' for update;
  if found then
    raise exception 'wos: a review round is awaiting reviews; switch the review policy when none is open' using errcode = 'check_violation';
  end if;
  new.switched_at := clock_timestamp();
  return new;
end $$;

-- --------------------------------------------------------------------------------------------
-- 2. D67: the bootstrap founder's human seat on the founder's own work
-- --------------------------------------------------------------------------------------------
alter table wos.round_human_reviews add column bootstrap_self boolean not null default false;

create or replace function wos.check_round_human_review() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  r wos.rounds%rowtype;
  authored boolean;
begin
  perform pg_advisory_xact_lock(hashtext('wos.round:' || new.round_id::text));
  select * into r from wos.rounds where id = new.round_id;
  if r.id is null or r.state <> 'awaiting_reviews' then
    raise exception 'wos: round % is not awaiting reviews', new.round_id using errcode = 'check_violation';
  end if;
  if r.second_seat <> 'human' then
    raise exception 'wos: round % has no human seat (the fable_unavailable fallback was not active when it opened)', r.id
      using errcode = 'check_violation';
  end if;
  if new.head_sha <> r.head_sha or new.submission_sha256 <> r.submission_sha256 then
    raise exception 'wos: human review is bound to %/% but round % is %/%', new.head_sha, new.submission_sha256, r.id, r.head_sha, r.submission_sha256
      using errcode = 'check_violation';
  end if;
  new.review_label := r.review_label;
  new.review_label_reason := r.review_label_reason;
  new.sealed_at := clock_timestamp();
  new.bootstrap_self := false;
  if not exists (select 1 from wos.account_roles ar where ar.account_id = new.account_id and ar.role = 'maintainer') then
    raise exception 'wos: the human review seat is held by an authorized reviewer (a maintainer in V1)' using errcode = 'check_violation';
  end if;
  authored := (r.attempt_id is not null and exists (select 1 from wos.attempts a where a.id = r.attempt_id and a.account_id = new.account_id))
     or (r.document_id is not null and exists (
           select 1 from wos.changesets c join wos.tasks t on t.id = c.task_id
            where t.document_id = r.document_id and c.account_id = new.account_id and c.ok));
  if authored then
    -- D67: only under the review policy the round pinned (v2), only the founder it names, only while bootstrap is on.
    if exists (select 1 from wos.review_policy_switches s
                where s.seq = r.review_policy_seq and s.policy_version = 'review-policy.v2' and s.bootstrap_founder_id = new.account_id)
       and coalesce((select (value ->> 'enabled')::boolean from wos.platform_settings where key = 'bootstrap_mode'), false) then
      new.bootstrap_self := true;
    else
      raise exception 'wos: account % authored the subject of round % and may not hold its human review seat', new.account_id, r.id
        using errcode = 'check_violation';
    end if;
  end if;
  -- review-policy.v2 bootstrapFounderMayHoldBothSeats = false: humanMayHoldAgentSlotOfSameRound stays false for everyone.
  if exists (select 1 from wos.reviews v where v.round_id = r.id and v.account_id = new.account_id)
     or exists (select 1 from wos.tasks t join wos.leases l on l.task_id = t.id
                 where t.round_id = r.id and l.account_id = new.account_id and l.state = 'active') then
    raise exception 'wos: account % holds the agent seat of round % and may not also hold its human seat', new.account_id, r.id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
