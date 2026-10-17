import test from 'node:test';import assert from 'node:assert/strict';import {planningInput} from '../src/planning-input.js';
test('prompt compaction preserves evidence IDs, decision/results/changes and original stored observations',()=>{
 const old={id:'old',kind:'observation',at:1,data:{health:20,inventory:{oak_log:1},vision:{blocks:[{name:'oak_log',position:{x:9,y:2,z:3}}]}}};
 const action={id:'a',kind:'action',at:2,data:{decision:{action:'mine',confidence:.2},outcome:'failed',result:'no path',before:{health:20},after:{health:20},changes:{health:0}}};
 const c:any={recentActions:[action.data],goalReview:{observationId:'now',evidence:[old,{...old,id:'now'},action]}};
 const out=planningInput(c)!;assert.deepEqual(out.goalReview!.evidence.map(e=>e.id),['old','now','a']);
 const d=out.goalReview!.evidence.map(e=>e.data) as any[];assert.deepEqual(d[0].historicalVisibleBlockCounts,{oak_log:1});assert.equal(d[0].vision,undefined);assert.match(d[1].viewReference,/Current/);
 assert.deepEqual(d[2].decision,action.data.decision);assert.equal(d[2].result,'no path');assert.deepEqual(d[2].changes,{health:0});assert.deepEqual(out.recentActions,c.recentActions);
 assert.ok(c.goalReview.evidence[0].data.vision);assert.ok(c.goalReview.evidence[2].data.before);
});
