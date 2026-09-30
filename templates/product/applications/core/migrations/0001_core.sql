-- wOS Core 0.1.0: the self-hosted environment's identity tables (schema core; search_path is set by the runner).
-- wOS Cloud's Core learns user, organization and role from environment tokens and keeps no accounts here.

create table environment (
  id uuid primary key,
  name text not null,
  created_at timestamptz not null default now(),
  singleton boolean not null default true unique check (singleton)
);

create table organizations (
  id uuid primary key,
  name text not null check (length(name) between 1 and 80),
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key,
  email text not null unique check (email = lower(email)),
  created_at timestamptz not null default now()
);

create table memberships (
  organization_id uuid not null references organizations (id),
  user_id uuid not null references users (id),
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table signin_requests (
  id uuid primary key,
  email text not null,
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  created_at timestamptz not null default now()
);
create index signin_requests_email_created on signin_requests (email, created_at);

create table sessions (
  token_hash text primary key,
  user_id uuid not null references users (id),
  organization_id uuid not null references organizations (id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index sessions_user on sessions (user_id);
