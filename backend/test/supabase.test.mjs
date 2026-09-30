import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../lib/store.js';
const env = { STORAGE_DRIVER: 'supabase', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test' };
test('Data API uses server key, schema headers, atomic upsert, and owner-bound lock RPC', async () => {
  const calls = [];
  const replies = [[], null, [{payload:{events:[]}}], true, false, true];
  const store = createStore(env, async (url, options) => {
    calls.push({url, ...options});
    const value = replies.shift();
    return value === null ? new Response(null,{status:204}) : Response.json(value);
  });
  assert.equal(await store.get(), null);
  await store.set({state:'success'}, 'status');
  assert.deepEqual(await store.get(), {events:[]});
  assert.equal(await store.acquire('owner-a'), true);
  assert.equal(await store.acquire('owner-b'), false);
  await store.release('owner-b');
  for (const c of calls) {
    assert.equal(c.headers.apikey, env.SUPABASE_SECRET_KEY);
    assert.equal(c.headers.Authorization, undefined);
    assert.equal(c.headers['Accept-Profile'], 'ai_school_planner');
    assert.equal(c.headers['Content-Profile'], 'ai_school_planner');
    assert.equal(c.redirect, 'error');
  }
  assert.equal(calls[1].url.pathname, '/rest/v1/sync_state');
  assert.equal(calls[1].url.searchParams.get('on_conflict'),'singleton');
  assert.equal(JSON.parse(calls[1].body).payload.state,'success');
  assert.equal(calls[3].url.pathname,'/rest/v1/rpc/acquire_sync_lock');
  assert.equal(JSON.parse(calls[5].body).p_owner,'owner-b');
});
test('Data API fails closed on bad configuration, HTTP errors, and malformed lock replies', async () => {
  for (const change of [{SUPABASE_SECRET_KEY:'sb_publishable_no'}, {SUPABASE_URL:'http://example.supabase.co'}, {SUPABASE_URL:'https://user:pass@example.supabase.co'}]) {
    assert.throws(()=>createStore({...env,...change}));
  }
  const failed = createStore(env, async()=>new Response('sensitive upstream content',{status:403}));
  await assert.rejects(failed.get(),{message:'Supabase storage unavailable (HTTP 403)'});
  await assert.rejects(createStore(env,async()=>Response.json('true')).acquire('owner'), /lock response invalid/);
  await assert.rejects(createStore(env,async()=>{throw Error('secret transport detail');}).get(),{message:'Supabase request failed'});
});
