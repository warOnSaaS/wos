-- 0016_solo_bootstrap.sql — contracts 5.18.0 (D71, solo bootstrap). Owner: Lead Architect.
-- PRODUCTION MIGRATION: the coordinator applies it through the runner (list with --check first). 0015 is taken by
-- ws/glm (D69 candidate trials); the runner applies pending files in order, and this one commutes with 0015 (no shared
-- objects). The control plane built from the same commit tolerates a database without it: before it, a switch to
-- review-policy.v3 is refused by the database (the policy_version check), so the D71 exception cannot be activated.
--
--   1. review_policy_switches accepts review-policy.v3 (forward-only after v2; it names the bootstrap founder and is
--      refused after bootstrap ends, like v2).
--   2. D71: under v3, while bootstrap is on, the bootstrap founder it names may hold the agent seat (control plane:
--      no exclusion, no self-review wait; labelled bootstrap_self by the existing 0002 guard) AND the human seat of the
--      same round on the founder's own work. The human seat guard allows exactly that; everyone else is unchanged.
--      The agent seat's model is never the author's (control plane, rule reviewSeatRefusals); the human seat opens after
--      the agent verdict (control plane).
-- Touches none of the objects of the draft protocol migrations 0007 and 0010, nor of 0015.

alter table wos.review_policy_switches drop constraint review_policy_switches_policy_version_check;
alter table wos.review_policy_switches add constraint review_policy_switches_policy_version_check
  check (policy_version in ('review-policy.v1', 'review-policy.v2', 'review-policy.v3'));

create or replace function wos.check_review_policy_switch() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  last wos.review_policy_switches%rowtype;
  versions constant text[] := array['review-policy.v1', 'review-policy.v2', 'review-policy.v3'];
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
  if new.policy_version <> 'review-policy.v1' and new.policy_version <> prev_version then
    if new.bootstrap_founder_id is null
       or not exists (select 1 from wos.account_roles ar where ar.account_id = new.bootstrap_founder_id and ar.role = 'maintainer') then
      raise exception 'wos: % names the bootstrap founder, a maintainer', new.policy_version using errcode = 'check_violation';
    end if;
    if not coalesce((select (value ->> 'enabled')::boolean from wos.platform_settings where key = 'bootstrap_mode'), false) then
      raise exception 'wos: % is a bootstrap exception (D67, D71) and bootstrap has ended', new.policy_version using errcode = 'check_violation';
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


create or replace function wos.check_round_human_review() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  r wos.rounds%rowtype;
  authored boolean;
  pinned text;
  founder uuid;
  boot boolean;
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
  select s.policy_version, s.bootstrap_founder_id into pinned, founder from wos.review_policy_switches s where s.seq = r.review_policy_seq;
  boot := coalesce((select (value ->> 'enabled')::boolean from wos.platform_settings where key = 'bootstrap_mode'), false);
  if authored then
    -- D67 (v2) / D71 (v3): only under the policy the round pinned, only the founder it names, only while bootstrap is on.
    if pinned in ('review-policy.v2', 'review-policy.v3') and founder = new.account_id and boot then
      new.bootstrap_self := true;
    else
      raise exception 'wos: account % authored the subject of round % and may not hold its human review seat', new.account_id, r.id
        using errcode = 'check_violation';
    end if;
  end if;
  -- humanMayHoldAgentSlotOfSameRound stays false for everyone, except D71 (v3): the founder on own work, in bootstrap.
  if not (authored and pinned = 'review-policy.v3' and founder = new.account_id and boot) and exists (select 1 from wos.reviews v where v.round_id = r.id and v.account_id = new.account_id)
     or exists (select 1 from wos.tasks t join wos.leases l on l.task_id = t.id
                 where t.round_id = r.id and l.account_id = new.account_id and l.state = 'active') then
    raise exception 'wos: account % holds the agent seat of round % and may not also hold its human seat', new.account_id, r.id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
