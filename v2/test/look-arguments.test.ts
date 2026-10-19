import test from 'node:test';import assert from 'node:assert/strict';
import {selectLookArguments} from '../src/look-arguments.js';import {MockWorld} from '../src/mock.js';import {directSelection} from '../src/direct-selection.js';
test('batched camera preserves every integer yaw and pitch without extra calls',async()=>{
 const s=new MockWorld().snapshot();let calls=0;
 for(let yaw=0;yaw<360;yaw++){
  const pitch=(yaw%181)-90;
  const result=await selectLookArguments(s,async(q)=>{calls++;assert.deepEqual(Object.keys(q),['yawSector','yawOffset','pitchDegrees']);assert.equal(Object.keys(q.yawSector.criteria).length,8);assert.equal(Object.keys(q.yawOffset.criteria).length,45);assert.equal(Object.keys(q.pitchDegrees.criteria).length,181);return Object.fromEntries(Object.entries({yawSector:Math.floor(yaw/45),yawOffset:yaw%45,pitchDegrees:pitch+90}).map(([k,v])=>[k,{type:'choice',choice:'value_'+v,confidence:0}]));},'batched');
  assert.deepEqual(result,{yawDegrees:yaw,pitchDegrees:pitch});
 }assert.equal(calls,360);
});
test('sequential camera keeps three argument calls and selected yaw in pitch context',async()=>{
 const s=new MockWorld().snapshot();let calls=0;
 const result=await selectLookArguments(s,directSelection(async(q,c)=>{calls++;const name=Object.keys(q)[0];if(name==='pitchDegrees')assert.equal((c.boundArguments as any).yawDegrees,359);const choice=q[name].criteria.group_7?'group_7':name==='yawDegrees'?'value_359':'value_0';return {[name]:{type:'choice',choice,confidence:1}};}),'sequential');
 assert.equal(calls,3);assert.deepEqual(result,{yawDegrees:359,pitchDegrees:-90});
});
test('invalid batched answer is rejected without repairing or choosing an alternative',async()=>{
 await assert.rejects(selectLookArguments(new MockWorld().snapshot(),async()=>({yawSector:{type:'choice',choice:'value_8',confidence:1}}),'batched'),/Invalid batched/);
});

test('conditional parallel proposals cover every exact yaw and use only model-selected sector',async()=>{
 for(let yaw=0;yaw<360;yaw++){
  let calls=0;const result=await selectLookArguments(new MockWorld().snapshot(),async(q)=>{calls++;assert.equal(Object.keys(q).length,10);return Object.fromEntries(Object.entries(q).map(([k,v])=>{let choice=k==='yawSector'?'value_'+Math.floor(yaw/45):k==='pitchDegrees'?'value_180':Object.hasOwn(v.criteria,'value_'+yaw)?'value_'+yaw:Object.keys(v.criteria)[0];return [k,{type:'choice',choice,confidence:0}];}));},'parallel-branches');
  assert.equal(calls,1);assert.deepEqual(result,{yawDegrees:yaw,pitchDegrees:90});
 }
});

test('relative camera preserves all absolute headings at fractional and wrapping origins',async()=>{
 for(const heading of [0,94.95,359.95])for(let yaw=0;yaw<360;yaw++){
  const s=new MockWorld().snapshot();s.vision={yaw:heading*Math.PI/180,pitch:0,blocks:[]};let calls=0;
  const result=await selectLookArguments(s,async(q)=>{calls++;
   const values=Object.entries(q).filter(([k])=>k.startsWith('exactTurn')).flatMap(([,v])=>Object.values(v.criteria).map(x=>Number(String(x).match(/absolute yaw (\d+)deg/)![1])));
   assert.equal(new Set(values).size,360);assert.deepEqual([...values].sort((a,b)=>a-b),Array.from({length:360},(_,i)=>i));
   const turn=((yaw-Math.round(heading)+540)%360)-180,sector=Math.floor((turn+180)/45),offset=(turn+180)%45;
   return Object.fromEntries(Object.entries(q).map(([k,v])=>[k,{type:'choice',confidence:0,choice:k==='turnSector'?'value_'+sector:k==='pitchDegrees'?'value_'+(yaw%181):k==='exactTurn'+sector?'value_'+offset:Object.keys(v.criteria)[0]}]));
  },'relative-branches');
  assert.equal(calls,1);assert.deepEqual(result,{yawDegrees:yaw,pitchDegrees:yaw%181-90});
 }
});
test('relative binding rejects missing camera and malformed choices without a fallback',async()=>{
 const s=new MockWorld().snapshot();s.vision=undefined;
 await assert.rejects(selectLookArguments(s,async()=>{throw Error('must not call');},'relative-branches'),/requires observed camera/);
 s.vision={yaw:0,pitch:0,blocks:[]};
 await assert.rejects(selectLookArguments(s,async()=>({turnSector:{type:'choice',choice:'value_8',confidence:1}}),'relative-branches'),/Invalid relative/);
});
