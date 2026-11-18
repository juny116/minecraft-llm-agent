import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseContract,type Tuple} from '../scripts/choice-contract.js';
const tuples:Tuple[]=[{action:'place_block',args:{item:'oak_planks',site:1}},{action:'place_block',args:{item:'stone',site:2}},{action:'move',args:{destination:{x:5,y:0,z:0}}}];
const reply=(name:string,choice:string)=>({[name]:{type:'choice',confidence:.1,choice}});
test('staged binding preserves legal combinations and accepts low confidence',async()=>{
 const seen:any[]=[];
 const result=await chooseContract(tuples,'staged',async(q,c)=>{
  seen.push({q,c});const n=Object.keys(q)[0];
  return reply(n,n==='action'?'place_block':'value_0');
 });
 assert.deepEqual(result,{kind:'selected',tuple:tuples[0]});
 assert.equal(Object.keys(seen[2].q.site.criteria).length,2);
 assert.deepEqual(seen[2].c.boundArguments,{item:'oak_planks'});
 assert.ok(seen.every(s=>!Object.values(s.q).some((q:any)=>'none' in q.criteria)));
});
test('explicit withdrawal does not force a value or retry',async()=>{
 let calls=0;const result=await chooseContract(tuples,'staged',async q=>{
  calls++;const n=Object.keys(q)[0];return reply(n,n==='action'?'place_block':'revise');
 });
 assert.deepEqual(result,{kind:'revise'});assert.equal(calls,2);
});
test('complete selection exposes all tuples and the same controls',async()=>{
 const result=await chooseContract(tuples,'complete',async q=>{
  assert.equal(Object.keys(q.complete.criteria).length,tuples.length+3);
  return reply('complete','tuple_2');
 });assert.deepEqual(result,{kind:'selected',tuple:tuples[2]});
});
test('empty domain does not call API; malformed response is rejected',async()=>{
 assert.deepEqual(await chooseContract([],'staged',async()=>{throw Error('called');}),{kind:'revise'});
 await assert.rejects(chooseContract(tuples,'complete',async()=>reply('complete','tuple_99')));
});
import {replayValidationState} from '../scripts/replay-validation.js';
import {MockWorld} from '../src/mock.js';
import {knownDestination} from '../src/types.js';
test('replay validation restores only witnessed current coordinates without mutating input',()=>{
 const s=new MockWorld().snapshot();s.observedDestinationKeys=undefined;s.places=[];s.navigationTargets=[];s.importantPlaces=[];
 s.vision={yaw:0,pitch:0,blocks:[{name:'stone',lastSeen:0,position:{x:8,y:64,z:0}}]};
 const restored=replayValidationState(s);
 assert.equal(knownDestination(restored,{x:8,y:64,z:0}),true);
 assert.equal(knownDestination(restored,{x:999,y:64,z:0}),false);
 assert.equal(s.observedDestinationKeys,undefined);
});
