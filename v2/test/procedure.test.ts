import {emptyActions} from '../src/action-domains.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {Runtime} from '../src/runtime.js';
import {ProcedureRunner,carried,materials,parseProcedure,recipeFact} from '../src/procedure.js';
import {parseIntent} from '../src/work-intent.js';
import {ApiBrain,Budget,parsePlan} from '../src/providers.js';
import {config} from '../src/config.js';
import {parameterSupervise} from '../src/parameter-supervisor.js';
import {selectorContext} from '../src/selector-context.js';
import {SocialMemory} from '../src/social.js';
import {MineflayerWorld} from '../src/mineflayer.js';
import {ProcedureWorld,woodPlan,recipe,scriptedBrain,until} from './fixtures/procedure.js';
const options={workflowMode:'procedural' as const,planMs:45000,actionMs:2000,minConfidence:.55,selectorMs:0};
const command=(choice:string)=>({choice,confidence:.01,review:'none' as const,routes:{}});
function fixture(select?:Parameters<typeof scriptedBrain>[0]){
 const w=new ProcedureWorld(),events:any[]=[];
 const r=new Runtime(w,scriptedBrain(select),options,(event,fields)=>events.push({event,...fields}));
 return {w,r,events,async start(){await until(()=>!!r.executionStatus.procedure,()=>r.tick());}};
}
test('v2.5 runtime collects two logs and crafts eight boards with immutable task-linked evidence',async()=>{
 const {w,r,events,start}=fixture();
 try{await start();await until(()=>r.executionStatus.procedure?.status==='completed',()=>r.tick());
  assert.deepEqual(w.starts.map(x=>x.action),['mine','mine','craft']);
  assert.equal(w.starts[2].plan.craft!.count,2);assert.equal(carried(w.state,'oak_planks'),8);assert.equal(carried(w.state,'oak_log'),0);
  assert.equal(w.maxActive,1);assert.deepEqual(r.executionStatus.procedure!.completedSteps,['logs','boards']);
  assert.ok(r.planning.recentActions.every(a=>a.source==='procedure'&&a.selectorKind==='local_procedure'&&a.executionPlan?.intent?.taskId===r.plan.intent?.taskId));
  assert.deepEqual(r.planning.recentActions.map(a=>a.stepId),['logs','logs','boards']);
  assert.ok(r.planning.recentActions.every(a=>a.procedureId===r.executionStatus.procedure!.id));
  assert.equal(events.filter(e=>e.event==='procedure_started').length,1);
  assert.ok(events.some(e=>e.event==='execution_continue'));
  assert.equal(r.planning.procedure?.materials?.ingredients[0].required,0);
  assert.ok(r.planning.replanReasons.includes('procedure_completed'));
 }finally{r.close();}
});
test('deficit calculation uses held outputs, rounds recipe yield, and never recounts consumed completed steps',()=>{
 const w=new ProcedureWorld();w.set('oak_planks',3);w.set('oak_log',1);
 const craft=woodPlan.procedure!.steps[1] as any,report=materials(craft,w.state,i=>w.recipes(i));
 assert.equal(report.executions,2);assert.deepEqual(report.ingredients,[{item:'oak_log',held:1,required:2,missing:1}]);
 const runner=new ProcedureRunner(woodPlan,woodPlan.procedure!);const first=runner.next(w.state,i=>w.recipes(i))!;assert.equal(first.action,'mine');
 w.set('oak_log',2);runner.finish('succeeded',w.state);const second=runner.next(w.state,i=>w.recipes(i))!;
 assert.equal(second.action,'craft');assert.equal(second.plan.craft!.count,2);
 w.set('oak_log',0);w.set('oak_planks',11);runner.finish('succeeded',w.state);
 assert.equal(runner.next(w.state,i=>w.recipes(i)),undefined);assert.equal(runner.view().status,'completed');
});
test('JEV switches to eating mid-mine; cancelled changes are recorded without executing the remaining procedure',async()=>{
 let switchNow=false;
 const f=fixture(async(_s,i)=>switchNow?{...command('selected'),selected:{id:'meal',action:'eat',plan:{goal:'eat',preferred:'eat',modelSelected:true,foodItem:'bread'}}}:command(i.procedure?.status==='running'?'continue':i.procedureAvailable?'procedure':'unresolved'));
 f.w.waitMs=300;f.w.state.food=5;f.w.state.canEat=true;f.w.state.edibleItems=['bread'];f.w.set('bread',1);
 try{await f.start();f.w.lateGainOnAbort=true;switchNow=true;await f.r.tick();await until(()=>!f.r.executionStatus.actionPending,()=>delay(5));
  assert.deepEqual(f.w.starts.map(a=>a.action),['mine','eat']);assert.equal(f.w.maxActive,1);
  assert.equal(f.r.executionStatus.procedure?.status,'suspended');assert.equal(carried(f.w.state,'oak_log'),1);
  assert.equal(f.events.filter(e=>e.event==='procedure_suspended').length,1);
  const cancelled=f.r.planning.recentActions.find(a=>a.decision.action==='mine')!;
  assert.equal(cancelled.outcome,'cancelled');assert.equal(cancelled.after.inventory?.oak_log,1);
  assert.equal(f.r.planning.recentActions.at(-1)?.source,'selector');
 }finally{f.r.close();}
});
test('broken block with no drop blocks acquisition instead of reporting completion or mining forever',async()=>{
 const f=fixture();f.w.noDrop=true;
 try{await f.start();await until(()=>f.r.executionStatus.procedure?.status==='blocked',()=>f.r.tick());
  assert.equal(f.w.starts.length,1);assert.equal(carried(f.w.state,'oak_log'),0);
  assert.match(f.r.executionStatus.procedure!.reason!,/No confirmed inventory gain/);
  assert.equal(f.r.planning.recentActions[0].outcome,'succeeded'); // Motor break != procedure success.
 }finally{f.r.close();}
});
test('visible leftover drops use the existing pickup action before mining more',async()=>{
 const f=fixture();f.w.dropOnly=true;
 try{await f.start();await until(()=>f.r.executionStatus.procedure?.status==='completed',()=>f.r.tick());
  assert.deepEqual(f.w.starts.map(a=>a.action),['mine','pickup','mine','pickup','craft']);
  assert.equal(carried(f.w.state,'oak_planks'),8);
 }finally{f.r.close();}
});
test('unknown or locked recipes block without exposing recipe facts or inventing resource quantities',()=>{
 const w=new ProcedureWorld();w.state.recipeBook.unlocked=[];let reads=0;
 const r=new ProcedureRunner(woodPlan,woodPlan.procedure!);assert.equal(r.next(w.state,()=>{reads++;return [recipe];}),undefined);
 assert.equal(reads,0);assert.match(r.view().reason!,/not unlocked/);
});
test('already owned final output completes without redundant collection/crafting or recipe lookup',()=>{
 const w=new ProcedureWorld();w.set('oak_planks',8);w.state.recipeBook.unlocked=[];
 const r=new ProcedureRunner(woodPlan,woodPlan.procedure!);
 assert.equal(r.next(w.state,()=>{throw Error('No recipe lookup is needed');}),undefined);
 assert.equal(r.view().status,'completed');assert.equal(r.view().actions,0);
});
test('out-of-area and remembered-only blocks are not silently mined; resource shortage reports actual deficits',()=>{
 const w=new ProcedureWorld();w.state.places=w.state.vision!.blocks;w.state.vision!.blocks=[{name:'oak_log',position:{x:20,y:64,z:0},lastSeen:0}];
 const r=new ProcedureRunner(woodPlan,woodPlan.procedure!);assert.equal(r.next(w.state,i=>w.recipes(i)),undefined);assert.match(r.view().reason!,/No fresh matching target/);
 assert.equal(r.view().materials!.ingredients[0].missing,2);
});
test('action/time limits and primitive failures block rather than silently retrying',()=>{
 for(const limit of ['actions','time','failure']){
  const w=new ProcedureWorld(),p=structuredClone(woodPlan.procedure!);p.maxActions=1;p.maxMs=1000;
  const r=new ProcedureRunner(woodPlan,p,0);
  if(limit==='time'){assert.equal(r.next(w.state,i=>w.recipes(i),1000),undefined);}
  else{r.next(w.state,i=>w.recipes(i),0);w.set('oak_log',1);r.finish(limit==='failure'?'failed':'succeeded',w.state);r.next(w.state,i=>w.recipes(i),1);}
  assert.equal(r.view().status,'blocked');
 }
});
test('a newer LLM plan does not rewrite an accepted procedure or its starting task',async()=>{
 const f=fixture();f.w.waitMs=60;
 try{await f.start();const task=f.r.plan.intent!.taskId;f.r.plan={goal:'Different suggested work',preferred:'look',intent:{taskId:'later-task',description:'other',desiredInventory:[],constraints:[]}};
  await until(()=>f.r.executionStatus.procedure?.status==='completed',()=>f.r.tick());
  assert.equal(carried(f.w.state,'oak_planks'),8);assert.equal(f.r.executionStatus.procedure!.taskId,task);
  assert.ok(f.r.planning.recentActions.every(a=>a.executionPlan?.intent?.taskId===task));
 }finally{f.r.close();}
});
test('death/reconnect suspends the procedure and cannot silently restart it',async()=>{
 const f=fixture();f.w.waitMs=300;
 try{await f.start();f.w.state.health=0;await f.r.tick();await delay(10);f.w.state.health=20;await f.r.tick();await delay(10);
  assert.equal(f.w.starts.length,1);assert.equal(f.r.executionStatus.procedure!.status,'suspended');
 }finally{f.r.close();}
});
test('direct mode rejects procedures, and procedural schema rejects invented actions/dependency cycles',()=>{
 assert.throws(()=>parseIntent(woodPlan,parsePlan),/direct workflow/);
 assert.deepEqual(parseIntent(woodPlan,parsePlan,true).procedure,woodPlan.procedure);
 assert.throws(()=>parseProcedure({...woodPlan.procedure,steps:[{id:'x',action:'javascript',item:'oak_log'}]}),/Invalid procedure action/);
 const p=structuredClone(woodPlan.procedure!);(p.steps[0] as any).materialsFor='logs';assert.throws(()=>parseProcedure(p),/later craft/);
});
test('JEV receives procedure offer/status/deficits and can select an ordinary replacement, not only go/no-go',async()=>{
 const w=new ProcedureWorld(),runner=new ProcedureRunner(woodPlan,woodPlan.procedure!);runner.next(w.state,i=>w.recipes(i));
 const input={options:[],execution:null,inbox:[],goal:'boards',plan:woodPlan,procedureAvailable:true,procedure:runner.view()};
 const context=selectorContext(w.state,input,{});
 assert.equal(context.procedure!.materials!.ingredients[0].missing,2);assert.deepEqual(context.procedureOffer,woodPlan.procedure);
 for(const chosen of ['procedure','continue','stop']){
  let calls=0;
  const d=await parameterSupervise(w.state,input,async qs=>{calls++;for(const x of ['eat','flee','mine'])assert.equal(x in qs.action.criteria,!emptyActions(w.state).includes(x));return {action:{type:'choice',choice:chosen,confidence:.2},review:{type:'choice',choice:'none',confidence:1}};},'coordinated');
  assert.equal(d.choice,chosen);assert.equal(calls,1);
 }
});
test('medium provider uses procedure contract only in opted-in mode; fake transport sends no API request',async()=>{
 let calls=0;
 const b=new ApiBrain({...config(),workflowMode:'procedural',targetPolicy:'observed',llmKey:'mock'},new Budget(3,1),(async(_u:any,init:any)=>{
  calls++;const body=JSON.parse(init.body),input=JSON.parse(body.messages[1].content);
  assert.ok(input.procedureContract);assert.match(body.messages[0].content,/return a bounded executable procedure/);
  assert.doesNotMatch(body.messages[0].content,/JEV owns the next immediate action and its exact target/);
  assert.match(body.messages[0].content,/procedure\?:\{version:1/);
  assert.match(body.messages[0].content,/omit it only with an explicit capability\/evidence limitation/);
  return Response.json({choices:[{message:{content:JSON.stringify(woodPlan)}}],usage:{prompt_tokens:1,completion_tokens:1}});
 }) as typeof fetch);
 const r=new Runtime(new ProcedureWorld(),scriptedBrain(),options,()=>{});
 try{const p=await b.plan(new ProcedureWorld().snapshot(),[],new AbortController().signal,null,r.planning);assert.deepEqual(p.procedure,woodPlan.procedure);assert.equal(calls,1);}finally{r.close();}
});
test('recipe facts preserve actual yields and exact inputs; unsupported byproducts are not hidden',()=>{
 const items={1:{name:'oak_log'},2:{name:'oak_planks'},3:{name:'bucket'}};
 assert.deepEqual(recipeFact({result:{id:2,count:4},delta:[{id:1,count:-1},{id:2,count:4}],requiresTable:false},items),recipe);
 assert.equal(recipeFact({result:{id:2,count:4},delta:[{id:1,count:-1},{id:2,count:4},{id:3,count:1}]},items),undefined);
});
test('Mineflayer adapter uses the selected recipe variant even when another variant is first and feasible',async()=>{
 const world=Object.create(MineflayerWorld.prototype) as any;
 const oak={result:{id:2,count:4},requiresTable:false,delta:[{id:1,count:-1},{id:2,count:4}]};
 const stripped={result:{id:2,count:4},requiresTable:false,delta:[{id:3,count:-1},{id:2,count:4}]};
 let count=0,used:any;const bot:any={registry:{itemsByName:{oak_planks:{id:2}},items:{1:{name:'oak_log'},2:{name:'oak_planks'},3:{name:'stripped_oak_log'}}},recipesAll:()=>[stripped,oak],recipesFor:()=>[stripped,oak],inventory:{items:()=>[{name:'oak_planks',type:2,count}],count:()=>10},clickWindow:async()=>{},craft:async(r:any)=>{used=r;count+=4;},pathfinder:{setGoal(){}},clearControlStates(){},stopDigging(){},deactivateItem(){}};
 world.bot=bot;world.ready=true;world.recipeBook={snapshot:()=>({unlocked:['minecraft:oak_planks']})};world.observe=()=>{};world.table=()=>null;
 assert.equal(world.recipes('oak_planks').length,2);
 await world.execute('craft',new AbortController().signal,{craft:{item:'oak_planks',count:1,recipeKey:recipe.key}});
 assert.equal(used,oak);assert.equal(count,4);
 world.recipeBook={snapshot:()=>({unlocked:[]})};
 assert.deepEqual(world.recipes('oak_planks'),[]);
 await assert.rejects(world.execute('craft',new AbortController().signal,{craft:{item:'oak_planks',count:1,recipeKey:recipe.key}}),/not unlocked/);
});
test('late procedure approval cannot apply a superseded LLM offer',async()=>{
 let finish!:(v:any)=>void,asked=false;
 const f=fixture(async(_s,i)=>{
  if(i.procedureAvailable){asked=true;return await new Promise(resolve=>finish=resolve);}
  return command('unresolved');
 });
 try{
  // Start long/medium planning, then hold the selector response.
  await f.r.tick();await delay(0);await f.r.tick();await delay(0);
  const pending=f.r.tick();await delay(0);assert.ok(asked);
  f.r.plan={goal:'New work',preferred:'look'};finish(command('procedure'));await pending;
  assert.equal(f.w.starts.length,0);assert.equal(f.r.executionStatus.procedure,undefined);
  assert.ok(f.events.some(e=>e.reason==='procedure offer changed or unavailable'));
 }finally{f.r.close();}
});
test('ordinary direct runtime does not accept a procedure choice or run hidden local continuation',async()=>{
 const w=new ProcedureWorld(),b=scriptedBrain(async()=>command('procedure'));
 const r=new Runtime(w,b,{...options,workflowMode:'direct'},()=>{});
 try{for(let i=0;i<5;i++){await r.tick();await delay(0);}assert.equal(w.starts.length,0);assert.equal(r.executionStatus.procedure,undefined);}finally{r.close();}
});

test('JEV detour and explicit resume preserve job identity, completed work and current inventory',async()=>{
 let detour=false,allowResume=false;
 const f=fixture(async(s,i)=>{
  if(detour&&s.food===0)return {...command('selected'),selected:{id:'meal',action:'eat',plan:{goal:'eat',preferred:'eat',modelSelected:true,foodItem:'bread'}}};
  if(i.execution)return command('continue');
  if(i.procedure?.resumeAvailable)return command(allowResume?'resume_procedure':'unresolved');
  return command(!i.procedure?'procedure':'unresolved');
 });
 f.w.waitMs=60;f.w.state.edibleItems=['bread'];f.w.set('bread',1);
 try{
  await f.start();await until(()=>carried(f.w.state,'oak_log')===1&&f.w.starts.length===2,()=>f.r.tick());
  const id=f.r.executionStatus.procedure!.id;
  detour=true;f.w.state.food=0;f.w.state.canEat=true;
  await f.r.tick();await until(()=>!f.r.executionStatus.actionPending,()=>delay(5));
  const count=f.w.starts.length;await f.r.tick();assert.equal(f.w.starts.length,count,'No automatic return after eating');
  assert.equal(f.r.executionStatus.procedure!.resumeAvailable,true);
  allowResume=true;await until(()=>f.r.executionStatus.procedure?.status==='completed',()=>f.r.tick());
  assert.equal(f.r.executionStatus.procedure!.id,id);assert.equal(f.w.maxActive,1);
  assert.equal(carried(f.w.state,'oak_planks'),8);assert.equal(f.w.starts.filter(a=>a.action==='craft').length,1);
  assert.equal(f.events.filter(e=>e.event==='procedure_resumed').length,1);
  assert.deepEqual(f.w.starts[1].plan.mine!.position,f.w.starts[3].plan.mine!.position,'Cancelled block remains eligible after fresh validation');
 }finally{f.r.close();}
});
test('resume retains completed acquisition after a cancelled craft and never resets total budgets',()=>{
 const w=new ProcedureWorld();w.set('oak_log',2);
 const r=new ProcedureRunner(woodPlan,woodPlan.procedure!,1000);r.next(w.snapshot(),()=>[recipe],1001);
 assert.deepEqual(r.view(1001).completedSteps,['logs']);r.suspend('detour',true);
 assert.equal(r.view(1002).resumeAvailable,false,'Cannot resume while previous motor is settling');
 r.finish('cancelled',w.snapshot());assert.equal(r.resume(w.snapshot(),1003),true);
 const cmd=r.next(w.snapshot(),()=>[recipe],1004);assert.equal(cmd?.action,'craft');assert.equal(r.view(1004).actions,2);
 r.suspend('detour',true);r.finish('cancelled',w.snapshot());assert.equal(r.resume(w.snapshot(),11001),false,'Time budget includes pause');
 const d={...woodPlan.procedure!,maxActions:1},b=new ProcedureRunner(woodPlan,d);
 b.next(w.snapshot(),()=>[recipe]);b.suspend('detour',true);b.finish('cancelled',w.snapshot());assert.equal(b.resume(w.snapshot()),false,'Attempts do not reset');
});
test('invalidation after an already suspended job revokes resume and stale resume cannot start it',async()=>{
 let mode='start',resolve:((v:any)=>void)|undefined;
 const f=fixture(async(_s,i)=>{
  if(mode==='stop')return command('stop');
  if(mode==='resume')return await new Promise(r=>{resolve=r;});
  return command(i.execution?'continue':!i.procedure?'procedure':'unresolved');
 });f.w.waitMs=200;
 try{await f.start();mode='stop';await f.r.tick();assert.equal(f.r.executionStatus.procedure!.resumeAvailable,true);
  mode='resume';const pending=f.r.tick();await until(()=>!!resolve,()=>delay(0));
  f.r.invalidate('disconnected');assert.equal(f.r.executionStatus.procedure!.resumeAvailable,false);
  resolve!(command('resume_procedure'));await pending;assert.equal(f.w.starts.length,1);
 }finally{f.r.close();}
});
test('procedural supervisor retains observations and exposes resume only for suspended resumable work',async()=>{
 const w=new ProcedureWorld();w.state.food=0;w.state.incomingDamage=[{at:100,type:'health_loss',before:20,after:16,amount:4}];w.state.health=16;
 w.state.timeOfDay=14000;w.state.environment={inWater:true,inLava:false,onGround:false,oxygen:120};
 w.state.equipment=[{slot:'hand',name:'iron_sword'}];
 w.state.nearbyPlayers=[{name:'Alice',position:{x:1,y:64,z:0}}];
 const message={id:'request-1',at:101,speaker:'Alice',text:'Bob, can you help me?'};
 // Social memory supplies message bodies; supervisor inbox marks pending routing.
 const social=new SocialMemory('Bob');social.ingest([message]);w.state.social=social.context();
 const r=new ProcedureRunner(woodPlan,woodPlan.procedure!);r.suspend('detour',true);
 const input={options:[],execution:null,inbox:[message],goal:'boards',plan:woodPlan,procedureAvailable:true,procedure:r.view()};
 const context=selectorContext(w.snapshot(),input,{});
 assert.equal(context.procedureSituation!.food.fullness,0);assert.equal(context.procedureSituation!.food.maximum,20);
 assert.equal(context.procedureSituation!.damageEvents[0].type,'health_loss');
 assert.equal(context.observation.timeOfDay,14000);
 assert.deepEqual(context.observation.environment,w.state.environment);
 assert.deepEqual(context.observation.equipment,w.state.equipment);
 assert.deepEqual(context.observation.nearbyPlayers,w.state.nearbyPlayers);
 assert.equal(context.dialogue!.messages[0].text,message.text);assert.deepEqual(context.dialogue!.inboxIds,[message.id]);
 const d=await parameterSupervise(w.snapshot(),input,async q=>{
  assert.ok(q.action.criteria.resume_procedure);assert.equal(q.action.criteria.continue,undefined);
  assert.match(q.action.instructions,/not commit to finishing/);
  for(const x of ['attack','flee','eat'])assert.equal(!!q.action.criteria[x],!emptyActions(w.snapshot()).includes(x));
  assert.ok(q.message_0.instructions.includes('"Bob"')&&q.message_0.instructions.includes('"request-1"'));
  return {action:{type:'choice',choice:'resume_procedure',confidence:.01},review:{type:'choice',choice:'medium',confidence:1},message_0:{type:'choice',choice:'respond',confidence:1}};
 },'coordinated');
 assert.equal(d.choice,'resume_procedure','Environmental changes do not locally override the model-selected response');
 assert.equal(d.review,'medium');assert.equal(d.routes[message.id],'respond','Dialogue and plan review can proceed with the selected physical response');
});

test('procedural execution-scope descriptions preserve every direct action and model-selected control',async()=>{
 const w=new ProcedureWorld(),r=new ProcedureRunner(woodPlan,woodPlan.procedure!);
 const cmd=r.next(w.snapshot(),()=>[recipe])!;
 const base={options:[],execution:{id:1,action:cmd.action,plan:cmd.plan,elapsedMs:10},inbox:[],goal:'boards',plan:woodPlan};
 let direct:string[]=[],procedural:string[]=[];
 for(const withJob of [false,true]){
  const result=await parameterSupervise(w.snapshot(),withJob?{...base,procedure:r.view(),procedureAvailable:true}:base,async q=>{
   const keys=Object.keys(q.action.criteria).filter(k=>!['procedure','resume_procedure'].includes(k));
   if(withJob)procedural=keys;else direct=keys;
   return {action:{type:'choice',choice:'stop',confidence:.01},review:{type:'choice',choice:'none',confidence:1}};
  },'coordinated');
  assert.equal(result.choice,'stop','The model can still stop; scope wording never forces continuation or resumption');
 }
 assert.deepEqual(procedural,direct);
});

test('partial pickup gain during a pause clears old awaiting-drop state before a resumed mine',()=>{
 const w=new ProcedureWorld(),r=new ProcedureRunner(woodPlan,woodPlan.procedure!);
 const mine=r.next(w.snapshot(),()=>[recipe])!;
 w.state.vision!.blocks=w.state.vision!.blocks.filter(b=>b.position.x!==mine.plan.mine!.position.x);
 w.state.visibleItems=[{id:22,name:'oak_log',count:1,position:mine.plan.mine!.position}];
 r.finish('succeeded',w.snapshot());assert.equal(r.next(w.snapshot(),()=>[recipe])!.action,'pickup');
 r.suspend('detour',true);w.set('oak_log',1);w.state.visibleItems=[];r.finish('cancelled',w.snapshot());
 assert.equal(r.resume(w.snapshot()),true);assert.equal(r.next(w.snapshot(),()=>[recipe])!.action,'mine');
});

test('first impossible craft is rejected with exact shortage, no later acquisition silently moved earlier',async()=>{
 const {inspectProcedureOffer}=await import('../src/procedure.js');const w=new ProcedureWorld();w.set('oak_planks',4);w.set('oak_log',2);
 const p=structuredClone(woodPlan);p.procedure!.steps=[{id:'craft_held',action:'craft',item:'oak_planks',targetCount:16,recipeInputs:['oak_log']},...p.procedure!.steps];
 const result=inspectProcedureOffer(p,w.snapshot(),()=>[recipe]);assert.equal(result.available,false);assert.equal(result.materials!.ingredients[0].missing,1);
 assert.equal(w.starts.length,0);assert.equal(p.procedure!.steps[0].id,'craft_held');
 w.set('oak_log',3);assert.equal(inspectProcedureOffer(p,w.snapshot(),()=>[recipe]).available,true);
});
test('unchanged blocked procedure cannot reset its job budget on repeated JEV starts; new conditions allow retry',async()=>{
 const f=fixture(async(_s,i)=>command(i.execution?'continue':'procedure'));f.w.noDrop=true;
 try{await f.start();await until(()=>f.r.executionStatus.procedure?.status==='blocked',()=>f.r.tick());
 const id=f.r.executionStatus.procedure!.id;
 for(let n=0;n<8;n++){await f.r.tick();await delay(1);}
 assert.equal(f.r.executionStatus.procedure!.id,id);assert.equal(f.events.filter(e=>e.event==='procedure_started').length,1);
 f.w.set('oak_log',2);f.w.noDrop=false;
 await until(()=>f.r.executionStatus.procedure?.status==='completed',()=>f.r.tick());assert.equal(carried(f.w.state,'oak_planks'),8);
 }finally{f.r.close();}
});
test('procedure accepts only genuinely last-seen drop evidence across occlusion and counts pickup gain',()=>{
 const w=new ProcedureWorld(),r=new ProcedureRunner(woodPlan,woodPlan.procedure!);const c=r.next(w.snapshot(),()=>[recipe])!;
 w.state.vision!.blocks=[];w.state.rememberedItems=[{id:88,name:'oak_log',count:1,position:c.plan.mine!.position,lastSeen:Date.now(),source:'last_seen',currentExistence:'unknown'}];
 r.finish('succeeded',w.snapshot());const next=r.next(w.snapshot(),()=>[recipe]);assert.equal(next?.action,'pickup');assert.equal(next?.plan.pickup!.entityId,88);
});

test('unexecutable offer exposes shortage to both planner and JEV without substituting a different action',async()=>{
 const w=new ProcedureWorld();w.set('oak_planks',4);w.set('oak_log',2);
 const p=structuredClone(woodPlan);p.procedure!.steps=[{id:'impossible',action:'craft',item:'oak_planks',targetCount:16,recipeInputs:['oak_log']}];
 let received:any;const brain=scriptedBrain(async(_s,i)=>{received=i;return command('unresolved');});brain.plan=async()=>p;
 const r=new Runtime(w,brain,options,()=>{});
 try{for(let i=0;i<10;i++){await r.tick();await delay(1);if(received?.procedureOfferStatus?.materials)break;}
 assert.equal(received.procedureAvailable,false);assert.equal(received.procedureOfferStatus.materials.ingredients[0].missing,1);
 assert.equal(r.planning.procedureOfferStatus?.materials?.ingredients[0].missing,1);
 assert.equal(selectorContext(w.snapshot(),received,{}).procedureOfferStatus?.available,false);assert.equal(w.starts.length,0);
 }finally{r.close();}
});

test('explicit user request reaches the first JEV heartbeat while long planning is still pending',async()=>{
 const w=new ProcedureWorld();let input:any;const b=scriptedBrain(async(_s,i)=>{input=i;return command('unresolved');});
 b.reviewGoals=async()=>new Promise(()=>{});
 const r=new Runtime(w,b,options,()=>{});
 try{r.setGoal('Craft one white bed');await r.tick();
 assert.equal(r.executionStatus.longPending,true);assert.match(input.goal,/^Provisional/);assert.equal(input.goalReview.trigger,'operator_request_changed');
 assert.equal(input.userRequest,'Craft one white bed');assert.equal(selectorContext(w.snapshot(),input,{}).userRequest,input.userRequest);
 assert.equal(w.starts.length,0);
 r.setGoal('Recover the observed dropped log');await r.tick();assert.equal(input.userRequest,'Recover the observed dropped log');
 }finally{r.close();}
});
test('procedure errors name the field to change, and null means an omitted procedure or threat policy',()=>{
 const area={center:{x:0,y:64,z:0},radius:4},base={version:1,maxActions:4,maxMs:60000};
 assert.throws(()=>parseProcedure({...base,steps:[{id:'stone',action:'mine',item:'stone',area,materialsFor:'shelter'}]}),/materialsFor: step stone names "shelter".*give targetCount/);
 assert.throws(()=>parseProcedure({...base,steps:[{id:'pick',action:'craft',item:'wooden_pickaxe',targetCount:1,recipeInputs:['oak_planks','stick'],workstation:'(-463,71,231)'}]}),/craft pick: workstation must be an \{x,y,z\} integer object/);
 assert.throws(()=>parseProcedure({...base,steps:[{id:'pick',action:'craft',item:'wooden_pickaxe',targetCount:1,recipeInputs:['stick','oak_planks','oak_planks']}]}),/craft pick: recipeInputs lists each distinct ingredient name once/);
 const intent={goal:'Hold position',intent:{description:'Stay near spawn',desiredInventory:[],constraints:[]}};
 const p=parseIntent({...intent,procedure:null,threatResponse:null},parsePlan,true);
 assert.equal(p.procedure,undefined);assert.equal(p.threatResponse,undefined);
 assert.equal(parseIntent({...intent,procedure:null},parsePlan,false).procedure,undefined);
 assert.equal(parseIntent({...intent,procedure:{...base,steps:[]}},parsePlan,true).procedure,undefined);
});
