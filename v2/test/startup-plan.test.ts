import test from 'node:test';import assert from 'node:assert/strict';import {setTimeout as delay} from 'node:timers/promises';
import {Runtime} from '../src/runtime.js';import {MockWorld} from '../src/mock.js';import {MockBrain} from '../src/providers.js';import type {Brain,Plan} from '../src/types.js';
const plan:Plan={goal:'Get bed materials',preferred:'mine',intent:{description:'Acquire missing materials for a bed',desiredInventory:[{item:'white_bed',count:1}],constraints:[]}};
function fixture(goal:string|null='Make one white bed'){
 let finishLong!:(v:any)=>void,finishMedium!:(v:Plan)=>void,longContext:any,mediumContext:any,mediumCalls=0;
 const w=new MockWorld(),events:any[]=[];
 const b:Brain={choose:new MockBrain().choose,reviewGoals:async(_s,c)=>{longContext=c;return new Promise(r=>finishLong=r);},plan:async(_s,_h,_sig,_user,c)=>{mediumCalls++;mediumContext=c;return new Promise(r=>finishMedium=r);},supervise:async()=>({choice:'unresolved',reason:'test',confidence:1,review:'none',routes:{}})};
 const r=new Runtime(w,b,{planMs:45000,actionMs:10000,minConfidence:0,selectorMs:0},(e,f)=>events.push({e,...f}));if(goal)r.setGoal(goal);
 return {r,w,events,get mediumCalls(){return mediumCalls;},get context(){return mediumContext;},medium:()=>finishMedium(structuredClone(plan)),long:()=>finishLong({goalUpdates:[{id:'bed',description:'Make a useful bed',reason:'Explicit request',status:'active',successCriteria:'Bed in inventory',evidenceIds:[longContext.goalReview.observationId]}],activeGoalId:'bed'})};
}
test('explicit request starts medium before long finishes; a late initial long response preserves the task',async()=>{
 const f=fixture();await f.r.tick();assert.equal(f.mediumCalls,1);assert.equal(f.context.mediumStartup.source,'explicit_user_request');assert.equal(f.context.longTermGoal,null);
 f.medium();await delay(0);const task=f.r.planning.workIntent;assert.ok(task);f.long();await delay(0);assert.deepEqual(f.r.planning.workIntent,task);assert.equal(f.r.planning.longTermGoal,'Make a useful bed');f.r.close();
});
test('startup medium can finish after long review without a false stale-goal rejection',async()=>{
 const f=fixture();await f.r.tick();f.long();await delay(0);f.medium();await delay(0);assert.equal(f.r.planning.workIntent?.description,plan.intent!.description);f.r.close();
});
test('no explicit goal keeps initial long review gating; no local inferred objective',async()=>{
 const f=fixture(null);await f.r.tick();assert.equal(f.mediumCalls,0);f.r.close();
});
test('changed request invalidates the pending initial medium plan',async()=>{
 const f=fixture();await f.r.tick();f.r.setGoal('Find another player');f.medium();f.long();await delay(0);assert.equal(f.r.planning.workIntent,undefined);assert.equal(f.r.planning.longTermGoal,null);f.r.close();
});
test('a death invalidates a pending initial medium plan',async()=>{
 const f=fixture();await f.r.tick();f.w.state.health=0;await f.r.tick();f.medium();f.long();await delay(0);assert.equal(f.r.planning.workIntent,undefined);f.r.close();
});
