import test from 'node:test';
import assert from 'node:assert/strict';
import {PickupGoal} from '../src/navigation.js';
import {referenceRequest,decodeReferenceRequest} from '../src/jev-references.js';
test('pickup accepts adjacent standing cell, rejects two-block-below item and distant cell',()=>{
 const g=new PickupGoal({x:2.5,y:67.1,z:3.5});
 assert.equal(g.isEnd({x:1,y:67,z:3}),true);
 assert.equal(g.isEnd({x:2,y:69,z:3}),false);
 assert.equal(g.isEnd({x:0,y:67,z:3}),false);
});
test('254 full coordinates and descriptions survive compact option table',()=>{
 const context={position:{x:0,y:64,z:0}};
 const questions={destination:{criteria:Object.fromEntries(Array.from({length:254},(_,i)=>['value_'+i,{description:'Use this destination for move. Route availability remains unverified.',value:{x:i,y:64,z:i%12}}]))}};
 const r=referenceRequest(context,questions);
 assert.deepEqual(decodeReferenceRequest(r.state,r.questions),{context,questions});
 assert.ok(JSON.stringify(r).length<JSON.stringify({state:context,questions}).length*.8);
});
test('243 observed blocks retain all metadata through entity pool',()=>{
 const blocks=Array.from({length:243},(_,i)=>({name:i%2?'stone':'dirt',position:{x:i%12,y:64,z:Math.floor(i/12)},lastSeen:1000+i}));
 const context={blocks};const questions={block:{criteria:Object.fromEntries(blocks.map((value,i)=>['value_'+i,{description:'Mine this observed block.',value}]))}};
 const r=referenceRequest(context,questions);assert.deepEqual(decodeReferenceRequest(r.state,r.questions),{context,questions});
});
