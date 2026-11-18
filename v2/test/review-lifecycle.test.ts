import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as flush} from 'node:timers/promises';
import {Runtime} from '../src/runtime.js';
import {MockWorld} from '../src/mock.js';
import {ReviewLifecycle,safeDecisionError} from '../src/review-lifecycle.js';
import {placeEvidence} from '../src/important-places.js';
import type {Brain,Plan} from '../src/types.js';
import type {Supervision} from '../src/supervision.js';

const intent:Plan={goal:'Improve an observed work area',preferred:'look',intent:{description:'Improve the work area using observed supplies',desiredInventory:[],constraints:[]},proposals:[],steps:[]};
const reconsider:Supervision={choice:'unresolved',confidence:1,review:'medium',routes:{},reason:'Model requested planning'};
function fixture(t:any,supervise?:Brain['supervise']){
 let clock=100_000;
 t.mock.method(Date,'now',()=>clock);
 const world=new MockWorld();world.state.dimension='overworld';
 const initial=world.snapshot(),calls:any[]=[],inputs:any[]=[],events:any[]=[];
 const pending:Array<{resolve:(p:Plan)=>void;reject:(e:Error)=>void}>=[];
 const brain:Brain={parameterSelection:true,choose:async()=>({action:'idle',confidence:1}),plan:async(_s,_h,_sig,_u,context)=>{calls.push({at:clock,context});return new Promise<Plan>((resolve,reject)=>pending.push({resolve,reject}));},supervise:supervise??(async(_s,input)=>{inputs.push(input);return reconsider;})};
 const r:any=new Runtime(world,brain,{planMs:45_000,actionMs:10_000,minConfidence:0,selectorMs:1_000},(event,data)=>events.push({event,data}));
 r.longGoal='Improve a work area';r.options.goals.needsReview=false;r.lastReady=true;r.lastLifeKey='true';r.longRequested=false;r.longLast=clock;r.reasons.clear();
 const s=r.observation();r.rememberSelectionFeedback('Previous unexecuted placement choice',r.reviewLifecycle.basis(r.planVersion),clock-10_000);
 r.requestPlan('initial_test_review');r.refreshMedium(s,clock);
 assert.equal(calls.length,1);
 t.after(()=>r.close());
 return {r,world,initial,calls,inputs,events,pending,set:(value:number)=>clock=value};
}

test('same observation review while pending is acknowledged without surviving accepted plan',async t=>{
 const f=fixture(t);f.set(101_000);
 for(const block of f.world.state.vision!.blocks)block.lastSeen=Date.now();
 const originalCitationIds=f.r.observation().placeEvidence.map((b:any)=>b.id);
 await f.r.tick();
 assert.equal(f.inputs[0].planningState.medium.pending,true);
 assert.equal(f.inputs[0].planningState.medium.current.id,1);
 assert.equal(f.r.reasons.size,0);
 f.set(102_000);f.pending.shift()!.resolve(structuredClone(intent));await flush();
 assert.equal(f.r.planPending,false);assert.equal(f.r.planVersion,1);
 const state=f.r.planning.planningState,status=f.r.planning.selectorFeedbackStatus;
 assert.equal(state.medium.pending,false);assert.equal(state.medium.lastCompleted.status,'applied');assert.equal(state.medium.lastCompleted.appliedPlanVersion,1);
 assert.equal(status.current.status,'reviewed');assert.equal(status.current.reviewedByPlanVersion,1);
 assert.match(f.r.planning.selectorFeedback,/Previous unexecuted/);
 f.set(105_000);f.r.refreshMedium(f.r.observation(),Date.now());
 assert.equal(f.calls.length,1);
 assert.deepEqual(f.world.snapshot(),{...f.initial,vision:f.world.state.vision});
 assert.deepEqual(f.inputs[0].planningState.medium.current.observationVersion,1);
 assert.deepEqual(f.r.observation().placeEvidence.map((b:any)=>b.id),originalCitationIds);
 assert.ok(f.events.some(e=>e.event==='plan_review_deduplicated'));
});

test('new world evidence while planning preserves a new review request after acceptance',async t=>{
 const f=fixture(t);f.world.state.inventory=[{name:'oak_planks',count:2,slot:9}];
 f.set(101_000);await f.r.tick();assert.ok(f.r.reasons.has('selector requested review'));
 f.set(102_000);f.pending.shift()!.resolve(structuredClone(intent));await flush();
 assert.ok(f.r.reasons.has('selector requested review'));
 f.set(105_000);f.r.refreshMedium(f.r.observation(),Date.now());assert.equal(f.calls.length,2);
});

test('failure arriving during planning remains unreviewed and keeps its request',async t=>{
 const failure:Supervision={...reconsider,reason:'No suitable placementSite',attempt:{action:'place_block',boundArguments:{blockItem:'oak_planks'},unresolvedArgument:{name:'placementSite',availableValues:2}}};
 const f=fixture(t,async()=>failure);f.set(101_000);await f.r.tick();
 assert.ok(f.r.reasons.has('selector requested review'));
 f.set(102_000);f.pending.shift()!.resolve(structuredClone(intent));await flush();
 const status=f.r.planning.selectorFeedbackStatus;
 assert.equal(status.total,2);assert.equal(status.history[0].status,'reviewed');assert.equal(status.current.status,'unreviewed');
 assert.match(status.current.feedback,/placementSite/);
 f.set(105_000);f.r.refreshMedium(f.r.observation(),Date.now());assert.equal(f.calls.length,2);
 assert.equal(f.calls[1].context.selectorFeedbackStatus.current.status,'unreviewed');
});

test('independent failure reasons are not erased when an in-flight review succeeds',async t=>{
 const f=fixture(t);f.r.requestPlan('repeated_failure_or_no_progress');
 f.set(102_000);f.pending.shift()!.resolve(structuredClone(intent));await flush();
 assert.ok(f.r.reasons.has('repeated_failure_or_no_progress'));
 f.set(105_000);f.r.refreshMedium(f.r.observation(),Date.now());assert.equal(f.calls.length,2);
});

test('late selector review of a plan already reviewed is acknowledged, not requeued',async t=>{
 let reply!:(value:Supervision)=>void;
 const f=fixture(t,async()=>await new Promise<Supervision>(resolve=>reply=resolve));
 f.set(101_000);const tick=f.r.tick();
 f.set(102_000);f.pending.shift()!.resolve(structuredClone(intent));await flush();
 reply(reconsider);await tick;assert.equal(f.r.reasons.size,0);
 f.set(105_000);f.r.refreshMedium(f.r.observation(),Date.now());assert.equal(f.calls.length,1);
});

test('failed review does not claim feedback reviewed or deduplicate a retry',async t=>{
 const f=fixture(t);f.set(102_000);f.pending.shift()!.reject(Error('Failure fixture'));await flush();
 assert.equal(f.r.planning.planningState.medium.lastCompleted.status,'failed');
 assert.equal(f.r.planning.selectorFeedbackStatus.current.status,'unreviewed');
 assert.ok(f.r.reasons.has('medium_plan_error'));
 f.set(112_000);f.r.refreshMedium(f.r.observation(),Date.now());assert.equal(f.calls.length,2);
});

test('observation versions ignore refreshed timestamps but preserve changed facts',()=>{
 const tracker=new ReviewLifecycle(),s=new MockWorld().snapshot();
 const first=tracker.observe(s);s.vision!.blocks[0].lastSeen=123456;
 assert.equal(tracker.observe(s),first);
 s.health--;assert.equal(tracker.observe(s),first+1);
 s.vision!.blocks.push({name:'stone',position:{x:10,y:64,z:0},lastSeen:123456});assert.equal(tracker.observe(s),first+2);
});

test('timestamp-derived place citations refresh without manufacturing new physical evidence',()=>{
 const tracker=new ReviewLifecycle(),s=new MockWorld().snapshot();s.dimension='overworld';
 s.placeEvidence=placeEvidence(s);const firstIds=s.placeEvidence.map(b=>b.id),first=tracker.observe(s);
 for(const block of s.vision!.blocks)block.lastSeen=1000;
 s.placeEvidence=placeEvidence(s);const before=structuredClone(s);
 assert.notDeepEqual(s.placeEvidence.map(b=>b.id),firstIds);
 assert.equal(tracker.observe(s),first);assert.deepEqual(s,before);
 s.vision!.blocks[0].name='stone';s.placeEvidence=placeEvidence(s);
 assert.equal(tracker.observe(s),first+1);
 s.chatEvents=[{id:'message-1',at:1000,speaker:'Bob',text:'Hello'}];
 assert.equal(tracker.observe(s),first+2);
 s.chatEvents=[{id:'message-2',at:2000,speaker:'Bob',text:'Hello'}];
 assert.equal(tracker.observe(s),first+3); // Distinct events retain identity.
});

test('feedback evidence remains available after an action starts; no physical resolution claimed',()=>{
 const tracker=new ReviewLifecycle(),s=new MockWorld().snapshot();tracker.observe(s);
 const basis=tracker.basis(1);tracker.noteFeedback('unexecuted choice',basis,10);tracker.actionStarted(20);
 const status=tracker.feedbackStatus();assert.equal(status.total,1);assert.equal(status.current!.status,'action_started');assert.equal(status.current!.feedback,'unexecuted choice');
});

test('decision error diagnostics classify without copying provider secrets or URLs',()=>{
 const secret='https://private.example/token=not-for-output';
 assert.deepEqual(safeDecisionError(Error('API 529 '+secret)),{category:'provider_http',status:529});
 assert.deepEqual(safeDecisionError(Error('API http 529; usage bounded conservatively')),{category:'provider_http',status:529});
 assert.deepEqual(safeDecisionError(Error('API transport; usage bounded conservatively')),{category:'provider_transport'});
 assert.deepEqual(safeDecisionError(Error('API cooldown; request not sent')),{category:'provider_backoff'});
 assert.deepEqual(safeDecisionError(Error('API preflight budget limit; request not sent')),{category:'budget_limit'});
 assert.deepEqual(safeDecisionError(Error(secret)),{category:'unclassified'});
 assert.deepEqual(safeDecisionError(Error('Invalid parameter selection answer')),{category:'invalid_selector_response'});
});
