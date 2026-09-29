-- 0000_meta.sql — migration ledger. Idempotent: the runner executes it before anything else.
-- Owner: Lead Architect. See packages/db/src/index.ts for the runner contract.

create schema if not exists wos_meta;

create table if not exists wos_meta.schema_migrations (
  version      text primary key check (version ~ '^\d{4}$'),
  name         text not null,
  checksum     text not null check (checksum ~ '^sha256:[0-9a-f]{64}$'),
  applied_at   timestamptz not null default now(),
  applied_by   text not null default current_user,
  execution_ms integer not null check (execution_ms >= 0)
);

-- The ledger itself is append-only: a migration is never un-applied or edited in place.
create or replace function wos_meta.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'wos_meta: % on %.% is forbidden (append-only ledger)', tg_op, tg_table_schema, tg_table_name
    using errcode = 'insufficient_privilege';
end $$;

drop trigger if exists schema_migrations_no_update on wos_meta.schema_migrations;
create trigger schema_migrations_no_update before update or delete on wos_meta.schema_migrations
  for each row execute function wos_meta.forbid_mutation();
drop trigger if exists schema_migrations_no_truncate on wos_meta.schema_migrations;
create trigger schema_migrations_no_truncate before truncate on wos_meta.schema_migrations
  for each statement execute function wos_meta.forbid_mutation();
