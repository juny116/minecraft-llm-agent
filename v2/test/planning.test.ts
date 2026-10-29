import {actionView} from '../src/action-view.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Runtime} from '../src/runtime.js';
import {MockWorld} from '../src/mock.js';
import {ApiBrain,Budget,parsePlan} from '../src/providers.js';
import {config} from '../src/config.js';
import {Journal,compact,changes,classify,type PlanningContext} from '../src/planning.js';
import type {Brain,Plan,Action} from '../src/types.js';
const opts={planMs:60000,actionMs:1000,minConfidence:.5,selectorKind:'jev'};
const flush=()=>new Promise(r=>setTimeout(r,0));
const stepPlan:Plan={longTermGoal:'Build a base',goal:'Obtain wood',preferred:'mine',mine:{position:{x:1,y:64,z:0},expected:'oak_log'},steps:[{id:'wood',description:'Get one log',action:'mine',mine:{position:{x:1,y:64,z:0},expected:'oak_log'},completion:{kind:'inventory_at_least',item:'oak_log',count:1}},{id:'store',description:'Store it',action:'deposit',container:{x:3,y:64,z:0},transfer:{item:'oak_log',count:1},completion:{kind:'action_success'}}]};
function setup(plan:Plan=stepPlan){
 const world=new MockWorld();world.state.inventory=[];
 const contexts:PlanningContext[]=[];let fail=false;
 world.execute=async a=>{if(fail)throw new Error('No log nearby');if(a==='mine'){world.state.logs++;world.state.inventory=[{name:'oak_log',count:world.state.logs,slot:9}];}return a==='mine'?JSON.stringify({kind:'mining',blockBroken:true,status:'finished',drops:[],inventoryGained:[{name:'oak_log',count:1}]}):`Completed ${a}`;};
 const brain:Brain={plan:async(_s,_h,_signal,_goal,ctx)=>{contexts.push(ctx!);return structuredClone(plan);},choose:async()=>({action:'mine',confidence:.9})};
 const runtime=new Runtime(world,brain,opts,()=>{});
 return {world,brain,runtime,contexts,fail:()=>{fail=true;}};
}
async function prime(r:Runtime){await r.tick();}

test('records selector observation, actual result and inventory delta; completes step and replans immediately',async()=>{
 const f=setup();await prime(f.runtime);await f.runtime.tick();
 const context=f.runtime.planning,record=context.recentActions.at(-1)!;
 assert.equal(record.selectorKind,'jev');assert.equal(record.decision.action,'mine');assert.equal(record.outcome,'succeeded');assert.equal(record.changes.inventory.oak_log,1);
 assert.equal(context.longTermGoal,'Build a base');assert.equal(context.mediumTerm.activeStep,1);assert.equal(f.runtime.plan.preferred,'deposit');assert.ok(context.replanReasons.includes('step_completed'));
 await f.runtime.refreshPlan();assert.ok(f.contexts.at(-1)!.recentActions.some(x=>x.changes.inventory.oak_log===1));assert.ok(f.contexts.at(-1)!.replanReasons.includes('step_completed'));f.runtime.close();
});
test('two failed attempts trigger replanning without waiting for periodic interval',async()=>{
 const f=setup();await prime(f.runtime);f.fail();await f.runtime.tick();await f.runtime.tick();
 assert.equal(f.runtime.planning.failureStreak,2);assert.ok(f.runtime.planning.replanReasons.includes('repeated_failure_or_no_progress'));
 const before=f.contexts.length;await f.runtime.refreshPlan();assert.equal(f.contexts.length,before+1);assert.equal(f.contexts.at(-1)!.recentActions.at(-1)!.result,'No log nearby');f.runtime.close();
});
test('autonomous long-term goal is stable without justification and user goal takes priority',async()=>{
 const f=setup();await prime(f.runtime);
 f.brain.plan=async()=>({...stepPlan,longTermGoal:'Abandon everything'});f.runtime.invalidate('test');await f.runtime.refreshPlan();assert.equal(f.runtime.planning.longTermGoal,'Build a base');
 f.brain.plan=async()=>({...stepPlan,longTermGoal:'Seek shelter',goalRevisionReason:'New danger observed'});f.runtime.invalidate('new threat');await f.runtime.refreshPlan();assert.equal(f.runtime.planning.longTermGoal,'Seek shelter');
 f.runtime.setGoal('Follow the user');await f.runtime.refreshPlan();assert.equal(f.runtime.planning.longTermGoal,'Follow the user');f.runtime.close();
});
test('new execution evidence invalidates a pending plan and retains the evidence for next request',async()=>{
 const f=setup();await prime(f.runtime);let resolve!:(p:Plan)=>void;
 f.brain.plan=()=>new Promise(r=>{resolve=r;});f.runtime.invalidate('test');const pending=f.runtime.refreshPlan();
 await f.runtime.tick();resolve({...stepPlan,goal:'stale'});await pending;
 assert.notEqual(f.runtime.plan.goal,'stale');assert.ok(f.runtime.planning.replanReasons.includes('stale_plan_needs_fresh_evidence'));f.runtime.close();
});
test('old action cancelled by user goal change cannot complete a new step',async()=>{
 const f=setup();await prime(f.runtime);let release!:()=>void;
 f.world.execute=async()=>{await new Promise<void>(r=>release=r);return 'Completed gather';};
 const pending=f.runtime.tick();await flush();f.runtime.setGoal('Different work');release();await pending;
 assert.equal(f.runtime.planning.longTermGoal,'Different work');assert.equal(f.runtime.planning.mediumTerm.steps.length,0);
 assert.equal(f.runtime.planning.recentActions.at(-1)!.outcome,'cancelled');assert.equal(f.runtime.planning.recentActions.at(-1)!.goal,'Build a base');f.runtime.close();
});
test('partial combat is not a successful kill or completed action step',()=>{
 assert.equal(classify('attack','{"outcome":"time_limit"}'),'partial');assert.equal(classify('attack','{"outcome":"target_left_view"}'),'partial');assert.equal(classify('flee','{"outcome":"distance_increased"}'),'succeeded');
});
test('bounded journal preserves failures and net changes in older summary',()=>{
 const j=new Journal(),s=new MockWorld().snapshot(),a=compact(s),b=compact({...s,health:18});
 for(let i=0;i<15;i++)j.add({startedAt:i,endedAt:i+1,source:'selector',selectorKind:'jev',decision:{action:'mine',confidence:.8},decisionObserved:a,options:['mine'],planVersion:1,goal:'test',stepId:'a',before:a,after:b,changes:changes(a,b),outcome:'failed',result:'No log nearby'});
 assert.equal(j.recent.length,12);assert.equal(j.older.count,3);assert.equal(j.older.byAction.mine!.failed,3);assert.equal(j.older.healthNet,-6);
});
test('planner payload includes structured evidence and validates measurable steps',async()=>{
 const f=setup();await prime(f.runtime);await f.runtime.tick();const ctx=f.runtime.planning;
 const transport=(async(_u:any,init:any)=>{const body=JSON.parse(init.body);const payload=JSON.parse(body.messages[1].content);
 const {executionEvidence,recentActions,...original}=payload.planning;const {recentActions:full,...rest}=ctx as any;assert.deepEqual(original,JSON.parse(JSON.stringify(rest)));assert.deepEqual(recentActions,JSON.parse(JSON.stringify(full.map(actionView))));assert.ok(Array.isArray(executionEvidence.failedMoves));return Response.json({choices:[{message:{content:JSON.stringify(stepPlan)}}],usage:{prompt_tokens:1,completion_tokens:1}});}) as typeof fetch;
 const brain=new ApiBrain({...config(),targetPolicy:'planner',llmKey:'fake'},new Budget(1,1),transport);
 const result=await brain.plan(f.world.snapshot(),[],new AbortController().signal,null,ctx);assert.equal(result.steps?.[0].id,'wood');
 assert.throws(()=>parsePlan({...stepPlan,steps:[{...stepPlan.steps![0],completion:{kind:'monster_dead'}}]}));
 assert.throws(()=>parsePlan({...stepPlan,steps:[stepPlan.steps![0],stepPlan.steps![0]]}));f.runtime.close();
});

test('replanning at a repeated-failure boundary does not keep repeating the blocked action',async()=>{
 const f=setup();await prime(f.runtime);f.fail();await f.runtime.tick();await f.runtime.tick();
 let resolve!:(p:Plan)=>void;f.brain.plan=()=>new Promise(r=>resolve=r);
 const before=f.runtime.planning.recentActions.length;const pending=f.runtime.refreshPlan();await f.runtime.tick();
 assert.equal(f.runtime.planning.recentActions.length,before);resolve({...stepPlan,goal:'Recovery plan'});await pending;
 assert.equal(f.runtime.plan.goal,'Recovery plan');assert.equal(f.runtime.planning.failureStreak,0);f.runtime.close();
});
test('elapsed action timeout counts as failure; explicit cancellation does not',async()=>{
 const f=setup();f.brain.choose=async()=>({action:'idle',confidence:1});const r=new Runtime(f.world,f.brain,{...opts,actionMs:10},()=>{});await prime(r);
 f.world.execute=async(_a,signal)=>{const {setTimeout:delay}=await import('node:timers/promises');await delay(200,undefined,{signal});return 'late';};await r.tick();
 assert.equal(r.planning.recentActions.at(-1)!.outcome,'failed');assert.match(r.planning.recentActions.at(-1)!.result,/timed out/);assert.equal(r.planning.failureStreak,1);r.close();
});

test('planner rejection backoff does not resume a repeatedly failed action',async()=>{
 const f=setup();await prime(f.runtime);f.fail();await f.runtime.tick();await f.runtime.tick();f.brain.plan=async()=>{throw Error('Invalid goal evidence reference');};await f.runtime.refreshPlan();const count=f.runtime.planning.recentActions.length;await f.runtime.tick();assert.equal(f.runtime.planning.recentActions.length,count);f.runtime.close();
});


test('disconnect inventory absence is not recorded as item loss',async()=>{
 const {changes,compact}=await import('../src/planning.js');const w=new MockWorld();w.state.inventory=[{name:'bread',count:3,slot:9}];w.state.logs=1;const before=compact(w.snapshot());w.state.ready=false;w.state.inventory=[];w.state.logs=0;const delta=changes(before,compact(w.snapshot()));assert.deepEqual(delta.inventory,{});assert.equal(delta.logs,0);
});
