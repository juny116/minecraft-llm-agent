import test from 'node:test';import assert from 'node:assert/strict';
import {movementEvidence,moveContextRequest,decodeMovementBlocks} from '../src/move-context.js';
import {jevLosslessRequest,decodeJevState,decodeJevQuestions} from '../src/jev-state.js';
test('movement evidence retains historical blocks and current changes without selecting destinations',()=>{
 const a={x:1,y:2,z:3},b={x:9,y:2,z:3};const s={places:[{position:a,name:'stone',lastSeen:1},{position:b,name:'oak_log',lastSeen:2}],vision:{yaw:0,pitch:0,blocks:[{position:a,name:'air',lastSeen:3}]},navigationTargets:[b]};
 const before=structuredClone(s),e=movementEvidence(s);assert.deepEqual(s,before);const decoded=decodeMovementBlocks(e);assert.equal(decoded.length,2);assert.equal(decoded[0].name,'air');assert.equal(decoded[0].lastSeen,3);assert.deepEqual(decoded[0].position,a);assert.equal(decoded[0].visibility,'current');assert.equal(decoded[1].visibility,'historical');assert.deepEqual(e.navigationHints,[b]);
});
test('approach semantics leaves every coordinate, withdrawal and original evidence unchanged',()=>{
 const q={destination:{type:'choice' as const,instructions:'choose',criteria:{value_0:{value:{x:1,y:2,z:3},description:'solid reference'},revise:'withdraw'}}};
 const c={movementEvidence:movementEvidence({places:[],navigationTargets:[]})},x=moveContextRequest(q,c);
 assert.deepEqual(x.questions,q);assert.deepEqual(x.context.movementEvidence,c.movementEvidence);assert.match(x.context.moveSemantics,/radius 2/);
 const packed=jevLosslessRequest(x.context,x.questions);assert.deepEqual(decodeJevState(packed.state),x.context);assert.deepEqual(decodeJevQuestions(packed.questions),q);
});
