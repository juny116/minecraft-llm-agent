import test from 'node:test';import assert from 'node:assert/strict';import {setTimeout as delay} from 'node:timers/promises';
import {Runtime} from '../src/runtime.js';import {MockWorld} from '../src/mock.js';import {MockBrain,ApiBrain,Budget,JEV_INPUT_WARN_TOKENS} from '../src/providers.js';import {config} from '../src/config.js';
import {GoalBook} from '../src/goals.js';import {RecoveryMemory} from '../src/recovery.js';import {SocialMemory} from '../src/social.js';
import {reviewFacts,deathFacts,ITEM_DESPAWN_MS,STARTUP_ORIENTATION} from '../src/goal-review.js';
import {selectorContext} from '../src/selector-context.js';
import type {Brain} from '../src/types.js';import type {SupervisorInput} from '../src/supervision.js';
const flush=()=>delay(0),opts={planMs:45000,actionMs:10000,minConfidence:.55,selectorMs:0,longPlanMs:180000};
const active=(goals:GoalBook,id:string,description:string)=>{const r=goals.review(new MockWorld().snapshot(),null);goals.apply(r,[{id,description,reason:'Observed support',status:'active',successCriteria:'Done when observed',evidenceIds:[r.observationId]}],id);};

test('review keeps the last intention visible as provisional and records why',()=>{
 const goals=new GoalBook();assert.equal(goals.reviewState.trigger,'startup');
 active(goals,'wood','Gather oak logs');assert.equal(goals.snapshot().activeGoal?.id,'wood');
 goals.requireReview('death','Died');const snap=goals.snapshot();
 assert.equal(snap.activeGoal,null);assert.equal(snap.provisionalGoal?.id,'wood');assert.equal(snap.goals[0].status,'active','not paused');assert.equal(snap.reviewState?.trigger,'death');
 const r=goals.review(new MockWorld().snapshot(),null);assert.equal(r.reviewState?.trigger,'death');
 assert.throws(()=>goals.apply(r,[],'wood'),/unreviewed restored goal/,'provisional goal still needs explicit reaffirmation');
});

test('activating another goal records the previous one as interrupted instead of a managed list',()=>{
 const goals=new GoalBook();active(goals,'wood','Gather oak logs');
 const r=goals.review(new MockWorld().snapshot(),null);
 goals.apply(r,[{id:'help_bob',description:'Help Bob build a wall',reason:'Accepted request',status:'active',successCriteria:'Wall exists',evidenceIds:[r.observationId]}],'help_bob');
 const wood=goals.snapshot().goals.find(g=>g.id==='wood')!;assert.equal(wood.status,'paused');assert.match(wood.pauseReason!,/Interrupted: review activated help_bob/);
 assert.equal(goals.snapshot().activeGoal?.id,'help_bob');
});

test('death facts state elapsed time, despawn window, distance and lost items without recommending recovery',()=>{
 const recovery=new RecoveryMemory(),w=new MockWorld(),s=w.snapshot();
 s.inventory=[{name:'iron_pickaxe',count:1,slot:36} as any,{name:'bread',count:3,slot:37} as any];s.position={x:10,y:64,z:0};
 const d=recovery.death(s);const respawned=w.snapshot();respawned.inventory=[];respawned.position={x:0,y:64,z:0};recovery.respawn(respawned);
 const facts=deathFacts(recovery,respawned,d.at+60000)!;
 assert.equal(facts.elapsedMs,60000);assert.equal(facts.itemDespawn.maxRemainingMs,ITEM_DESPAWN_MS-60000);assert.match(facts.itemDespawn.rule,/uncertain/);
 assert.deepEqual(facts.lostItems,{iron_pickaxe:1,bread:3});assert.equal(facts.deathSite.distanceFromCurrent,10);assert.equal(facts.observedAtDeath.cause,'unconfirmed');
 const goals=new GoalBook();active(goals,'mine_iron','Mine iron ore');goals.requireReview('respawn_after_death','Respawned');
 const view=reviewFacts(goals,recovery,respawned,d.at+60000)!;
 assert.equal(view.provisionalGoal.description,'Mine iron ore');assert.ok(view.death);assert.ok(view.toDecide.some(x=>/recover dropped items/.test(x)));
 assert.equal(JSON.stringify(view).match(/should|recommend/i),null);
});

test('runtime keeps the goal through death, invalidates the task and tells JEV why the goal is under review',async()=>{
 const inputs:SupervisorInput[]=[],goals=new GoalBook(),w=new MockWorld();let reviews=0;
 const b:Brain={plan:()=>new Promise(()=>{}),choose:new MockBrain().choose,supervise:async(_s,i)=>{inputs.push(structuredClone(i));return {choice:'unresolved',reason:'test',confidence:.9,review:'none',routes:{}};},
  reviewGoals:async(_s,c)=>{reviews++;if(reviews>1)return new Promise(()=>{});return {goalUpdates:[{id:'mine_iron',description:'Mine iron ore',reason:'Iron observed',status:'active',successCriteria:'Iron in inventory',evidenceIds:[c.goalReview!.observationId]}],activeGoalId:'mine_iron'};}};
 const r=new Runtime(w,b,{...opts,goals},()=>{});
 await r.tick();await flush();assert.equal(inputs[0].goal,STARTUP_ORIENTATION);assert.equal(inputs[0].goalReview?.trigger,'startup');
 await r.tick();await flush();assert.equal(r.planning.longTermGoal,'Mine iron ore');
 w.state.health=0;await r.tick();await flush();w.state.health=20;await r.tick();await flush();await r.tick();await flush();
 const last=inputs.at(-1)!;
 assert.equal(last.goal,'Mine iron ore','goal stays visible');assert.equal(last.goalReview?.trigger,'respawn_after_death');assert.equal(last.goalReview?.provisionalGoal.description,'Mine iron ore');
 assert.ok(last.goalReview?.death,'death facts reach JEV');assert.equal(r.planning.mediumTerm.steps.length,0,'task invalidated');
 assert.equal((selectorContext(w.snapshot(),last,{}) as any).goalReview.trigger,'respawn_after_death');
 r.close();
});

test('an addressed request is decided by the goal layer before dialogue replies, and replies must follow it',async()=>{
 const social=new SocialMemory('Alice'),w=new MockWorld(),goals=new GoalBook();
 social.ingest([{id:'req-1',speaker:'Bob',text:'Alice, 같이 집 짓자',at:Date.now()}]);
 let finish!:(v:any)=>void,longContext:any;const spoken:any[]=[];let reply:any={to:'Bob',kind:'accept',text:'좋아, 같이 짓자',replyTo:'req-1'};
 const b:Brain={plan:()=>new Promise(()=>{}),choose:new MockBrain().choose,supervise:async()=>({choice:'unresolved',reason:'test',confidence:.9,review:'none',routes:{}}),
  reviewGoals:async(_s,c)=>{longContext=c;return new Promise(r=>finish=r);},
  communicate:async(_s,_p,_sig,e)=>{spoken.push(structuredClone(e));return reply;}};
 const r=new Runtime(w,b,{...opts,goals,social},()=>{});
 await r.tick();await flush();
 assert.deepEqual(longContext.goalReview.messagesToDecide.map((m:any)=>m.id),['req-1']);assert.equal(spoken.length,0,'dialogue waits for the goal layer');
 finish({goalUpdates:[{id:'gather',description:'Gather wood',reason:'Own plan',status:'active',successCriteria:'Logs',evidenceIds:[longContext.goalReview.observationId]}],activeGoalId:'gather',messageDecisions:[{messageId:'req-1',decision:'defer',reason:'Finishing wood first'}]});await flush();
 await delay(1600);await r.tick();await flush();
 assert.deepEqual(spoken[0].goalDecisions,[{messageId:'req-1',decision:'defer',reason:'Finishing wood first'}]);
 assert.equal(social.addressed().length,1,'accept contradicting defer is discarded, message stays pending');
 reply={to:'Bob',kind:'decline',text:'지금은 나무부터 모을게, 끝나고 다시 얘기하자',replyTo:'req-1'};
 await delay(1600);await r.tick();await flush();assert.equal(social.addressed().length,0,'reply following the decision is sent');
 r.close();
});

test('long review validation requires a decision for every supplied message',async()=>{
 const answers=[{goalUpdates:[],activeGoalId:'g'},{goalUpdates:[],activeGoalId:'g',messageDecisions:[{messageId:'m1',decision:'defer',reason:'Later'}]}];let i=0;
 const b=new ApiBrain({...config(),mode:'llm',llmKey:'test'},new Budget(4,1),(async()=>Response.json({choices:[{message:{content:JSON.stringify(answers[Math.min(i++,1)])}}],usage:{prompt_tokens:10,completion_tokens:10}})) as typeof fetch);
 const ctx:any={userRequest:null,goalReview:{revision:0,needsReview:false,observationId:'o',goals:[],evidence:[],messagesToDecide:[{id:'m1',speaker:'Bob',text:'help',at:1}]},longTermGoal:null,mediumTerm:{summary:'',steps:[],activeStep:0},replanReasons:[],recentActions:[],olderSummary:{count:0,byAction:{},inventoryNet:{},healthNet:0},failureStreak:0};
 const out:any=await b.reviewGoals(new MockWorld().snapshot(),ctx,AbortSignal.timeout(5000));
 assert.equal(i,2);assert.equal(out.messageDecisions[0].decision,'defer');
});

test('changed experience guidance requests a goal review',async()=>{
 const goals=new GoalBook();let applied=false;const guide={id:'g1',version:1,status:'active',text:'x',scope:{action:'mine'}};
 const memory:any={pending:()=>4,needsMaintenance:()=>false,reflection:()=>({through:1}),retrieve:()=>applied?[guide]:[],apply:()=>{applied=true;},add:()=>{}};
 const events:any[]=[];const b:Brain={plan:()=>new Promise(()=>{}),choose:new MockBrain().choose,reviewGoals:()=>new Promise(()=>{}),reflect:async()=>({}) as any,reflectionModel:'m'} as any;
 const r=new Runtime(new MockWorld(),b,{...opts,goals,memory},(e,f)=>events.push({e,...f}));
 await r.reflectMemory(true);
 assert.equal(events.find(e=>e.e==='memory_reflected')?.guidanceChanged,true);assert.ok(r.planning.replanReasons.includes('experience_guidance_changed'));
 r.close();
});

test('JEV input near its context limit is reported, not truncated',async()=>{
 const diags:any[]=[];const budget=new Budget(4,1);budget.onDiagnostic=(d:any)=>diags.push(d);
 const b=new ApiBrain({...config(),mode:'jev',jevKey:'test'} as any,budget,(async()=>Response.json({answers:{},usage:{input_tokens:JEV_INPUT_WARN_TOKENS+1,output_tokens:1}})) as typeof fetch);
 await (b as any).post('http://jev.test',(config() as any).jevKey||'test',{model:(b as any).c.jevModel},AbortSignal.timeout(5000),[0,0]).catch(()=>{});
 assert.ok(diags.some(d=>d.phase==='context_size_warning'&&d.inputTokens===JEV_INPUT_WARN_TOKENS+1));
});

test('a message arriving after the startup review triggers a prompt goal review, not the periodic one',async()=>{
 const social=new SocialMemory('Alice'),w=new MockWorld(),goals=new GoalBook();const contexts:any[]=[];
 const b:Brain={plan:()=>new Promise(()=>{}),choose:new MockBrain().choose,supervise:async()=>({choice:'unresolved',reason:'test',confidence:.9,review:'none',routes:{}}),
  reviewGoals:async(_s,c)=>{contexts.push(c);return {goalUpdates:[{id:'explore',description:'Explore',reason:'Observed',status:'active',successCriteria:'Seen',evidenceIds:[c.goalReview!.observationId]}],activeGoalId:'explore',...(c.goalReview?.messagesToDecide?{messageDecisions:c.goalReview.messagesToDecide.map(m=>({messageId:m.id,decision:'accept' as const,reason:'ok'}))}:{})};},
  communicate:async()=>null};
 const r=new Runtime(w,b,{...opts,goals,social},()=>{});
 const t=Date.now();await r.tick(t);await flush();assert.equal(contexts.length,1);assert.equal(contexts[0].goalReview.messagesToDecide,undefined);
 social.ingest([{id:'req-2',speaker:'Bob',text:'Alice, 침대 만들어 줄래?',at:Date.now()}]);
 await r.tick(t+2000);await flush();
 assert.equal(contexts.length,2,'message forces a review within the periodic interval');assert.deepEqual(contexts[1].goalReview.messagesToDecide.map((m:any)=>m.id),['req-2']);
 r.close();
});

test('delivery facts keep own drop, recipient words and ground observation separate',async()=>{
 const {DeliveryLog}=await import('../src/deliveries.js');
 const log=new DeliveryLog();log.record(7,'Haneul','white_bed',1,{x:0,y:64,z:0},1000);
 log.observe({position:{x:1,y:64,z:0},visibleItems:[]},[{id:'m0',speaker:'Haneul',text:'before',at:500},{id:'m1',speaker:'Haneul',text:'받았어',at:1500},{id:'m2',speaker:'Bob',text:'other',at:1600}],2000);
 const d=log.view(2000)!.deliveries[0];
 assert.deepEqual(d.recipientMessages.map(m=>m.id),['m1']);assert.deepEqual(d.groundCheck,{at:2000,seenNearDropPoint:false});
 assert.match(log.view(2000)!.meaning,/not seen does not mean received/);
 log.observe({position:{x:40,y:64,z:0},visibleItems:[]},[],3000);assert.equal(log.view(3000)!.deliveries[0].groundCheck!.at,2000,'far away: no new ground claim');
});

test('chat stays out of JEV input; the goal layer routes and decides messages',async()=>{
 const social=new SocialMemory('Alice'),w=new MockWorld(),goals=new GoalBook();const inputs:SupervisorInput[]=[];
 social.ingest([{id:'req-9',speaker:'Bob',text:'Alice, 흰색 침대 만들어 줘',at:Date.now()}]);
 const b:Brain={plan:()=>new Promise(()=>{}),choose:new MockBrain().choose,supervise:async(_s,i)=>{inputs.push(structuredClone(i));return {choice:'unresolved',reason:'test',confidence:.9,review:'none',routes:{}};},reviewGoals:()=>new Promise(()=>{}),communicate:async()=>null};
 const r=new Runtime(w,b,{...opts,goals,social},()=>{});await r.tick();await flush();
 assert.deepEqual(inputs.at(-1)!.requestDecisions,[{messageId:'req-9',decision:'pending_goal_decision'}]);
 const view:any=selectorContext({...w.snapshot(),social:social.context()},inputs.at(-1)!,{});
 assert.equal(view.dialogue,undefined,'JEV does not see chat');assert.deepEqual(inputs.at(-1)!.inbox,[],'JEV does not route messages');
 r.close();
});

test('decisions for messages that were not supplied are dropped instead of failing the review',async()=>{
 const {validateMessageDecisions}=await import('../src/providers.js');
 const raw:any={messageDecisions:[{messageId:'own-greeting',decision:'no_request',reason:'my own greeting'},{messageId:'m1',decision:'accept',reason:'ok'}]};
 validateMessageDecisions(raw,[{id:'m1'}]);assert.deepEqual(raw.messageDecisions,[{messageId:'m1',decision:'accept',reason:'ok'}]);assert.equal(raw.ignoredMessageDecisions,1);
 assert.throws(()=>validateMessageDecisions({messageDecisions:[{messageId:'other',decision:'accept',reason:'x'}]},[{id:'m1'}]),/missing a decision/);
});

test('accepting a request requires the active goal to be created or updated in the same review',async()=>{
 const answers=[{goalUpdates:[],activeGoalId:'explore',messageDecisions:[{messageId:'m1',decision:'accept',reason:'ok'}]},{goalUpdates:[{id:'bed_for_bob',description:'Make a bed for Bob',reason:'Accepted request',evidenceIds:['o'],status:'active',successCriteria:'Bob has a bed'}],activeGoalId:'bed_for_bob',messageDecisions:[{messageId:'m1',decision:'accept',reason:'ok'}]}];let i=0;
 const b=new ApiBrain({...config(),mode:'llm',llmKey:'test'},new Budget(4,1),(async()=>Response.json({choices:[{message:{content:JSON.stringify(answers[Math.min(i++,1)])}}],usage:{prompt_tokens:10,completion_tokens:10}})) as typeof fetch);
 const ctx:any={userRequest:null,goalReview:{revision:0,needsReview:false,observationId:'o',goals:[],evidence:[],messagesToDecide:[{id:'m1',speaker:'Bob',text:'bed please',at:1}]},longTermGoal:null,mediumTerm:{summary:'',steps:[],activeStep:0},replanReasons:[],recentActions:[],olderSummary:{count:0,byAction:{},inventoryNet:{},healthNet:0},failureStreak:0};
 const out:any=await b.reviewGoals(new MockWorld().snapshot(),ctx,AbortSignal.timeout(5000));
 assert.equal(i,2,'acceptance without a goal change is repaired');assert.equal(out.activeGoalId,'bed_for_bob');
});

test('dialogue receives recent placements with the observed position and facing',async()=>{
 const social=new SocialMemory('Alice'),w=new MockWorld();social.ingest([{id:'q1',speaker:'Bob',text:'Alice, 침대 어디 있어?',at:Date.now()-60000}]);social.route('q1','respond');
 let seen:any;const b:Brain={plan:()=>new Promise(()=>{}),choose:new MockBrain().choose,supervise:async()=>({choice:'unresolved',reason:'test',confidence:.9,review:'none',routes:{}}),reviewGoals:()=>new Promise(()=>{}),communicate:async(_s,_p,_sig,e)=>{seen=e;return null;}};
 const r=new Runtime(w,b,{...opts,goals:new GoalBook(),social},()=>{});
 const receipt={kind:'placement',item:'white_bed',position:{x:3,y:-60,z:64},facing:'north',confirmed:false,observedPlacement:{position:{x:3,y:-60,z:64},facing:'east',head:{x:4,y:-60,z:64}}};
 (r as any).journal.add({decision:{action:'place_block',confidence:1},outcome:'failed',result:JSON.stringify(receipt),endedAt:Date.now(),startedAt:Date.now(),before:{},after:{},changes:{}} as any);
 await r.tick();await flush();
 assert.deepEqual(seen?.placements?.[0]?.observedPlacement,receipt.observedPlacement);assert.equal(seen.placements[0].requested.facing,'north');
 r.close();
});

test('the goal review states the bot\'s own name with the messages to decide',async()=>{
 const social=new SocialMemory('Bob'),w=new MockWorld(),goals=new GoalBook();let ctx:any;
 social.ingest([{id:'r1',speaker:'Haneul',text:'Bob, 흰색 침대 하나 만들어서 나한테 줄 수 있어?',at:Date.now()}]);
 const b:Brain={plan:()=>new Promise(()=>{}),choose:new MockBrain().choose,supervise:async()=>({choice:'unresolved',reason:'test',confidence:.9,review:'none',routes:{}}),reviewGoals:async(_s,c)=>{ctx=c;return new Promise(()=>{});},communicate:async()=>null};
 const r=new Runtime(w,b,{...opts,goals,social},()=>{});await r.tick();await flush();
 assert.equal(ctx.goalReview.self,'Bob');assert.equal(ctx.goalReview.messagesToDecide[0].speaker,'Haneul');r.close();
});

test('the goal layer always receives who the bot is in gameContext',async()=>{
 let input:any;const b=new ApiBrain({...config(),mode:'llm',llmKey:'test'},new Budget(3,1),(async(_u:any,init:any)=>{input=JSON.parse(JSON.parse(init.body).messages[1].content);return Response.json({choices:[{message:{content:JSON.stringify({goalUpdates:[],activeGoalId:'g'})}}],usage:{prompt_tokens:1,completion_tokens:1}});}) as typeof fetch);
 const s={...new MockWorld().snapshot(),selfName:'Bob'};
 await b.reviewGoals(s,{userRequest:null,longTermGoal:null,mediumTerm:{summary:'',steps:[],activeStep:0},replanReasons:[],recentActions:[],olderSummary:{count:0,byAction:{},inventoryNet:{},healthNet:0},failureStreak:0} as any,AbortSignal.timeout(5000));
 assert.equal(input.gameContext.self.name,'Bob');assert.match(input.gameContext.description,/Minecraft survival world/);
});

test('a goal change shows a pending task instead of the goal sentence and asks the task layer at once',async()=>{
 const w=new MockWorld(),goals=new GoalBook();let reviews=0,plans=0;const inputs:SupervisorInput[]=[];
 const b:Brain={plan:async(_s,_h,_sig,_u,c)=>{plans++;return new Promise(()=>{});},choose:new MockBrain().choose,supervise:async(_s,i)=>{inputs.push(structuredClone(i));return {choice:'unresolved',reason:'test',confidence:.9,review:'none',routes:{}};},
  reviewGoals:async(_s,c)=>{reviews++;const id=reviews===1?'explore':'bed_for_haneul';return {goalUpdates:[{id,description:reviews===1?'Explore nearby':'Craft a white bed for Haneul',reason:'r',status:'active',successCriteria:'s',evidenceIds:[c.goalReview!.observationId]}],activeGoalId:id};}};
 const r=new Runtime(w,b,{...opts,goals},()=>{});const t=Date.now();
 await r.tick(t);await flush();
 assert.match(r.plan.goal,/^No task plan yet/);assert.equal(inputs.length>0,true);
 const before=plans;(r as any).longRequested=true;(r as any).planPending=false;(r as any).lastPlan=t+31000;await r.tick(t+31000);await flush();await r.tick(t+31500);await flush();
 assert.match(r.plan.goal,/^No task plan yet/,'the goal sentence is not shown as a plan');assert.equal(r.planning.longTermGoal,'Craft a white bed for Haneul');
 assert.ok(plans>before,'task layer asked within the usual 5 s throttle');
 r.close();
});
