import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {GoalBook,type GoalReview,type GoalDraft} from '../src/goals.js';import {MockWorld} from '../src/mock.js';import {Runtime} from '../src/runtime.js';
import type {Brain,Plan} from '../src/types.js';import {ApiBrain,Budget,selectorPlan,selectorObservation} from '../src/providers.js';import {config} from '../src/config.js';
const location=()=>join(mkdtempSync(join(tmpdir(),'mc-goals-')),'goals.json');
const draft=(r:GoalReview,id='food',status:GoalDraft['status']='active'):GoalDraft=>({id,description:'Find food',reason:'Observed inventory and hunger justify checking food',evidenceIds:[r.observationId],status,successCriteria:'Have food available',...(status==='paused'?{pauseReason:'Waiting for another task'}:{})});
const response=(r:GoalReview):Plan=>({goal:'Inspect possible food sources',preferred:'idle',steps:[],activeGoalId:'food',goalUpdates:[draft(r)]});
const opts={planMs:30000,actionMs:100,minConfidence:0,reflectionEnabled:false};
test('goals persist evidence and versions, restored intentions need fresh review',()=>{
 const file=location(),b=new GoalBook(file,'Alice'),w=new MockWorld(),r=b.review(w.snapshot(),null);b.apply(r,[draft(r)],'food');
 assert.equal(b.snapshot().activeGoal?.id,'food');const restored=new GoalBook(file,'Alice');assert.equal(restored.snapshot().activeGoal,null);assert.equal(restored.snapshot().goals[0].id,'food');
 const review=restored.review(w.snapshot(),null);assert.throws(()=>restored.apply(review,[],'food'),/unreviewed/);restored.apply(review,[draft(review)],'food');assert.equal(restored.snapshot().activeGoal?.version,2);
 const data=JSON.parse(readFileSync(file,'utf8'));assert.ok(data.evidence.some((e:any)=>e.id===r.observationId));assert.equal(data.revisions.length,2);
});
test('pause is durable and a new active intention does not erase held work',()=>{
 const b=new GoalBook(location(),'Alice'),s=new MockWorld().snapshot();let r=b.review(s,null);b.apply(r,[draft(r)],'food');b.pause('Threat requires review');
 assert.equal(b.snapshot().goals[0].status,'paused');assert.equal(b.snapshot().activeGoal,null);
 r=b.review(s,null);b.apply(r,[{...draft(r,'shelter'),description:'Seek safe ground'}],'shelter');assert.equal(b.snapshot().goals.length,2);assert.equal(b.snapshot().goals.find(g=>g.id==='food')?.pauseReason,'Threat requires review');
});
test('fabricated evidence, two active goals and stale reviews are rejected atomically',()=>{
 const file=location(),b=new GoalBook(file),s=new MockWorld().snapshot(),r=b.review(s,null);
 assert.throws(()=>b.apply(r,[{...draft(r),evidenceIds:['invented']}],'food'),/evidence/);assert.equal(b.snapshot().revision,0);
 assert.throws(()=>b.apply(r,[draft(r),draft(r,'shelter')],'food'),/active/);assert.equal(b.snapshot().goals.length,0);
 b.apply(r,[draft(r)],'food');assert.throws(()=>b.apply(r,[],null),/stale/);
});
test('completion cites current observation and terminal goals cannot silently reopen',()=>{
 const b=new GoalBook(),s=new MockWorld().snapshot();let r=b.review(s,null);const old=r.observationId;b.apply(r,[draft(r)],'food');r=b.review(s,null);
 assert.throws(()=>b.apply(r,[{...draft(r,'food','completed'),evidenceIds:[old]}],null),/fresh/);
 b.apply(r,[draft(r,'food','completed')],null);r=b.review(s,null);assert.throws(()=>b.apply(r,[draft(r)],'food'),/terminal/);
});
test('profile mismatch, corrupt storage and concurrent writers preserve evidence',()=>{
 const file=location(),a=new GoalBook(file,'Alice'),other=new GoalBook(file,'Alice'),s=new MockWorld().snapshot(),ar=a.review(s,null),br=other.review(s,null);a.apply(ar,[draft(ar)],'food');const saved=readFileSync(file,'utf8');
 assert.throws(()=>new GoalBook(file,'Bob'),/memory/);assert.throws(()=>other.apply(br,[draft(br)],'food'),/stale/);assert.equal(readFileSync(file,'utf8'),saved);
 writeFileSync(file,'bad json');assert.throws(()=>new GoalBook(file,'Alice'));assert.equal(readFileSync(file,'utf8'),'bad json');
});
test('runtime separates operator request and autonomous intention, reconnect rechecks before choosing',async()=>{
 const goals=new GoalBook(location()),w=new MockWorld();let choose=0,fail=false;const contexts:any[]=[];
 const brain:Brain={plan:async(_s,_h,_sig,request,c)=>{contexts.push({request,c});if(fail)throw Error('Invalid fixture failure');return response(c!.goalReview!);},choose:async()=>{choose++;return {action:'idle',confidence:1};}};
 w.execute=async()=> 'Waited';const r=new Runtime(w,brain,{...opts,goals},()=>{});r.setGoal('Cooperate freely without building obligations');await r.tick();await delay(5);
 assert.equal(r.planning.longTermGoal,'Find food');assert.equal(r.userGoal,'Cooperate freely without building obligations');assert.equal(contexts[0].request,r.userGoal);
 await r.tick();assert.equal(choose,1);w.state.ready=false;await r.tick();assert.equal(goals.snapshot().goals[0].status,'paused');assert.equal(r.plan.preferred,'idle');
 fail=true;w.state.ready=true;await r.tick();await delay(5);await r.tick();assert.equal(choose,1);assert.equal(goals.needsReview,true);r.close();
});
test('late review after operator change cannot save or reactivate old intentions',async()=>{
 const goals=new GoalBook(),w=new MockWorld();let resolve!:(p:Plan)=>void;let review!:GoalReview;
 const brain:Brain={plan:async(_s,_h,_sig,_u,c)=>{review=c!.goalReview!;return new Promise<Plan>(r=>resolve=r);},choose:async()=>({action:'idle',confidence:1})};
 const r=new Runtime(w,brain,{...opts,goals},()=>{});const pending=r.refreshPlan();r.setGoal('New request');resolve(response(review));await pending;assert.equal(goals.snapshot().goals.length,0);assert.equal(goals.needsReview,true);r.close();
});
test('unreviewed goals block ordinary work but hunger safety remains available',async()=>{
 const goals=new GoalBook(),w=new MockWorld();w.state.food=10;let actions:string[]=[];w.execute=async a=>{actions.push(a);w.state.food=20;return 'ate';};
 const brain:Brain={plan:async()=>{throw Error('Invalid temporary failure');},choose:async()=>{throw Error('must not choose ordinary work');}};
 const r=new Runtime(w,brain,{...opts,goals},()=>{});await r.tick();assert.deepEqual(actions,['eat']);assert.equal(goals.needsReview,true);r.close();
});
test('planner wire separates background/request/observation/memory and parses goal patches',async()=>{
 const w=new MockWorld(),goals=new GoalBook(),review=goals.review(w.snapshot(),'Cooperate');const c:any={goalReview:review};
 const request=(async(_url:any,init:any)=>{const body=JSON.parse(init.body),input=JSON.parse(body.messages.at(-1).content);assert.ok(input.gameContext.description);assert.equal(input.userRequest,'Cooperate');assert.ok(input.memory);assert.equal(input.state.memoryGuidance,undefined);assert.equal(input.planning.goalReview.observationId,review.observationId);return Response.json({choices:[{message:{content:JSON.stringify(response(review))}}],usage:{prompt_tokens:10,completion_tokens:10}});}) as typeof fetch;
 const brain=new ApiBrain({...config(),llmKey:'fake-test-key'},new Budget(2,2),request);const p=await brain.plan(w.snapshot(),[],new AbortController().signal,'Cooperate',c);assert.equal(p.activeGoalId,'food');
});
test('fast selector input excludes goal history and recipe catalog but keeps current execution data',()=>{
 const s=new MockWorld().snapshot();s.places=[{name:'stone',position:{x:4,y:64,z:4},lastSeen:1}];s.recipeBook.unlocked=['some_recipe'];const view:any=selectorObservation(s);assert.equal(view.places,undefined);assert.equal(view.recipeBook,undefined);assert.equal(view.health,20);
 const r=new GoalBook().review(s,null),p:any=selectorPlan({...response(r),mine:{position:{x:1,y:64,z:0},expected:'oak_log'}});assert.equal(p.goalUpdates,undefined);assert.equal(p.steps,undefined);assert.equal(p.activeGoalId,'food');assert.equal(p.mine.expected,'oak_log');
});
test('no active intention offers only waiting, not unrelated construction',async()=>{
 const w=new MockWorld(),goals=new GoalBook();w.state.canPlaceTable=true;const offered:string[][]=[];
 const brain:Brain={plan:async()=>({goal:'No useful task yet',preferred:'idle',goalUpdates:[],activeGoalId:null}),choose:async(_s,_p,opts)=>{offered.push(opts);return {action:'idle',confidence:1};}};
 w.execute=async()=> 'wait';const r=new Runtime(w,brain,{...opts,goals},()=>{});await r.tick();await delay(5);await r.tick();assert.deepEqual(offered,[['idle']]);r.close();
});
test('fresh successful review can resume saved intentions without replaying old action parameters',async()=>{
 const file=location(),old=new GoalBook(file),w=new MockWorld();const initial=old.review(w.snapshot(),null);old.apply(initial,[draft(initial)],'food');
 const goals=new GoalBook(file);let selected=0;const brain:Brain={plan:async(_s,_h,_sig,_u,c)=>response(c!.goalReview!),choose:async(_s,p)=>{assert.equal(p.activeGoalId,'food');assert.equal(p.mine,undefined);selected++;return {action:'idle',confidence:1};}};
 w.execute=async()=> 'wait';const r=new Runtime(w,brain,{...opts,goals},()=>{});await r.tick();await delay(5);assert.equal(goals.needsReview,false);await r.tick();assert.equal(selected,1);assert.equal(r.userGoal,null);r.close();
});
test('accounting drain closes gameplay without aborting pending model usage or applying late plans',async()=>{
 const goals=new GoalBook(),w=new MockWorld();let resolve!:(p:Plan)=>void;let signal!:AbortSignal;let review!:GoalReview;
 const brain:Brain={plan:async(_s,_h,s,_u,c)=>{signal=s;review=c!.goalReview!;return new Promise<Plan>(r=>resolve=r);},choose:async()=>({action:'idle',confidence:1})};
 const r=new Runtime(w,brain,{...opts,goals},()=>{});const pending=r.refreshPlan();r.close(true);assert.equal(w.state.ready,false);assert.equal(signal.aborted,false);resolve(response(review));await pending;assert.equal(goals.snapshot().goals.length,0);
});

test('invalid goal updates return feedback with fresh evidence on a bounded retry',async()=>{
 const g=new GoalBook(),w=new MockWorld();let calls=0,old='';const seen:any[]=[];
 const brain:Brain={plan:async(_s,_h,_sig,_u,c)=>{seen.push(c);calls++;if(calls===1){old=c!.goalReview!.observationId;const p=response(c!.goalReview!);p.goalUpdates![0].evidenceIds=['old-id'];return p;}return response(c!.goalReview!);},choose:async()=>({action:'idle',confidence:1})};
 const r=new Runtime(w,brain,{...opts,goals:g},()=>{});await r.refreshPlan();assert.equal(g.snapshot().goals.length,0);await r.refreshPlan(Date.now()+1100);assert.equal(calls,2);assert.match(seen[1].plannerFeedback,/evidence/);assert.notEqual(seen[1].goalReview.observationId,old);assert.equal(g.snapshot().activeGoal?.id,'food');assert.equal(r.planning.plannerFeedback,undefined);r.close();
});
