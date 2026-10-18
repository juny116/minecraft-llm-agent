import test from 'node:test';
import assert from 'node:assert/strict';
import {separateWithdrawal} from '../scripts/withdrawal-contract.js';
const q={destination:{type:'choice' as const,instructions:'Choose a destination',criteria:{value_0:{description:'coordinate',value:{x:1,y:2,z:3}},value_1:{description:'coordinate',value:{x:4,y:2,z:3}},none:'withdraw'}}};
test('withdraw gate leaves no binding or replacement call',async()=>{
 let calls=0;const out=await separateWithdrawal(async(q,c)=>{calls++;assert.deepEqual((c.bindingDomain as any).criteria,{value_0: qDummy.value_0,value_1:qDummy.value_1});return {bindingDecision:{type:'choice',choice:'withdraw',confidence:.01}};})(q,{argumentName:'destination'});
 assert.equal(calls,1);assert.equal(out.destination.choice,'none');
});
const qDummy=q.destination.criteria;
test('model commitment precedes unchanged value choice and never supplies a local default',async()=>{
 const calls:any[]=[];const before=structuredClone(q);
 const out=await separateWithdrawal(async(q,c)=>{calls.push({q,c});return calls.length===1?{bindingDecision:{type:'choice',choice:'bind',confidence:.01}}:{destination:{type:'choice',choice:'value_1',confidence:.01}};})(q,{argumentName:'destination'});
 assert.equal(out.destination.choice,'value_1');assert.deepEqual(q,before);
 assert.deepEqual(calls[1].q.destination.criteria,{value_0:qDummy.value_0,value_1:qDummy.value_1});assert.equal(calls.length,2);
});
test('invalid gate responses are rejected and unrelated questions pass through',async()=>{
 await assert.rejects(separateWithdrawal(async()=>({bindingDecision:{type:'choice',choice:'unknown',confidence:1}}))(q,{argumentName:'destination'}),/Invalid/);
 const out=await separateWithdrawal(async(q)=>q)({action:{type:'choice',instructions:'Choose',criteria:{wait:'wait'}}},{});
 assert.ok(out.action);
});
