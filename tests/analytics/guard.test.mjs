import test from 'node:test';
import assert from 'node:assert/strict';
import { TrafficGate } from '../../analytics/guard.mjs';

function gate(env={}) {
  const entries=new Map();let puts=0,alarm=null;
  const storage={get:async key=>entries.get(key),put:async(key,value)=>{puts++;entries.set(key,value);},transaction:async fn=>fn(storage),getAlarm:async()=>alarm,setAlarm:async value=>{alarm=value;}};
  const instance=new TrafficGate({storage},env);
  return {run:body=>instance.fetch(new Request('https://gate/',{method:'POST',body:JSON.stringify(body)})).then(r=>r.json()),writes:()=>puts};
}
test('challenged and visitor-limited traffic cannot consume the daily accepted-event allowance',async()=>{
  const g=gate({MAX_EVENTS_PER_DAY:'40',MAX_EVENTS_PER_MINUTE:'1000'});
  for(let n=0;n<30;n++)assert.equal((await g.run({action:'event',ip:'i',visitor:'v'})).allowed,true);
  for(let n=0;n<200;n++)assert.equal((await g.run({action:'event',ip:'i',visitor:'v'})).allowed,false);
  for(let n=0;n<10;n++)assert.equal((await g.run({action:'event',ip:'new'+n,visitor:'new'+n,proof:true})).allowed,true);
  assert.equal((await g.run({action:'event',ip:'last',visitor:'last',proof:true})).allowed,false);
});
test('once request quota and rejection sample are recorded, repeated rejection causes no storage writes',async()=>{
  const g=gate({MAX_REQUESTS_PER_MINUTE:'5'});
  for(let n=0;n<5;n++)assert.equal((await g.run({action:'request'})).allowed,true);
  assert.equal((await g.run({action:'request'})).allowed,false);
  const saturated=g.writes();
  for(let n=0;n<100;n++)assert.equal((await g.run({action:'request'})).allowed,false);
  assert.equal(g.writes(),saturated);
});
