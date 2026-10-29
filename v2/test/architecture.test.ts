import {executionOptions} from '../src/supervision.js';
import test from 'node:test';import assert from 'node:assert/strict';import {setTimeout as delay} from 'node:timers/promises';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Runtime} from '../src/runtime.js';import {MockWorld} from '../src/mock.js';import {MockBrain,ApiBrain,Budget} from '../src/providers.js';import {config} from '../src/config.js';
import {SocialMemory} from '../src/social.js';import {RecoveryMemory} from '../src/recovery.js';import {GoalBook} from '../src/goals.js';import {pilotStopReason} from '../src/pilot.js';import {candidates,actions,type Brain,type Plan} from '../src/types.js';
import type {SupervisorInput,Supervision} from '../src/supervision.js';
const flush=()=>delay(0),opts={planMs:45000,actionMs:10000,minConfidence:.55,selectorMs:0,longPlanMs:180000};
const decision=(choice:string,routes:Supervision['routes']={}):Supervision=>({choice,confidence:.9,review:'none',routes});
function brain(supervise:NonNullable<Brain['supervise']>):Brain{return {plan:async()=>({goal:'Gather observed resources',preferred:'mine',mine:{position:{x:1,y:64,z:0},expected:'oak_log'},steps:[]}),choose:new MockBrain().choose,supervise,reviewGoals:async(_s,c)=>({goalUpdates:[{id:'self-goal',description:'Gather observed resources',reason:'Current observations support it',status:'active',successCriteria:'Useful resources acquired',evidenceIds:[c.goalReview!.observationId]}],activeGoalId:'self-goal',messageDecisions:(c.goalReview?.messagesToDecide??[]).map(m=>({messageId:m.id,decision:m.text.startsWith('Carol')?'not_for_me' as const:'no_request' as const,reason:'test routing'}))})};}
class SlowWorld extends MockWorld{starts=0;running=0;maxRunning=0;aborts=0;override async execute(_a:any,signal:AbortSignal){this.starts++;this.running++;this.maxRunning=Math.max(this.maxRunning,this.running);try{await delay(10000,undefined,{signal});return 'done';}finally{this.running--;if(signal.aborted)this.aborts++;}}}

test('continuous selector keeps same execution while long and medium reasoning are pending',async()=>{
 const w=new SlowWorld();let calls=0;const b=brain(async(_s,i)=>{calls++;return decision(i.execution?'continue':i.options.find(o=>o.action==='mine')!.id);});
 b.plan=()=>new Promise(()=>{});b.reviewGoals=()=>new Promise(()=>{});const r=new Runtime(w,b,opts,()=>{});
 primeExecution(r);await r.tick();await r.tick();await r.tick();assert.equal(calls,3);assert.equal(w.starts,1);assert.equal(w.aborts,0);r.close();await flush();assert.equal(w.running,0);
});
test('switch aborts and joins old executor before starting another; action count unchanged',async()=>{
 const w=new SlowWorld();let call=0;const r=new Runtime(w,brain(async(_s,i)=>decision(++call===1?i.options.find(o=>o.action==='mine')!.id:i.options.find(o=>o.action==='look')!.id)),opts,()=>{});
 primeExecution(r);await r.tick();await r.tick();await r.tick();await r.tick();assert.equal(w.starts,2);assert.equal(w.aborts,1);assert.equal(w.maxRunning,1);assert.equal(actions.length,18);r.close();await flush();
});
test('pending supervisor is never duplicated and stale threat response cannot switch',async()=>{
 const w=new SlowWorld();let finish!:(d:Supervision)=>void,calls=0;const b=brain(async()=>{calls++;return await new Promise<Supervision>(resolve=>finish=resolve);});const r=new Runtime(w,b,opts,()=>{});
 const p=r.tick();await r.tick();assert.equal(calls,1);w.state.health=18;finish(decision('wait'));await p;assert.equal(w.starts,0);r.close();
});
test('long and medium planners have independent periodic schedules',async()=>{
 let longs=0,mediums=0;const b=brain(async()=>decision('wait')),review=b.reviewGoals!;b.reviewGoals=async(...a)=>{longs++;return review(...a);};b.plan=async()=>{mediums++;return {goal:'Review nearby resources',preferred:'idle',steps:[]};};const r=new Runtime(new MockWorld(),b,opts,()=>{});const t=Date.now();
 await r.tick(t);await flush();await r.tick(t+1000);await flush();await r.tick(t+50000);await flush();assert.equal(longs,1);assert.equal(mediums,2);await r.tick(t+181000);await flush();assert.equal(longs,2);r.close();
});
test('alias memories require cited heard text, survive reconnect, and preserve conflicting hypotheses',()=>{
 const dir=mkdtempSync(join(tmpdir(),'alias-'));try{const path=join(dir,'social.json'),s=new SocialMemory('Alice',path);s.ingest([{id:'1',speaker:'Bob',text:'앨리스, 앞으로 너를 리스라고 부를게',at:1},{id:'2',speaker:'Carol',text:'Bob을 리스라고 부를게',at:2},{id:'3',speaker:'Bob',text:'pixel, 내 질문 들었어?',at:3}]);s.rememberAliases([{alias:'리스',subject:'Alice',evidenceId:'1',certainty:'confirmed',reason:'Nickname explicitly introduced by this speaker'},{alias:'리스',subject:'Bob',evidenceId:'2',certainty:'tentative',reason:'Another speaker uses the same alias'}]);assert.throws(()=>s.rememberAliases([{alias:'마법사',subject:'Alice',evidenceId:'1',certainty:'confirmed',reason:'invented'}]),/alias evidence/);const restored=new SocialMemory('Alice',path);assert.equal(restored.context().aliases.length,2);assert.deepEqual(restored.pendingRouting().map(x=>x.id),['1','2','3']);}finally{rmSync(dir,{recursive:true});}
});
test('routed messages are queued while a response is pending; other addressees do not trigger dialogue',async()=>{
 const social=new SocialMemory('Alice'),w=new MockWorld();w.state.chatEvents=[{id:'other',speaker:'Bob',text:'Carol, 도와줘',at:1},{id:'me',speaker:'Bob',text:'리스야, 들려?',at:2}];let count=0,reply!:(v:any)=>void;
 const b=brain(async(_s,i)=>decision('wait',Object.fromEntries(i.inbox.map(m=>[m.id,m.id==='other'?'other':'respond']))));b.communicate=()=>{count++;return new Promise(resolve=>reply=resolve);};const r=new Runtime(w,b,{...opts,social},()=>{});
 await r.tick();await r.tick();assert.equal(count,1);w.state.chatEvents!.push({id:'later',speaker:'Bob',text:'아까 말에 덧붙이면',at:3});await r.tick();assert.equal(count,1);
 reply({to:'Bob',kind:'chat',text:'응, 무슨 일이야?',replyTo:'me'});await flush();assert.deepEqual(social.addressed().map(m=>m.id),['later']);assert.equal(social.pendingRouting().length,0);r.close();
});
test('death and respawn cancel stale thinking, preserve evidence, and permit recovery abandonment',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'death-'));try{const recovery=new RecoveryMemory(join(dir,'recovery.json')),w=new SlowWorld();w.state.dimension='overworld';w.state.inventory=[{name:'iron_sword',count:1,slot:36}];w.state.environment={inWater:true,inLava:false,onGround:false};let finish!:(p:any)=>void,calls=0;
 const b=brain(async(_s,i)=>decision(i.execution?'continue':i.options.find(o=>o.action==='mine')!.id));const review=b.reviewGoals!;b.reviewGoals=async(s,c,signal)=>{calls++;if(calls===1)return await new Promise(resolve=>finish=resolve);return {...await review(s,c,signal),recoveryDecision:{deathId:s.recovery!.deaths.at(-1)!.id,strategy:'abandon',reason:'Current gear and remembered underwater risk make rebuilding preferable'}};};const r=new Runtime(w,b,{...opts,recovery},()=>{});
 primeExecution(r);await r.tick();w.state.health=0;w.state.ready=false;await r.tick();await flush();assert.equal(w.aborts,1);w.state.health=20;w.state.ready=true;w.state.inventory=[];w.state.position={x:100,y:70,z:100};await r.tick();finish({goalUpdates:[],activeGoalId:null});await flush();await r.tick(Date.now()+1000);await flush();const d=recovery.context().deaths[0];assert.equal(d.environment?.inWater,true);assert.equal(d.cause,'unconfirmed');assert.equal(d.decision?.strategy,'abandon');assert.equal(d.respawn?.inventory?.length,0);assert.equal(new RecoveryMemory(join(dir,'recovery.json')).context().deaths.length,1);r.close();await flush();}finally{rmSync(dir,{recursive:true});}
});
test('death destination is remembered across respawn but never crosses dimensions or supplies invisible drops',()=>{
 const rec=new RecoveryMemory(),w=new MockWorld();w.state.dimension='overworld';rec.death(w.snapshot());w.state.position={x:100,y:64,z:100};w.state.recovery=rec.context();const plan:Plan={goal:'Consider recovery',preferred:'move',destination:{x:0,y:64,z:0}};assert.ok(candidates(w.state,plan).includes('move'));w.state.dimension='the_nether';assert.ok(!candidates(w.state,plan).includes('move'));assert.equal(w.state.visibleItems,undefined);
});
test('pilot permits bounded respawn, but still enforces time, budget and repeated-death limits',()=>{
 const s={elapsedMs:10,maxMs:300000,states:[{ready:false,health:0,lifecycle:{phase:'dead',deathCount:1}}],budgetExhausted:false,noProgressMs:100,consecutiveFailures:0,allowRespawn:true};assert.equal(pilotStopReason(s),null);assert.equal(pilotStopReason({...s,respawnWaitMs:31000}),'respawn_timeout');assert.equal(pilotStopReason({...s,budgetExhausted:true}),'budget_or_usage_limit');assert.equal(pilotStopReason({...s,states:[{...s.states[0],lifecycle:{phase:'dead',deathCount:3}}]}),'repeated_death');
});
test('supervisor API sends semantic alias routing in the same request as execution control',async()=>{
 const social=new SocialMemory('Alice');social.ingest([{id:'m',speaker:'Bob',text:'엘리스야, 잠깐 도와줘',at:1}]);const w=new MockWorld();w.state.social=social.context();let calls=0;
 const b=new ApiBrain({...config(),targetPolicy:'planner',mode:'jev',jevKey:'test',llmKey:'test'},new Budget(2,1),(async(_url:any,init:any)=>{calls++;const req=JSON.parse(init.body);assert.ok(req.questions.message_0);assert.match(req.questions.message_0.instructions,/NOT exact-name/);assert.equal(req.state.inbox[0].text,'엘리스야, 잠깐 도와줘');return Response.json({answers:{continuity:{type:'choice',choice:'maintain',confidence:.8},action:{type:'choice',choice:'continue',confidence:.8},review:{type:'choice',choice:'none',confidence:1},message_0:{type:'choice',choice:'clarify',confidence:.5}},usage:{input_tokens:100,output_tokens:0}});}) as typeof fetch);
 const input:SupervisorInput={options:[],execution:{id:1,action:'mine',plan:{goal:'wood',preferred:'mine'},elapsedMs:2000},inbox:social.pendingRouting(),goal:'wood'};const d=await b.supervise(w.snapshot(),input,new AbortController().signal);assert.equal(d.routes.m,'clarify');assert.equal(d.choice,'continue');assert.equal(calls,1);
});

test('fast death/respawn between selector ticks still invalidates old requests',async()=>{
 const w=new MockWorld();w.state.lifecycle={generation:1,deathCount:0,phase:'alive'};let finish!:(v:Supervision)=>void;
 const b=brain(()=>new Promise(resolve=>finish=resolve)),r=new Runtime(w,b,opts,()=>{});const pending=r.tick();
 const death=new RecoveryMemory().death(w.snapshot());w.state.lifecycle={generation:2,deathCount:1,phase:'alive',lastDeath:death};w.state.inventory=[];
 await r.tick();finish(decision('wait'));await pending;assert.equal(r.planning.recentActions.length,0);assert.equal(r.planning.longTermGoal,null);r.close();
});
test('alias metadata alone never bypasses semantic routing or marks a message answered',()=>{
 const s=new SocialMemory('PixelWanderer');s.ingest([{id:'nick',speaker:'Alice',text:'PixelWanderer, pixel이라고 부를게',at:1},{id:'quote',speaker:'Bob',text:'Alice가 pixel이라고 말했다고 Carol에게 설명했어',at:2}]);s.rememberAliases([{alias:'pixel',subject:'PixelWanderer',evidenceId:'nick',certainty:'confirmed',reason:'Speaker introduced abbreviation'}]);assert.equal(s.addressed().length,0);assert.equal(s.pendingRouting().length,2);s.route('quote','other');assert.equal(s.addressed().length,0);
});
test('long review and medium planning API inputs are separate contracts',async()=>{
 const w=new MockWorld(),g=new GoalBook();const context:any={goalState:g.snapshot(),goalReview:g.review(w.snapshot(),null),longTermGoal:null,mediumTerm:{summary:'review',steps:[],activeStep:0},recentActions:[],olderSummary:{count:0,byAction:{},inventoryNet:{},healthNet:0},replanReasons:[],failureStreak:0};let scope='long';
 const b=new ApiBrain({...config(),targetPolicy:'planner',mode:'jev',llmKey:'test'},new Budget(3,1),(async(_u:any,init:any)=>{const request=JSON.parse(init.body),data=JSON.parse(request.messages[1].content);if(scope==='long'){assert.match(request.messages[0].content,/NOT immediate actions/);assert.ok(data.goalReview);return Response.json({choices:[{message:{content:JSON.stringify({goalUpdates:[],activeGoalId:'existing_goal',userRequestStatus:{status:'in_progress',reason:'Test fixture'}})}}],usage:{prompt_tokens:10,completion_tokens:10}});}assert.match(data.planningScope,/medium_only/);assert.equal(data.planning.goalReview,undefined);return Response.json({choices:[{message:{content:JSON.stringify({goal:'Observe',preferred:'idle',steps:[]})}}],usage:{prompt_tokens:10,completion_tokens:10}});}) as typeof fetch);
 await b.reviewGoals(w.snapshot(),context,new AbortController().signal);scope='medium';delete context.goalReview;await b.plan(w.snapshot(),[],new AbortController().signal,null,context);
});

test('connecting with unknown health does not fabricate a death',async()=>{
 const w=new MockWorld(),recovery=new RecoveryMemory();w.state.ready=false;w.state.health=0;w.state.lifecycle={generation:0,deathCount:0,phase:'connecting'};
 const r=new Runtime(w,brain(async()=>decision('wait')),{...opts,recovery},()=>{});await r.tick();assert.equal(recovery.context().deaths.length,0);r.close();
});
test('pending conversation reply survives unrelated movement but cannot acknowledge a new life',async()=>{
 const w=new MockWorld(),social=new SocialMemory('Alice');w.state.chatEvents=[{id:'q',speaker:'Bob',text:'앨리스, 지금 대답 가능해?',at:1}];let finish!:(s:any)=>void;
 const b=brain(async(_s,i)=>decision('wait',Object.fromEntries(i.inbox.map(m=>[m.id,'respond']))));b.communicate=()=>new Promise(resolve=>finish=resolve);
 const r=new Runtime(w,b,{...opts,social},()=>{});await r.tick();await r.tick();w.state.position.x+=3;finish({to:'Bob',kind:'chat',text:'응, 이야기해줘.',replyTo:'q'});await flush();assert.equal(social.addressed().length,0);assert.ok(w.state.messages.some(m=>m.includes('이야기해줘')));r.close();
});

test('wounded unthreatened bot retains an eating candidate instead of being forced idle',()=>{
 const s=new MockWorld().snapshot();s.health=5;s.food=12;s.canEat=true;assert.deepEqual(candidates(s),['idle','eat']);s.enemies=[{id:1,kind:'zombie',position:{x:1,y:64,z:0},distance:1}];assert.deepEqual(candidates(s),['idle','flee']);
});

test('invalid dialogue retains inbox and backs off while JEV continues',async()=>{
 const social=new SocialMemory('Alice'),w=new MockWorld();w.state.chatEvents=[{id:'q',speaker:'Bob',text:'도와줄래?',at:1}];let calls=0,selectors=0;
 const b=brain(async(_s,i)=>{selectors++;return decision('wait',Object.fromEntries(i.inbox.map(m=>[m.id,'respond'])));});b.communicate=async()=>{calls++;throw Error('Invalid promise');};
 const r=new Runtime(w,b,{...opts,social},()=>{});const t=Date.now();await r.tick(t);await r.tick(t+1);await flush();await r.tick(t+2000);await flush();assert.equal(calls,1);assert.equal(selectors,3);assert.equal(social.addressed()[0].id,'q');await r.tick(t+11000);await flush();assert.equal(calls,2);r.close();
});
test('medium review without active intention requests a throttled long review',async()=>{
 let reviews=0;const b=brain(async()=>({...decision('wait'),review:'medium'}));b.reviewGoals=async()=>{reviews++;return {goalUpdates:[],activeGoalId:null};};const r=new Runtime(new MockWorld(),b,opts,()=>{}),t=Date.now();await r.tick(t);await flush();await r.tick(t+1000);await flush();assert.equal(reviews,1);await r.tick(t+31000);await flush();assert.equal(reviews,2);r.close();
});

test('death packet with cleared inventory preserves timestamped last-alive possessions',()=>{
 const w=new MockWorld(),r=new RecoveryMemory(),s=w.snapshot();s.inventory=[];s.equipment=[];s.health=0;
 const observed={at:1234,inventory:[{name:'wooden_pickaxe',count:1,slot:36}],equipment:[{slot:'hand',name:'wooden_pickaxe'}]};
 const d=r.death(s,observed);assert.equal(d.inventory![0].name,'wooden_pickaxe');assert.equal(d.possessionsObservedAt,1234);assert.equal(d.possessionsSource,'last_alive_observation');
 const empty=r.death(s,{at:1250,inventory:[],equipment:[]});assert.deepEqual(empty.inventory,[]);assert.match(r.context().warning,/not proof of actual dropped items/);
});

test('wait during mining retains the executor, explicit stop remains available',async()=>{
 const w=new SlowWorld();const r=new Runtime(w,brain(async(_s,i)=>decision(i.execution?'wait':i.options.find(o=>o.action==='mine')!.id)),opts,()=>{});
 primeExecution(r);await r.tick();await r.tick();assert.equal(w.starts,1);assert.equal(w.aborts,0);r.close();await flush();
});

test('binary continuity preserves work even when another option scores well, and permits deliberate stop',async()=>{
 let keep=true;const w=new MockWorld();const b=new ApiBrain({...config(),targetPolicy:'planner',mode:'jev',jevKey:'test'},new Budget(4,1),(async(_u:any,init:any)=>{
 const req=JSON.parse(init.body);assert.ok(req.questions.continuity);return Response.json({answers:{continuity:{type:'choice',choice:keep?'maintain':'interrupt',confidence:.01},action:{type:'choice',choice:'stop',confidence:.9},review:{type:'choice',choice:'none',confidence:1}},usage:{input_tokens:10,output_tokens:1}});
 }) as typeof fetch);
 const input:SupervisorInput={options:[],execution:{id:1,action:'mine',plan:{goal:'Wood',preferred:'mine'},elapsedMs:1000},inbox:[],goal:'Wood'};
 assert.equal((await b.supervise(w.snapshot(),input,new AbortController().signal)).choice,'continue');keep=false;assert.equal((await b.supervise(w.snapshot(),input,new AbortController().signal)).choice,'stop');
});

test('recent heard partner permits proactive dialogue outside current camera view',async()=>{
 const w=new MockWorld(),social=new SocialMemory('Alice'),now=Date.now();w.state.nearbyPlayers=[];w.state.chatEvents=[{id:'recent',speaker:'Bob',text:'주변에서 재료를 찾고 있어.',at:now}];let calls=0;
 const b=brain(async()=>decision('wait'));b.communicate=async()=>{calls++;return null;};const rt=new Runtime(w,b,{...opts,social},()=>{});
 await rt.tick(now);await flush();assert.equal(calls,0,'dialogue waits for goal-layer routing');await rt.tick(now+1);await flush();assert.equal(calls,1);rt.close();
});

test('an online partner out of sight and silent for over five minutes still gets periodic dialogue; nobody online gets none',async()=>{
 for(const online of [['Bob'],[]]){
  const w=new MockWorld(),social=new SocialMemory('Alice'),now=Date.now();w.state.nearbyPlayers=[];w.state.onlinePlayers=online;let calls=0;
  const b=brain(async()=>decision('wait'));b.communicate=async()=>{calls++;return null;};const rt=new Runtime(w,b,{...opts,social},()=>{});
  await rt.tick(now);await flush();assert.equal(calls,online.length?1:0);rt.close();
 }
});

test('transient preference switches do not cancel useful work while danger bypasses confirmation',async()=>{
 const w=new SlowWorld();let n=0;const b=brain(async(_s,i)=>decision(++n===1?i.options.find(o=>o.action==='mine')!.id:n===3?'continue':i.options.find(o=>o.action==='look')!.id));const rt=new Runtime(w,b,opts,()=>{});
 primeExecution(rt);await rt.tick();await rt.tick();await rt.tick();await rt.tick();assert.equal(w.aborts,0);
 w.state.enemies=[{id:9,kind:'zombie',position:{x:1,y:64,z:0},distance:1}];await rt.tick();assert.equal(w.aborts,1);rt.close();await flush();
});

function primeExecution(r:Runtime){const x=r as any;x.lastReady=true;x.lastLifeKey='true';r.plan={goal:'Gather observed wood',preferred:'mine',mine:{position:{x:1,y:64,z:0},expected:'oak_log'}};}

test('unrelated remembered treetops are not automatic movement proposals',()=>{
 const s=new MockWorld().snapshot();s.places=[{name:'oak_log',position:{x:0,y:90,z:4},lastSeen:1}];
 assert.equal(executionOptions(s,{goal:'Observe',preferred:'look'}).filter(o=>o.action==='move').length,0);
 const p={goal:'Approach remembered tree',preferred:'move' as const,destination:s.places[0].position};
 assert.equal(executionOptions(s,p).filter(o=>o.action==='move').length,1);
});

test('hunger permits an urgent switch TO eating, not an urgent switch AWAY from eating',async()=>{
 const w=new SlowWorld();w.state.food=7;w.state.canEat=true;let n=0;
 const b=brain(async(_s,i)=>decision(++n===1?i.options.find(o=>o.action==='mine')!.id:n===2?i.options.find(o=>o.action==='eat')!.id:i.options.find(o=>o.action==='look')!.id));
 const r=new Runtime(w,b,opts,()=>{});primeExecution(r);
 await r.tick();assert.equal(w.aborts,0);await r.tick();assert.equal(w.aborts,1);assert.equal(r.executionStatus.activeAction,'eat');
 await r.tick();assert.equal(w.aborts,1);assert.equal(r.executionStatus.activeAction,'eat');r.close();await flush();
});

test('near-complete mining survives repeated ordinary alternative proposals but danger still interrupts',async()=>{
 const w=new SlowWorld();let n=0;const b=brain(async(_s,i)=>decision(++n===1?i.options.find(o=>o.action==='mine')!.id:i.options.find(o=>o.action==='look')!.id));b.reviewGoals=()=>new Promise(()=>{});b.plan=()=>new Promise(()=>{});
 (w as any).executionProgress=()=>({phase:'digging',phaseElapsedMs:2800,estimatedDigMs:3000,blockBroken:false});
 const r=new Runtime(w,b,opts,()=>{});primeExecution(r);await r.tick();await r.tick();await r.tick();await r.tick();assert.equal(w.aborts,0);
 w.state.health=18;await r.tick();assert.equal(w.aborts,1);r.close();await flush();
});


test('phase-changing interrupt is rejudged; a fresh stop still cancels without local mining lock',async()=>{
 const w=new SlowWorld();let motor:any={phase:'approach',phaseElapsedMs:0,blockBroken:false};
 (w as any).executionProgress=()=>motor;
 let finish!:(d:Supervision)=>void,calls=0;const events:any[]=[];
 const b=brain(async()=>{calls++;if(calls===1)return {...decision('selected'),selected:{id:'m',action:'mine',plan:{goal:'Get wood',preferred:'mine',mine:{position:{x:1,y:64,z:0},expected:'oak_log'}}}};if(calls===2)return new Promise(resolve=>finish=resolve);return decision('stop');});
 Object.defineProperty(b,"parameterSelection",{value:true});b.plan=()=>new Promise(()=>{});b.reviewGoals=()=>new Promise(()=>{});
 const r=new Runtime(w,b,opts,(event,data)=>events.push({event,...data}));primeExecution(r);
 try{await r.tick();const pending=r.tick();await flush();motor.phase='digging';motor.estimatedDigMs=3000;finish(decision('stop'));await pending;
 assert.equal(w.aborts,0);assert.ok(events.some(e=>e.reason==='execution phase changed'&&e.requestedPhase==='approach'&&e.currentPhase==='digging'));
 await r.tick();assert.equal(w.aborts,1);assert.equal(w.maxRunning,1);
 }finally{r.close();await flush();}
});

test('maintain response across a motor phase transition does not restart the action',async()=>{
 const w=new SlowWorld();let phase:any='digging';(w as any).executionProgress=()=>({phase,phaseElapsedMs:10,blockBroken:phase==='collecting'});
 let finish!:(d:Supervision)=>void,calls=0;
 const b=brain(async()=>++calls===1?{...decision('selected'),selected:{id:'m',action:'mine',plan:{goal:'Get wood',preferred:'mine',mine:{position:{x:1,y:64,z:0},expected:'oak_log'}}}}:new Promise(resolve=>finish=resolve));
 Object.defineProperty(b,"parameterSelection",{value:true});b.plan=()=>new Promise(()=>{});b.reviewGoals=()=>new Promise(()=>{});
 const r=new Runtime(w,b,opts,()=>{});primeExecution(r);
 try{await r.tick();const pending=r.tick();await flush();phase='collecting';finish(decision('continue'));await pending;assert.equal(w.starts,1);assert.equal(w.aborts,0);}finally{r.close();await flush();}
});
