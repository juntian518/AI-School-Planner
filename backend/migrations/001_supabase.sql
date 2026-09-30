-- Run in the multi-projects Supabase SQL Editor as postgres.
-- Private schema: do not add it to the Data API exposed schemas.
begin;
create schema if not exists ai_school_planner;
revoke all on schema ai_school_planner from public, anon, authenticated;
create table if not exists ai_school_planner.schedule_snapshots (
  singleton boolean primary key default true check (singleton),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now()
);
create table if not exists ai_school_planner.sync_state (
  singleton boolean primary key default true check (singleton),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz not null default now()
);
create table if not exists ai_school_planner.sync_locks (
  name text primary key check (name = 'arbor'),
  owner uuid not null,
  expires_at timestamptz not null
);
alter table ai_school_planner.schedule_snapshots enable row level security;
alter table ai_school_planner.sync_state enable row level security;
alter table ai_school_planner.sync_locks enable row level security;
revoke all on all tables in schema ai_school_planner from public, anon, authenticated;
comment on schema ai_school_planner is 'AI School Planner: private server-side timetable cache and sync coordination';
commit;
