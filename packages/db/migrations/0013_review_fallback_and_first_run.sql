-- 0013_review_fallback_and_first_run.sql — contracts 5.15.0 (first real run fixes). Owner: Lead Architect.
-- PRODUCTION MIGRATION: the coordinator applies it through the runner (list with --check first) BEFORE the control plane
-- built from the same commit is deployed (the control plane reads the new columns). No data migration: every production
-- repository name was already lowercase when this was written (checked read-only on 2026-09-30).
--
--   1. Repository names are stored lowercase (webhooks carry `warOnSaaS/product`; the control plane lowercases).
--   2. D53: review policy switches (forward-only, public, refused while a round is awaiting reviews) and the
--      `fable_unavailable` fallback on rounds: the second seat is the required human review, the round is labelled
--      `single_lab_review`; a Fable verdict is refused as a seat (trigger reviews_0_seat, named to fire first).
--   3. round_human_reviews: the human seat's verdict, bound to head sha + submission hash; never the subject's author,
--      never the account that holds the agent seat of the same round, maintainers only (V1: admin-assigned reviewers).
--   4. findings may come from a human review; rulings may be the human's own (conflicts under the fallback).
--   5. A document version is unique among non-abandoned rows: version = last merged + 1 after an abandon.
-- Touches none of the objects of the draft protocol migrations 0007 and 0010 (whose `human_reviews` is a different,
-- P1 table); commutes with them.

-- --------------------------------------------------------------------------------------------
-- 1. Repository names are lowercase
-- --------------------------------------------------------------------------------------------
alter table wos.targets add constraint targets_repo_lowercase check (repo_full_name = lower(repo_full_name));
alter table wos.documents add constraint documents_repo_lowercase check (repo_full_name = lower(repo_full_name));
alter table wos.abus add constraint abus_repo_lowercase check (repo_full_name = lower(repo_full_name));
alter table wos.catalog_features add constraint catalog_features_repo_lowercase check (repo_full_name = lower(repo_full_name));
alter table wos.pull_requests add constraint pull_requests_repo_lowercase check (repo_full_name = lower(repo_full_name));
alter table wos.resource_locks add constraint resource_locks_repo_lowercase check (repo_full_name = lower(repo_full_name));
alter table wos.repositories add constraint repositories_repo_lowercase check (repo_full_name = lower(repo_full_name));
alter table wos.target_surfaces add constraint target_surfaces_repo_lowercase
  check (repo_full_name is null or repo_full_name = lower(repo_full_name));

-- --------------------------------------------------------------------------------------------
-- 2. Review policy switches (D53): append-only, forward-only, public
-- --------------------------------------------------------------------------------------------
create table wos.review_policy_switches (
  seq          integer primary key check (seq > 0),
  fallback     text not null check (fallback in ('none', 'fable_unavailable')),
  reason       text not null check (length(reason) >= 5),
  switched_by  uuid not null references wos.accounts (id),
  switched_at  timestamptz not null default now()
);

-- Forward-only: each switch is the next sequence number and changes the active fallback; history is never rewritten.
create or replace function wos.check_review_policy_switch() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  last wos.review_policy_switches%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('wos.review_policy_switches'));
  select * into last from wos.review_policy_switches order by seq desc limit 1;
  if new.seq <> coalesce(last.seq, 0) + 1 then
    raise exception 'wos: review policy switch % is not the next one (%)', new.seq, coalesce(last.seq, 0) + 1 using errcode = 'check_violation';
  end if;
  if new.fallback = coalesce(last.fallback, 'none') then
    raise exception 'wos: the review policy fallback is already %', new.fallback using errcode = 'check_violation';
  end if;
  if not exists (select 1 from wos.account_roles ar where ar.account_id = new.switched_by and ar.role = 'maintainer') then
    raise exception 'wos: only a maintainer switches the review policy' using errcode = 'check_violation';
  end if;
  -- Every round awaiting reviews was opened under the policy in force, so a Fable verdict is never a seat while the
  -- fallback is active: a switch waits until no round is open (rounds pin their seats at opening).
  perform 1 from wos.rounds where state = 'awaiting_reviews' for update;
  if found then
    raise exception 'wos: a review round is awaiting reviews; switch the review policy when none is open' using errcode = 'check_violation';
  end if;
  new.switched_at := clock_timestamp();
  return new;
end $$;
create trigger review_policy_switches_check before insert on wos.review_policy_switches
  for each row execute function wos.check_review_policy_switch();

-- The fallback in force now ('none' before any switch).
create or replace function wos.active_review_fallback() returns text
language sql stable security definer set search_path = wos, pg_temp as $$
  select coalesce((select fallback from wos.review_policy_switches order by seq desc limit 1), 'none')
$$;

-- --------------------------------------------------------------------------------------------
-- 3. Rounds pin the fallback at opening: the second seat and the label are derived, never chosen by the caller
-- --------------------------------------------------------------------------------------------
alter table wos.rounds
  add column second_seat text not null default 'fable' check (second_seat in ('fable', 'human')),
  add column review_label text check (review_label is null or review_label = 'single_lab_review'),
  add column review_label_reason text,
  add column review_policy_seq integer references wos.review_policy_switches (seq),
  add constraint rounds_label_iff_human_seat
    check ((second_seat = 'human') = (review_label is not null and review_label_reason is not null));

create or replace function wos.pin_round_review_policy() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    -- Serialised with switches (same lock), so a round never opens under a policy that is being replaced.
    perform pg_advisory_xact_lock(hashtext('wos.review_policy_switches'));
    select seq into new.review_policy_seq from wos.review_policy_switches order by seq desc limit 1;
    if wos.active_review_fallback() = 'fable_unavailable' then
      new.second_seat := 'human';
      new.review_label := 'single_lab_review';
      new.review_label_reason := 'fable_unavailable: Fable seat replaced by the required human review (D53)';
    else
      new.second_seat := 'fable';
      new.review_label := null;
      new.review_label_reason := null;
    end if;
    return new;
  end if;
  if new.second_seat is distinct from old.second_seat or new.review_label is distinct from old.review_label
     or new.review_label_reason is distinct from old.review_label_reason or new.review_policy_seq is distinct from old.review_policy_seq then
    raise exception 'wos: a round''s review seats and label are fixed when it opens' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger rounds_review_policy before insert or update on wos.rounds
  for each row execute function wos.pin_round_review_policy();

-- --------------------------------------------------------------------------------------------
-- 4. The human seat
-- --------------------------------------------------------------------------------------------
create table wos.round_human_reviews (
  id                  uuid primary key default gen_random_uuid(),
  round_id            uuid not null unique references wos.rounds (id),
  account_id          uuid not null references wos.accounts (id),
  head_sha            text not null check (head_sha ~ '^[0-9a-f]{40}$'),
  submission_sha256   text not null check (submission_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  verdict             text not null check (verdict in ('NO_MATERIAL_GAPS', 'MATERIAL_GAPS')),
  body                jsonb not null,   -- ReviewVerdict (review-verdict.v1)
  review_label        text not null check (review_label = 'single_lab_review'),
  review_label_reason text not null,
  sealed_at           timestamptz not null default now()
);

create or replace function wos.check_round_human_review() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  r wos.rounds%rowtype;
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
  -- V1: authorized human reviewers are maintainers (ReviewPolicy independence.assignment = admin_assigned).
  if not exists (select 1 from wos.account_roles ar where ar.account_id = new.account_id and ar.role = 'maintainer') then
    raise exception 'wos: the human review seat is held by an authorized reviewer (a maintainer in V1)' using errcode = 'check_violation';
  end if;
  -- ReviewPolicy independence.humanMayBeSubjectAuthor = false; bootstrap.selfReviewSatisfiesRules = false: no exception.
  if (r.attempt_id is not null and exists (select 1 from wos.attempts a where a.id = r.attempt_id and a.account_id = new.account_id))
     or (r.document_id is not null and exists (
           select 1 from wos.changesets c join wos.tasks t on t.id = c.task_id
            where t.document_id = r.document_id and c.account_id = new.account_id and c.ok)) then
    raise exception 'wos: account % authored the subject of round % and may not hold its human review seat', new.account_id, r.id
      using errcode = 'check_violation';
  end if;
  -- ReviewPolicy independence.humanMayHoldAgentSlotOfSameRound = false.
  if exists (select 1 from wos.reviews v where v.round_id = r.id and v.account_id = new.account_id)
     or exists (select 1 from wos.tasks t join wos.leases l on l.task_id = t.id
                 where t.round_id = r.id and l.account_id = new.account_id and l.state = 'active') then
    raise exception 'wos: account % holds the agent seat of round % and may not also hold its human seat', new.account_id, r.id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger round_human_reviews_check before insert on wos.round_human_reviews
  for each row execute function wos.check_round_human_review();

-- Agent reviews on a fallback round: the Fable seat is refused, and the human reviewer never takes the agent seat too.
create or replace function wos.check_review_seat() returns trigger
language plpgsql security definer set search_path = wos, pg_temp as $$
declare
  seat text;
begin
  select second_seat into seat from wos.rounds where id = new.round_id;
  if seat = 'human' and new.slot = 'fable' then
    raise exception 'wos: round % runs under the fable_unavailable fallback: the Fable seat is replaced by the human review (D53)', new.round_id
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from wos.round_human_reviews h where h.round_id = new.round_id and h.account_id = new.account_id) then
    raise exception 'wos: account % holds the human seat of round % and may not also hold an agent seat', new.account_id, new.round_id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger reviews_0_seat before insert on wos.reviews for each row execute function wos.check_review_seat();

-- Append-only, like wos.reviews.
create trigger round_human_reviews_append_only before update or delete on wos.round_human_reviews
  for each row execute function wos.forbid_mutation();
create trigger round_human_reviews_no_truncate before truncate on wos.round_human_reviews
  for each statement execute function wos.forbid_mutation();
create trigger review_policy_switches_append_only before update or delete on wos.review_policy_switches
  for each row execute function wos.forbid_mutation();
create trigger review_policy_switches_no_truncate before truncate on wos.review_policy_switches
  for each statement execute function wos.forbid_mutation();

-- --------------------------------------------------------------------------------------------
-- 5. Findings from the human seat; rulings by the human (D53, D58: every conflict goes to the human)
-- --------------------------------------------------------------------------------------------
alter table wos.findings alter column review_id drop not null;
alter table wos.findings add column human_review_id uuid references wos.round_human_reviews (id);
alter table wos.findings add constraint findings_one_source check (num_nonnulls(review_id, human_review_id) = 1);
create unique index findings_human_review_local on wos.findings (human_review_id, local_id) where human_review_id is not null;

alter table wos.rulings alter column task_id drop not null;
alter table wos.rulings alter column lease_id drop not null;
alter table wos.rulings add column resolver text not null default 'agent' check (resolver in ('agent', 'human'));
alter table wos.rulings add column document_id uuid references wos.documents (id);
alter table wos.rulings add constraint rulings_resolver_shape check (
  (resolver = 'agent' and task_id is not null and lease_id is not null)
  or (resolver = 'human' and task_id is null and lease_id is null and document_id is not null)
);

-- --------------------------------------------------------------------------------------------
-- 6. Document versions: unique among non-abandoned rows (ROADMAP-PROTOCOL section 3: version = last merged + 1)
-- --------------------------------------------------------------------------------------------
drop index wos.documents_roadmap_version;
drop index wos.documents_contract_version;
create unique index documents_roadmap_version on wos.documents (target_id, version) where kind = 'roadmap' and state <> 'abandoned';
create unique index documents_contract_version on wos.documents (catalog_feature_id, version)
  where kind = 'feature_contract' and state <> 'abandoned';

-- --------------------------------------------------------------------------------------------
-- Grants and row-level security
-- --------------------------------------------------------------------------------------------
grant select, insert on wos.review_policy_switches, wos.round_human_reviews to wos_app;
grant execute on function wos.active_review_fallback() to wos_app;
alter table wos.review_policy_switches enable row level security;
alter table wos.round_human_reviews enable row level security;
-- Switches are public (D53: the switch is shown publicly); only a privileged actor writes one.
create policy public_read on wos.review_policy_switches for select to wos_app using (true);
create policy privileged_insert on wos.review_policy_switches for insert to wos_app with check (wos.is_privileged());
-- The human verdict is sealed like an agent verdict until the round is revealed.
create policy sealed_until_revealed on wos.round_human_reviews for select to wos_app
  using (
    wos.is_privileged()
    or account_id = wos.actor_id()
    or exists (select 1 from wos.rounds r where r.id = round_id and r.state = 'revealed')
  );
create policy reviewer_inserts on wos.round_human_reviews for insert to wos_app
  with check (wos.is_privileged() or account_id = wos.actor_id());
drop policy sealed_until_revealed on wos.findings;
create policy sealed_until_revealed on wos.findings for select to wos_app
  using (
    wos.is_privileged()
    or exists (select 1 from wos.reviews v where v.id = review_id and v.account_id = wos.actor_id())
    or exists (select 1 from wos.round_human_reviews h where h.id = human_review_id and h.account_id = wos.actor_id())
    or exists (select 1 from wos.rounds r where r.id = round_id and r.state = 'revealed')
  );
