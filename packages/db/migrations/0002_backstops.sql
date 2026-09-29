-- 0002_backstops.sql — contracts 2.0.0 (blocker B-0003-verification, B-0001-verification C-5).
-- Database backstops for SECURITY.md S-12, S-23, S-31 and private events. Owner: Lead Architect.

-- --------------------------------------------------------------------------------------------
-- 1. Reviews are bound to their task, lease, slot and manifest; bootstrap labels need bootstrap mode.
-- --------------------------------------------------------------------------------------------
create or replace function wos.check_review_independence() returns trigger
language plpgsql as $$
declare
  r wos.rounds%rowtype;
  t wos.tasks%rowtype;
  l wos.leases%rowtype;
  conflict boolean;
  bootstrap_on boolean;
begin
  select * into r from wos.rounds where id = new.round_id;
  if r.state <> 'awaiting_reviews' then
    raise exception 'wos: round % is %, cannot accept a review', r.id, r.state using errcode = 'check_violation';
  end if;
  if new.head_sha <> r.head_sha or new.submission_sha256 <> r.submission_sha256 then
    raise exception 'wos: review is bound to %/% but round % is %/%', new.head_sha, new.submission_sha256, r.id, r.head_sha, r.submission_sha256
      using errcode = 'check_violation';
  end if;

  -- Binding (S-23): the task is a review task of THIS round and slot; the lease is that task's active lease,
  -- held by the reviewing account; the manifest belongs to that lease.
  select * into t from wos.tasks where id = new.task_id;
  if t.id is null or t.round_id is distinct from new.round_id or t.reviewer_slot is distinct from new.slot
     or t.kind not in ('roadmap_review', 'feature_review', 'implementation_review') then
    raise exception 'wos: task % is not the % review task of round %', new.task_id, new.slot, new.round_id
      using errcode = 'check_violation';
  end if;
  select * into l from wos.leases where id = new.lease_id;
  if l.id is null or l.task_id <> new.task_id or l.account_id <> new.account_id or l.state <> 'active' then
    raise exception 'wos: lease % is not the active lease of task % held by %', new.lease_id, new.task_id, new.account_id
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from wos.context_manifests m where m.id = new.manifest_id and m.lease_id = new.lease_id) then
    raise exception 'wos: manifest % does not belong to lease %', new.manifest_id, new.lease_id using errcode = 'check_violation';
  end if;

  -- Bootstrap labels (S-31): only while bootstrap mode is on, and only for maintainers.
  if new.independence in ('bootstrap_self', 'bootstrap_maintainer') then
    select coalesce((value ->> 'enabled')::boolean, false) into bootstrap_on
      from wos.platform_settings where key = 'bootstrap_mode';
    if not coalesce(bootstrap_on, false) then
      raise exception 'wos: % review outside bootstrap mode', new.independence using errcode = 'check_violation';
    end if;
    if not exists (select 1 from wos.account_roles ar where ar.account_id = new.account_id and ar.role = 'maintainer') then
      raise exception 'wos: % review by a non-maintainer', new.independence using errcode = 'check_violation';
    end if;
  end if;

  -- Distinct reviewers per round (only two bootstrap_self reviews may share an account).
  if exists (
    select 1 from wos.reviews o
     where o.round_id = new.round_id and o.account_id = new.account_id
       and not (o.independence = 'bootstrap_self' and new.independence = 'bootstrap_self')
  ) then
    raise exception 'wos: account % already reviewed round % (distinct reviewers required)', new.account_id, new.round_id
      using errcode = 'check_violation';
  end if;

  if new.independence = 'bootstrap_self' then
    return new;
  end if;
  if r.attempt_id is not null then
    select exists (select 1 from wos.attempts a where a.id = r.attempt_id and a.account_id = new.account_id) into conflict;
  else
    select exists (
      select 1 from wos.changesets c join wos.tasks tk on tk.id = c.task_id
       where tk.document_id = r.document_id and c.account_id = new.account_id and c.ok
    ) into conflict;
  end if;
  if conflict then
    raise exception 'wos: account % authored the subject of round % and may not review it', new.account_id, r.id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- --------------------------------------------------------------------------------------------
-- 2. Bootstrap mode is one-way: once disabled it can never be enabled again (any role).
-- --------------------------------------------------------------------------------------------
create or replace function wos.bootstrap_one_way() returns trigger
language plpgsql as $$
begin
  if old.key = 'bootstrap_mode'
     and coalesce((old.value ->> 'enabled')::boolean, false) = false
     and coalesce((new.value ->> 'enabled')::boolean, false) = true then
    raise exception 'wos: bootstrap mode cannot be re-entered once ended' using errcode = 'check_violation';
  end if;
  if old.key <> new.key then
    raise exception 'wos: platform setting keys are immutable' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger platform_settings_bootstrap_one_way before update on wos.platform_settings
  for each row execute function wos.bootstrap_one_way();
create trigger platform_settings_no_delete before delete or truncate on wos.platform_settings
  for each statement execute function wos.forbid_mutation();

-- --------------------------------------------------------------------------------------------
-- 3. Private events are visible only to privileged actors and to the account they concern.
-- --------------------------------------------------------------------------------------------
drop policy app_all on wos.events;
create policy events_read on wos.events for select to wos_app
  using (
    visibility = 'public'
    or wos.is_privileged()
    or actor_account_id = wos.actor_id()
    or (payload ->> 'accountId') = wos.actor_id()::text
  );
create policy events_insert on wos.events for insert to wos_app with check (true);

-- --------------------------------------------------------------------------------------------
-- 4. Device keys: base64 of the raw 32-byte Ed25519 key (canonical.ts C-5).
-- --------------------------------------------------------------------------------------------
alter table wos.devices add constraint devices_public_key_raw_ed25519
  check (public_key ~ '^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$');
