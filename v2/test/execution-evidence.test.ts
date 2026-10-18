import test from 'node:test';import assert from 'node:assert/strict';
import {executionEvidence,navigationEvidence,NavigationFailure}from '../src/execution-evidence.js';
import {planningInput}from '../src/planning-input.js';import{selectorContext}from '../src/selector-context.js';import{MockWorld}from '../src/mock.js';
function look(id:number){return {id,decision:{action:'look'},executionPlan:{look:{yaw:0,pitch:0}},outcome:'succeeded',changes:{view:{camera:{yawDeltaDegrees:0,pitchDeltaDegrees:0},visibleBlocks:{enteredCount:0,leftCount:0}}}}as any;}
test('only consecutive completed unchanged looks form repetition evidence, not long mining or interrupted observations',()=>{
 assert.equal(executionEvidence([look(1),look(2)]).look?.completedConsecutiveSameView,2);
 const changed=look(3);changed.changes.view.visibleBlocks.enteredCount=1;assert.equal(executionEvidence([look(1),changed]).look,null);
 const cancelled=look(3);cancelled.outcome='cancelled';assert.equal(executionEvidence([look(1),cancelled]).look,null);
 const mine={...look(3),decision:{action:'mine'}};assert.equal(executionEvidence([mine]).look,null);
});
test('failed routes are grouped by exact target, keeping diagnostics and no permanent-unreachable claim',()=>{
 const make=(id:number,x:number)=>({id,endedAt:id,decision:{action:'move'},executionPlan:{destination:{x,y:80,z:0}},outcome:'failed',result:'no route',after:{position:{x:0,y:78,z:0}},navigation:{reason:'no route'}}as any);
 const e=executionEvidence([make(1,1),make(2,2),make(3,1)]);assert.deepEqual(e.failedMoves.map(g=>g.count),[2,1]);assert.deepEqual(e.failedMoves[0].ids,[1,3]);assert.equal(e.failedMoves[0].navigation.reason,'no route');
});
test('navigation evidence preserves timeout versus noPath and only supplied nearby observed blocks',()=>{
 const d=navigationEvidence('no progress',{x:0,y:0,z:0},{x:1,y:3,z:0},2,{status:'timeout',path:[]},[{name:'stone',position:{x:0,y:1,z:0},lastSeen:1},{name:'stone',position:{x:100,y:0,z:0},lastSeen:1}],true);
 assert.equal(d.search.status,'timeout');assert.equal(d.heightDifference,3);assert.equal(d.nearbyObservedBlocks.length,1);assert.equal(d.limits.automaticPlacement,false);assert.match(d.interpretation,/not proof/);assert.equal(new NavigationFailure(d).evidence,d);
});
test('same factual summary reaches JEV and medium planner without replacing raw records',()=>{
 const records=[look(1),look(2)],summary=executionEvidence(records);const ctx:any={recentActions:records};const p=planningInput(ctx)!;assert.equal(p.executionEvidence.look?.completedConsecutiveSameView,2);assert.deepEqual(ctx.recentActions,records);
 const s=selectorContext(new MockWorld().snapshot(),{options:[],execution:null,inbox:[],goal:null,executionEvidence:summary},{});assert.deepEqual(s.executionEvidence,summary);
});
import {Runtime}from '../src/runtime.js';import{MockBrain}from '../src/providers.js';
test('structured navigation failure survives runtime error sanitization into action journal',async()=>{
 const w=new MockWorld(),d=navigationEvidence('no observed route after local scan',w.snapshot().position,{x:2,y:70,z:0},2,{status:'noPath',path:[]},[],true);w.execute=async()=>{throw new NavigationFailure(d);};
 const r=new Runtime(w,new MockBrain(),{planMs:60000,actionMs:1000,minConfidence:.5},()=>{});
 try{await (r as any).run({action:'move',confidence:1},['move'],'selector',w.snapshot(),{goal:'inspect',preferred:'move',destination:d.target});const record=r.planning.recentActions.at(-1)!;assert.equal(record.outcome,'failed');assert.deepEqual(record.navigation,d);assert.match(record.result,/Destination not reached/);assert.deepEqual(planningInput(r.planning)?.executionEvidence.failedMoves[0].navigation,d);}finally{r.close();}
});
