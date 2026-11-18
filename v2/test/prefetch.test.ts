import test from 'node:test';import assert from 'node:assert/strict';import {setTimeout as delay} from 'node:timers/promises';
import {Runtime} from '../src/runtime.js';import {MockWorld} from '../src/mock.js';import {MockBrain,ApiBrain,Budget} from '../src/providers.js';import {config} from '../src/config.js';import type {Plan} from '../src/types.js';
const step=(id:string)=>({id,description:'Observed wood',action:'mine' as const,mine:{position:{x:1,y:64,z:0},expected:'oak_log'},completion:{kind:'action_success' as const}});
const next:Plan={goal:'Next grounded work',preferred:'craft',steps:[{id:'new-craft',description:'Craft wood',action:'craft',craft:{item:'oak_planks',count:1},completion:{kind:'action_success'}}]};
function fixture(count=2){
 let resolve!:(p:Plan)=>void,context:any,calls=0;const w=new MockWorld(),events:any[]=[];
 const r:any=new Runtime(w,{choose:new MockBrain().choose,supervise:async()=>({choice:'continue',confidence:1,review:'none',routes:{}}),plan:async(_s,_h,_a,_u,c)=>{calls++;context=c;return new Promise<Plan>(yes=>resolve=yes);}},{planMs:45000,actionMs:10000,minConfidence:0},(e,d)=>events.push({e,d}));
 r.longGoal='Gather';r.options.goals.needsReview=false;r.reasons.clear();r.medium={summary:'Work',steps:Array.from({length:count},(_,i)=>step('old-'+i)),activeStep:0};r.activateStep();r.actionPending=true;r.activeAction='mine';r.lastPlan=Date.now()-6000;
 return {r,w,events,reply:(p=next)=>resolve(p),get calls(){return calls;},get context(){return context;}};
}
test('prefetch extends tail without changing current plan or execution; subsequent steps activate locally',async()=>{
 const f=fixture(),before=structuredClone(f.r.plan),version=f.r.planVersion;f.r.refreshMedium(f.w.snapshot(),Date.now());assert.equal(f.context.mediumRequest.mode,'append');assert.equal(f.context.mediumRequest.remainingSteps.length,2);
 f.r.refreshMedium(f.w.snapshot(),Date.now()+6000);assert.equal(f.calls,1);f.reply();await delay(0);
 assert.deepEqual(f.r.plan,before);assert.equal(f.r.planVersion,version);assert.equal(f.r.actionPending,true);assert.equal(f.r.medium.steps.length,3);
 f.r.checkStep(f.w.snapshot(),'mine');assert.equal(f.r.plan.activeStepId,'old-1');f.r.checkStep(f.w.snapshot(),'mine');assert.equal(f.r.plan.activeStepId,'new-craft');assert.equal(f.calls,1);f.r.close();
});
test('late continuation can fill a just-exhausted chain without replaying completed work',async()=>{
 const f=fixture(1);f.r.refreshMedium(f.w.snapshot(),Date.now());f.r.checkStep(f.w.snapshot(),'mine');f.r.actionPending=false;f.reply();await delay(0);
 assert.equal(f.r.plan.activeStepId,'new-craft');assert.equal(f.r.reasons.has('medium_plan_completed'),false);f.r.close();
});
test('new failure or explicit invalidation discards an in-flight continuation',async()=>{
 for(const how of ['failure','invalidate']){const f=fixture();f.r.refreshMedium(f.w.snapshot(),Date.now());if(how==='failure')f.r.continuationEpoch++;else f.r.invalidate('changed');f.reply();await delay(0);assert.equal(f.r.medium.steps.length,2);assert.ok(f.events.some(x=>x.e==='plan_prefetch_discarded'));f.r.close();}
});
test('goal generation change cannot append an old continuation',async()=>{
 const f=fixture();f.r.refreshMedium(f.w.snapshot(),Date.now());f.r.setGoal('Another intention');f.reply();await delay(0);assert.equal(f.r.medium.steps.length,0);f.r.close();
});
test('duplicate remaining step IDs are rejected rather than replayed',async()=>{
 const f=fixture();f.r.refreshMedium(f.w.snapshot(),Date.now());f.reply({...next,steps:[step('old-1')]});await delay(0);assert.equal(f.r.medium.steps.length,2);assert.match(f.r.plannerFeedback,/NEW steps/);f.r.close();
});
test('prefetch has its own bounded schedule and does not add an empty-candidate trigger',async()=>{
 const f=fixture(3);f.r.refreshMedium(f.w.snapshot(),Date.now());assert.equal(f.calls,0);f.r.medium.activeStep=1;f.r.lastPlan=Date.now();f.r.refreshMedium(f.w.snapshot(),Date.now());assert.equal(f.calls,1);f.reply({goal:'No grounded continuation',preferred:'idle',steps:[]});await delay(0);f.r.refreshMedium(f.w.snapshot(),Date.now()+6000);assert.equal(f.calls,1);f.r.close();
});
test('planner prompt asks for grounded multi-step continuation, without fabricated future observations',async()=>{
 const f=fixture();f.r.refreshMedium(f.w.snapshot(),Date.now());let request:any;
 const api=new ApiBrain({...config(),targetPolicy:'planner',llmKey:'test'},new Budget(1,1),async(_u,init)=>{request=JSON.parse(init!.body as string);return Response.json({choices:[{message:{content:JSON.stringify(next)}}],usage:{prompt_tokens:100,completion_tokens:100}});});
 await api.plan(f.w.snapshot(),[],new AbortController().signal,null,f.context);assert.match(request.messages[0].content,/3-5 step/);const input=JSON.parse(request.messages.at(-1).content);assert.equal(input.planning.mediumRequest.mode,'append');assert.equal(input.planning.mediumRequest.remainingSteps.length,2);f.reply();await delay(0);f.r.close();
});

test('a selector review while working can replenish the tail, but failure review still replaces',async()=>{
 for(const reason of ['selector requested review','repeated_failure_or_no_progress']){const f=fixture();f.r.reasons.add(reason);f.r.refreshMedium(f.w.snapshot(),Date.now());assert.equal(f.context.mediumRequest?.mode,reason==='selector requested review'?'append':undefined);f.reply();await delay(0);f.r.close();}
});
