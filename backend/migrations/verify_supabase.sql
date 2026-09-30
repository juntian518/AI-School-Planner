-- Transactional smoke test. All synthetic data is rolled back.
begin;
do $$
declare affected integer;
begin
  insert into ai_school_planner.schedule_snapshots(singleton,payload)
  values(true,'{"test":"first"}') on conflict(singleton) do update set payload=excluded.payload;
  insert into ai_school_planner.schedule_snapshots(singleton,payload)
  values(true,'{"test":"replacement"}') on conflict(singleton) do update set payload=excluded.payload;
  if (select payload->>'test' from ai_school_planner.schedule_snapshots where singleton) <> 'replacement' then
    raise exception 'snapshot replacement failed';
  end if;
  insert into ai_school_planner.sync_state(singleton,payload)
  values(true,'{"state":"success"}') on conflict(singleton) do update set payload=excluded.payload;
  insert into ai_school_planner.sync_locks(name,owner,expires_at)
  values('arbor','00000000-0000-4000-8000-000000000001',clock_timestamp()+interval '330 seconds')
  on conflict(name) do update set owner=excluded.owner,expires_at=excluded.expires_at
  where ai_school_planner.sync_locks.expires_at<=clock_timestamp();
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'active sync exists; retry later'; end if;
  insert into ai_school_planner.sync_locks(name,owner,expires_at)
  values('arbor','00000000-0000-4000-8000-000000000002',clock_timestamp()+interval '330 seconds')
  on conflict(name) do update set owner=excluded.owner,expires_at=excluded.expires_at
  where ai_school_planner.sync_locks.expires_at<=clock_timestamp();
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'active lock was replaced'; end if;
  delete from ai_school_planner.sync_locks where name='arbor' and owner='00000000-0000-4000-8000-000000000002';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'wrong owner released lock'; end if;
  update ai_school_planner.sync_locks set expires_at=clock_timestamp()-interval '1 second' where name='arbor';
  insert into ai_school_planner.sync_locks(name,owner,expires_at)
  values('arbor','00000000-0000-4000-8000-000000000002',clock_timestamp()+interval '330 seconds')
  on conflict(name) do update set owner=excluded.owner,expires_at=excluded.expires_at
  where ai_school_planner.sync_locks.expires_at<=clock_timestamp();
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'expired lock takeover failed'; end if;
end $$;
rollback;
select 'PASS: snapshot replacement, status write, active lock exclusion, owner check, expired lock recovery; test data rolled back' as verification;
