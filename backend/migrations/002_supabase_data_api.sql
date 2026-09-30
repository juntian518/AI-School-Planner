-- Apply after 001. Data API access is server-side service_role only.
begin;
grant usage on schema ai_school_planner to service_role;
grant select, insert, update on ai_school_planner.schedule_snapshots, ai_school_planner.sync_state to service_role;
grant select, insert, update, delete on ai_school_planner.sync_locks to service_role;
create or replace function ai_school_planner.acquire_sync_lock(p_owner uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare affected integer;
begin
  insert into ai_school_planner.sync_locks(name,owner,expires_at)
  values('arbor',p_owner,clock_timestamp()+interval '330 seconds')
  on conflict(name) do update set owner=excluded.owner,expires_at=excluded.expires_at
  where ai_school_planner.sync_locks.expires_at<=clock_timestamp();
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;
create or replace function ai_school_planner.release_sync_lock(p_owner uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare affected integer;
begin
  delete from ai_school_planner.sync_locks where name='arbor' and owner=p_owner;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;
revoke all on function ai_school_planner.acquire_sync_lock(uuid), ai_school_planner.release_sync_lock(uuid) from public, anon, authenticated;
grant execute on function ai_school_planner.acquire_sync_lock(uuid), ai_school_planner.release_sync_lock(uuid) to service_role;
notify pgrst, 'reload schema';
commit;
