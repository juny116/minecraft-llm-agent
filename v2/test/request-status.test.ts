import test from 'node:test';import assert from 'node:assert/strict';import {setTimeout as delay} from 'node:timers/promises';
import {Runtime} from '../src/runtime.js';import {MockWorld} from '../src/mock.js';import {MockBrain,ApiBrain,Budget} from '../src/providers.js';import {config} from '../src/config.js';
import {selectorContext} from '../src/selector-context.js';
import type {Brain} from '../src/types.js';import type {SupervisorInput} from '../src/supervision.js';
const flush=()=>delay(0),opts={planMs:45000,actionMs:10000,minConfidence:.55,selectorMs:0,longPlanMs:180000};
const context=(userRequest:string|null):any=>({userRequest,longTermGoal:null,mediumTerm:{summary:'',steps:[],activeStep:0},replanReasons:[],recentActions:[],olderSummary:{count:0,byAction:{},inventoryNet:{},healthNet:0},failureStreak:0});
const reply=(body:unknown)=>Response.json({choices:[{message:{content:JSON.stringify(body)}}],usage:{prompt_tokens:10,completion_tokens:10}});

test('long review must keep one active goal; a null choice is repaired by the model, not accepted',async()=>{
 const sent:any[]=[];const transport=(async(_u:any,init:any)=>{sent.push(JSON.parse(init.body));return reply({goalUpdates:[],activeGoalId:null});}) as typeof fetch;
 const b=new ApiBrain({...config(),mode:'llm',llmKey:'test'},new Budget(4,1),transport);
 await assert.rejects(b.reviewGoals(new MockWorld().snapshot(),context(null),AbortSignal.timeout(5000)),/Invalid active goal/);
 assert.equal(sent.length,2,'one bounded model repair, no local goal substitution');
 assert.match(sent[0].messages[0].content,/never null/);assert.doesNotMatch(sent[0].messages[0].content,/return no active goal/);
});

test('long review assesses an explicit request; the assessment is validated and the request text is untouched',async()=>{
 const answers=[{goalUpdates:[],activeGoalId:'next_goal'},{goalUpdates:[],activeGoalId:'next_goal',userRequestStatus:{status:'fulfilled',reason:'A white_bed is in the current inventory.'}}];let i=0;
 const transport=(async()=>reply(answers[Math.min(i++,1)])) as typeof fetch;
 const b=new ApiBrain({...config(),mode:'llm',llmKey:'test'},new Budget(4,1),transport);
 const out:any=await b.reviewGoals(new MockWorld().snapshot(),context('Craft one white bed'),AbortSignal.timeout(5000));
 assert.equal(i,2,'missing status triggers repair');assert.deepEqual(out.userRequestStatus,{status:'fulfilled',reason:'A white_bed is in the current inventory.'});
 i=1;const none:any=await b.reviewGoals(new MockWorld().snapshot(),context(null),AbortSignal.timeout(5000));
 assert.equal(none.userRequestStatus,undefined,'no request, no status');
});

test('runtime passes the fulfilled-request assessment to JEV and planning, and clears it when the operator request changes',async()=>{
 const inputs:SupervisorInput[]=[];
 const b:Brain={plan:()=>new Promise(()=>{}),choose:new MockBrain().choose,supervise:async(_s,i)=>{inputs.push(structuredClone(i));return {choice:'continue',confidence:.9,review:'none',routes:{}};},
  reviewGoals:async(_s,c)=>({goalUpdates:[{id:'tidy_area',description:'Organize nearby resources',reason:'Bed request completed; nearby logs observed',status:'active',successCriteria:'Logs stored in the observed chest',evidenceIds:[c.goalReview!.observationId]}],activeGoalId:'tidy_area',userRequestStatus:{status:'fulfilled',reason:'white_bed observed in inventory'}})};
 const r=new Runtime(new MockWorld(),b,opts,()=>{});r.setGoal('Craft one white bed');
 await r.tick();await flush();await r.tick();await flush();
 const status=inputs.at(-1)?.userRequestStatus;
 assert.equal(status?.status,'fulfilled');assert.equal(status?.request,'Craft one white bed');assert.equal(inputs.at(-1)?.userRequest,'Craft one white bed');
 assert.equal(r.planning.userRequestStatus?.status,'fulfilled');assert.equal(r.planning.longTermGoal,'Organize nearby resources');
 assert.equal((selectorContext(new MockWorld().snapshot(),inputs.at(-1)!,{}) as any).userRequestStatus.status,'fulfilled');
 r.setGoal('Build a small shelter');assert.equal(r.planning.userRequestStatus,undefined);
 r.close();
});
