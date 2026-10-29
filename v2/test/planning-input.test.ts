import test from 'node:test';import assert from 'node:assert/strict';import {planningInput} from '../src/planning-input.js';import {actionView} from '../src/action-view.js';
test('prompt compaction preserves evidence IDs, decision/results/changes and original stored observations',()=>{
 const old={id:'old',kind:'observation',at:1,data:{health:20,inventory:{oak_log:1},vision:{blocks:[{name:'oak_log',position:{x:9,y:2,z:3}}]}}};
 const action={id:'a',kind:'action',at:2,data:{decision:{action:'mine',confidence:.2},outcome:'failed',result:'no path',before:{health:20},after:{health:20},changes:{health:0}}};
 const c:any={recentActions:[action.data],goalReview:{observationId:'now',evidence:[old,{...old,id:'now'},action]}};
 const out=planningInput(c)!;assert.deepEqual(out.goalReview!.evidence.map(e=>e.id),['old','now','a']);
 const d=out.goalReview!.evidence.map(e=>e.data) as any[];assert.deepEqual(d[0].historicalVisibleBlockCounts,{oak_log:1});assert.equal(d[0].vision,undefined);assert.match(d[1].viewReference,/Current/);
 assert.deepEqual(d[2].decision,action.data.decision);assert.equal(d[2].result,'no path');assert.deepEqual(d[2].changes,{health:0});assert.deepEqual(out.recentActions,c.recentActions.map(actionView));assert.equal((out.recentActions as any)[0].decisionObserved,undefined);
 assert.ok(c.goalReview.evidence[0].data.vision);assert.ok(c.goalReview.evidence[2].data.before);
});
test('the compact action view is idempotent and keeps action, target, outcome, failure and vitals',async()=>{
 const {actionView}=await import('../src/action-view.js');
 const r:any={id:7,startedAt:1,endedAt:2,source:'selector',selectorKind:'jev',decision:{action:'mine',confidence:.4},outcome:'failed',goal:'g',stepId:null,
  executionPlan:{goal:'long plan text',intent:{taskId:'t1',description:'x'.repeat(500)},preferred:'mine',mine:{position:{x:1,y:2,z:3},expected:'stone'}},
  decisionObserved:{enemies:[{id:3,kind:'zombie',distance:4.26}],vision:{blocks:new Array(50).fill({name:'stone'})}},
  before:{position:{x:0,y:0,z:0},health:20,food:18,rememberedItems:new Array(20).fill('x'),time:{phase:'night'}},after:{position:{x:1,y:0,z:0},health:18,food:18},
  changes:{health:-2,view:{camera:1}},result:JSON.stringify({kind:'mining',blockBroken:false,meaning:'long',actionEvidence:{failureReason:'No path',from:{},to:{}}})};
 const v:any=actionView(r);
 assert.deepEqual(v.executionPlan,{preferred:'mine',mine:{position:{x:1,y:2,z:3},expected:'stone'},taskId:'t1'});
 assert.deepEqual(v.enemiesAtDecision,[{id:3,kind:'zombie',distance:4.3}]);assert.deepEqual(v.before,{position:{x:0,y:0,z:0},health:20,food:18,timePhase:'night'});
 assert.deepEqual(v.changes,{health:-2});assert.deepEqual(v.result,{kind:'mining',blockBroken:false,failureReason:'No path'});
 assert.deepEqual(actionView(v),v);assert.ok(JSON.stringify(v).length<JSON.stringify(r).length/3);
});
