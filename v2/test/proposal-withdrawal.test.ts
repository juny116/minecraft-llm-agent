import test from 'node:test';import assert from 'node:assert/strict';import {proposalWithdrawal} from '../src/proposal-withdrawal.js';
const q={destination:{type:'choice' as const,instructions:'Choose',criteria:{value_0:{description:'reference',value:{x:1,y:2,z:3}},revise:'withdraw'}}};
test('a concrete proposal is reviewed before binding and can be rejected without replacement',async()=>{
 for(const decision of ['bind','withdraw']){const calls:any[]=[];const out=await proposalWithdrawal(async(q,c)=>{calls.push({q,c});return calls.length===1?{destination:{type:'choice',choice:'value_0',confidence:.01}}:{bindingDecision:{type:'choice',choice:decision,confidence:.01}};})(q,{argumentName:'destination'});
 assert.equal(calls.length,2);assert.deepEqual(calls[1].c.proposedArgument.value,q.destination.criteria.value_0);assert.equal(out.destination.choice,decision==='bind'?'value_0':'revise');assert.ok(q.destination.criteria.revise);}
});
test('a group remains provisional and invalid proposals never create a local choice',async()=>{
 let calls=0;const ask=proposalWithdrawal(async()=>{calls++;return {destination:{type:'choice',choice:'group_0',confidence:.3}};});
 const result=await ask({destination:{...q.destination,criteria:{group_0:{description:'group',values:[1,2]},revise:'withdraw'}}},{argumentName:'destination'});assert.equal(calls,1);assert.equal(result.destination.choice,'group_0');
 await assert.rejects(proposalWithdrawal(async()=>({destination:{type:'choice',choice:'invented',confidence:1}}))(q,{argumentName:'destination'}),/Invalid/);
});
