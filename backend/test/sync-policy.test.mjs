import test from 'node:test';
import assert from 'node:assert/strict';
import { dailySlot, syncDue } from '../lib/sync-policy.js';
import { synchronize } from '../lib/sync.js';
test('16:00 London follows summer/winter and DST change dates',()=>{
 for(const [day,utc] of [['2026-09-30','15'],['2026-12-01','16'],['2026-03-29','15'],['2026-10-25','16']]){
  const slot=dailySlot(new Date(day+'T18:00:00Z'));
  assert.equal(slot.toISOString(),day+'T'+utc+':00:00.000Z');
  assert.equal(syncDue(null,new Date(slot-1)),false);
  assert.equal(syncDue(null,slot),true);
 }
});
test('success suppresses repeats until next daily slot; old pre-16 success does not',()=>{
 const s={state:'success',attemptedAt:'2026-09-30T15:00:00Z'};
 assert.equal(syncDue(s,new Date('2026-09-30T22:00:00Z')),false);
 assert.equal(syncDue(s,new Date('2026-10-01T14:59:59Z')),false);
 assert.equal(syncDue(s,new Date('2026-10-01T15:00:00Z')),true);
 assert.equal(syncDue({...s,attemptedAt:'2026-09-30T13:00:00Z'},new Date('2026-09-30T15:00:00Z')),true);
});
test('failed retry waits ten minutes and continues across midnight',()=>{
 const s={state:'error',attemptedAt:'2026-09-30T22:55:00Z',nextRetryAt:'2026-09-30T23:06:00Z'};
 assert.equal(syncDue(s,new Date('2026-09-30T23:05:59Z')),false);
 assert.equal(syncDue(s,new Date('2026-09-30T23:06:00Z')),true);
});
test('scheduler does not call school before due and failure retry uses completion time',async()=>{
 const records={};let calls=0;
 const store={get:async k=>records[k||'snapshot'],set:async(v,k)=>{records[k||'snapshot']=v;},acquire:async()=>true,release:async()=>{}};
 const client={snapshot:async()=>{calls++;throw Error('upstream');}};
 await synchronize({store,client,scheduled:true,now:new Date('2026-09-30T14:00:00Z')});assert.equal(calls,0);
 await assert.rejects(synchronize({store,client,scheduled:true,now:new Date('2026-09-30T15:00:00Z'),finishedClock:()=>new Date('2026-09-30T15:02:00Z')}));
 assert.equal(records.status.nextRetryAt,'2026-09-30T15:12:00.000Z');
 await synchronize({store,client,scheduled:true,now:new Date('2026-09-30T15:11:00Z')});assert.equal(calls,1);
});
