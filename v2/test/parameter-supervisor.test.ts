import {decodeReferenceRequest} from '../src/jev-references.js';
import {decodeJevState} from '../src/jev-state.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {parameterSupervise,selectValue,type Ask} from '../src/parameter-supervisor.js';
import {MockWorld} from '../src/mock.js';import {ApiBrain,Budget,MockBrain} from '../src/providers.js';import {config} from '../src/config.js';
import {candidates,type Brain,type Plan} from '../src/types.js';import {Runtime} from '../src/runtime.js';import {setTimeout as delay} from 'node:timers/promises';
const input={options:[],execution:null,inbox:[],goal:'Self chosen goal',parameterSelection:true};
function fixture(){const s=new MockWorld().snapshot();s.dimension='overworld';s.inventory=[{name:'chest',count:12,slot:9},{name:'bread',count:5,slot:10},{name:'iron_sword',count:1,slot:11}];s.edibleItems=['bread'];s.placeableItems=['chest','crafting_table'];s.placementSites=[{reference:{x:2,y:63,z:0},position:{x:2,y:64,z:0}}];s.nearbyPlayers=[{name:'Bob',position:{x:1,y:64,z:1}}];s.enemies=[{id:1,kind:'zombie',distance:2,position:{x:2,y:64,z:0}},{id:2,kind:'skeleton',distance:6,position:{x:6,y:64,z:0}}];s.craftable=Array.from({length:20},(_,i)=>'recipe_'+i);s.crafting={semantics:'Fixture: feasible counts',recipes:s.craftable.map(item=>({item,maxExecutions:8,variants:[]}))};s.vision={yaw:0,pitch:0,blocks:[{name:'chest',position:{x:3,y:64,z:0},lastSeen:1},...Array.from({length:40},(_,i)=>({name:'oak_log',position:{x:i,y:66,z:0},lastSeen:1}))]};s.containers=[{position:{x:3,y:64,z:0},observedAt:1,items:[{name:'bread',count:5}]}];s.visibleItems=[{id:5,name:'bread',count:1,position:{x:1,y:64,z:1},distance:1} as any];s.navigationTargets=Array.from({length:20},(_,i)=>({x:i+5,y:64,z:0}));return s;}
function responder(action:string,select:Record<string,(v:any)=>boolean>={},record:any[]=[]):Ask{return async(questions,context)=>{record.push({questions,context});return Object.fromEntries(Object.entries(questions).map(([name,q])=>{
 let choice=name==='action'?action:name==='review'?'none':name.startsWith('message_')?'defer':undefined;
 if(!choice){const entries=Object.entries(q.criteria).filter(([k])=>k!=='none'&&k!=='revise');const predicate=select[name]??(()=>true);choice=entries.find(([k,v])=>typeof v==='string'?(k.startsWith('group_')?JSON.parse(v).some((x:any)=>predicate(x.value)):predicate(JSON.parse(v))):(k.startsWith('group_')?v.values!.some(predicate):predicate(v.value)))?.[0]??'none';}
 return [name,{type:'choice',choice,confidence:.1}];}));};}
test('JEV selects previously truncated block and tool without a duration choice or goal filtering',async()=>{const s=fixture();s.health=3;const d=await parameterSupervise(s,input,responder('mine',{block:b=>b.position.x===39,tool:t=>t.slot===11,attemptSeconds:()=>{throw Error('Duration must not be requested');}}));assert.equal(d.selected?.plan.mine?.position.x,39);assert.equal(d.selected?.plan.mine?.tool,'iron_sword');assert.equal(d.selected?.plan.mine?.maxMs,undefined);assert.ok(candidates(s,d.selected!.plan).includes('mine'));});
test('craft output beyond former eight-entry cap and non-unit count are model choices',async()=>{const d=await parameterSupervise(fixture(),input,responder('craft',{recipeOutput:v=>v==='recipe_19',recipeExecutions:n=>n===7}));assert.deepEqual(d.selected?.plan.craft,{item:'recipe_19',count:7});});
test('placement needs no LLM proposal; item and observed site are selected by JEV',async()=>{const d=await parameterSupervise(fixture(),input,responder('place_block'));assert.equal(d.selected?.plan.build?.item,'chest');assert.deepEqual(d.selected?.plan.build?.position,{x:2,y:64,z:0});});
test('all parameterized skills resolve observed arguments',async()=>{for(const action of ['move','place_table','pickup','equip','eat','follow','attack','flee','look','give','inspect_container','deposit','withdraw']){const d=await parameterSupervise(fixture(),input,responder(action));assert.equal(d.selected?.action,action,action);}});
test('target enemy and followed player are model choices rather than nearest/configured',async()=>{const d=await parameterSupervise(fixture(),input,responder('attack',{target:e=>e.id===2}));assert.equal(d.selected?.plan.targetEntityId,2);const f=await parameterSupervise(fixture(),input,responder('follow'));assert.equal(f.selected?.plan.followPlayer,'Bob');});
test('hierarchical transport keeps every argument reachable with at most 255 choices',async()=>{const calls:any[]=[];const v=await selectValue('number',Array.from({length:1000},(_,i)=>i),responder('wait',{number:n=>n===999},calls),{});assert.equal(v,999);assert.equal(calls.length,2);for(const c of calls)assert.ok(Object.keys(c.questions.number.criteria).length<=255);});
test('missing argument domain is explicit; no locally chosen fallback execution',async()=>{const s=fixture();s.placementSites=[];await assert.rejects(parameterSupervise(s,input,responder('place_block')),/Invalid parameter selection/);});
test('intentional wait is absent; continue and stop require running work and no duration call',async()=>{
 for(const contract of ['legacy','explicit','coordinated'] as const){
  await assert.rejects(parameterSupervise(fixture(),input,responder('wait'),contract),/Invalid parameter selection/);
  const calls:any[]=[];const running={...input,execution:{id:1,action:'mine' as const,plan:{goal:'wood',preferred:'mine' as const},elapsedMs:1}};
  for(const action of ['continue','stop']){const d=await parameterSupervise(fixture(),running,responder(action,{},calls),contract);assert.equal(d.choice,action);assert.equal(d.selected,undefined);}
  assert.equal(calls.length,2);for(const c of calls){assert.ok(!('wait' in c.questions.action.criteria));assert.ok(!('idle' in c.questions.action.criteria));}
 }
});
test('actual API path performs action then conditional argument selection',async()=>{const s=fixture(),calls:any[]=[],respond=responder('craft',{recipeOutput:v=>v==='recipe_19',recipeExecutions:n=>n===4},calls);const b=new ApiBrain({...config(),mode:'jev',targetPolicy:'observed',jevKey:'test',llmKey:'test'},new Budget(20,2),(async(_url:any,init:any)=>{const p=JSON.parse(init.body);return Response.json({answers:await respond(decodeReferenceRequest(p.state,p.questions).questions,decodeReferenceRequest(p.state,p.questions).context),usage:{input_tokens:1,output_tokens:0}});}) as typeof fetch);assert.equal(b.parameterSelection,true);const d=await b.supervise(s,input,new AbortController().signal);assert.equal(d.selected?.plan.craft?.count,4);assert.equal(calls.length,3);assert.equal(calls[2].context.boundArguments.recipeOutput,'recipe_19');});
test('runtime applies selected argument plan directly and switches without three confirmations',async()=>{
 class W extends MockWorld{starts:string[]=[];override async execute(a:any,signal:AbortSignal){this.starts.push(a);await delay(10000,undefined,{signal});return 'done';}}
 const w=new W();let count=0;const b:Brain={parameterSelection:true,choose:new MockBrain().choose,plan:()=>new Promise(()=>{}),supervise:async()=>({choice:'selected',confidence:.01,review:'none',routes:{},selected:{id:'selected',action:++count===1?'mine':'look',plan:count===1?{goal:'wood',preferred:'mine',modelSelected:true,mine:{position:{x:1,y:64,z:0},expected:'oak_log',keepTool:true,maxMs:5000}}:{goal:'observe',preferred:'look',modelSelected:true,look:{yaw:1,pitch:0}}}})};
 const r=new Runtime(w,b,{planMs:30000,actionMs:10000,minConfidence:.9,selectorMs:0},()=>{}),x=r as any;x.lastReady=true;x.lastLifeKey='true';try{await r.tick();await r.tick();assert.deepEqual(w.starts,['mine','look']);}finally{r.close();await x.executionTask;}
});

test('unknown argument answers cannot become executable plans',async()=>{
 let calls=0;const good=responder('craft');const ask:Ask=async(q,c)=>{if(++calls===1)return good(q,c);return Object.fromEntries(Object.keys(q).map(k=>[k,{type:'choice',choice:'invented',confidence:1}]));};
 await assert.rejects(parameterSupervise(fixture(),input,ask),/Invalid parameter selection/);
});
test('full map coordinates remain selectable but wrong-dimension places are not grounded destinations',async()=>{
 const s=fixture();s.importantPlaces=[{id:'far',dimension:'overworld',position:{x:1000,y:64,z:1000},label:'Old base',reason:'Return',importance:'active',registeredBlock:'stone',lastObservedBlock:'stone',lastSeen:1,evidenceId:'seen',status:'historical'},{id:'other',dimension:'the_nether',position:{x:2000,y:64,z:2000},label:'Other dimension',reason:'History',importance:'active',registeredBlock:'stone',lastObservedBlock:'stone',lastSeen:1,evidenceId:'seen2',status:'historical'}];
 const d=await parameterSupervise(s,input,responder('move',{destination:p=>p.x===1000}));assert.equal(d.selected?.plan.destination?.x,1000);assert.ok(candidates(s,d.selected!.plan).includes('move'));
 const wrong=await parameterSupervise(s,input,responder('move',{destination:p=>p.x===2000}));assert.equal(wrong.choice,'unresolved');
});
test('argument selection failures do not cancel an existing execution',async()=>{
 const d=await parameterSupervise({...fixture(),placementSites:[]},{...input,execution:{id:7,action:'place_block',plan:{goal:'wall',preferred:'place_block'},elapsedMs:100}},responder('place_block'));assert.equal(d.choice,'unresolved');assert.equal(d.selected,undefined);
});
test('changed enemy identity is not silently replaced by another visible target',async()=>{const s=fixture(),d=await parameterSupervise(s,input,responder('attack',{target:e=>e.id===2}));s.enemies=s.enemies!.filter(e=>e.id!==2);assert.ok(!candidates(s,d.selected!.plan).includes('attack'));});

import {combat,COMBAT_BUDGET_MS,type CombatPort} from '../src/combat.js';
test('combat motor honors chosen target and leaves low-health strategy to model',async()=>{
 let time=0;const hits:number[]=[];const port:CombatPort={observe:()=>({health:3,position:{x:0,y:0,z:0},enemies:[{id:1,kind:'zombie',distance:1,position:{x:1,y:0,z:0}},{id:2,kind:'skeleton',distance:2,position:{x:2,y:0,z:0}}]}),equipWeapon:async()=>{},cooldownMs:()=>700,approach:()=>{},strike:async id=>{hits.push(id);return true;},retreat:()=>true,stop:()=>{},wait:async ms=>{time+=ms;},now:()=>time};
 const result=await combat(port,'attack',new AbortController().signal,{targetId:2,modelSelected:true});assert.equal(result.targetId,2);assert.equal(result.outcome,'time_limit');assert.deepEqual(hits,Array(Math.floor((COMBAT_BUDGET_MS-1)/700)).fill(2));
});

test('camera sectors expose all 360 integer headings and model chooses exact angle',async()=>{
 const s=fixture();s.vision!.yaw=-Math.PI/2;s.vision!.pitch=Math.PI/6;const calls:any[]=[];
 const d=await parameterSupervise(s,input,responder('look',{yawDegrees:n=>n===359,pitchDegrees:n=>n===-45},calls));
 assert.equal(d.selected?.plan.look?.yaw,359*Math.PI/180);assert.equal(d.selected?.plan.look?.pitch,-Math.PI/4);
 const group=calls.find(c=>c.questions.yawDegrees&&Object.keys(c.questions.yawDegrees.criteria).some(k=>k.startsWith('group_')));
 assert.deepEqual(Object.values(group.questions.yawDegrees.criteria).filter((v:any)=>typeof v!=='string').flatMap((v:any)=>v.values),Array.from({length:360},(_,i)=>i));
 assert.equal(group.context.argumentSemantics.currentCameraDegrees.yaw,270);assert.ok(Math.abs(group.context.argumentSemantics.currentCameraDegrees.pitch-30)<1e-9);
});

test('unexecuted parameter choice carries selected action, bound item and domain evidence',async()=>{
 const s=fixture();const ask=responder('place_block',{placementSite:()=>false});
 const d=await parameterSupervise(s,input,ask);assert.equal(d.choice,'unresolved');
 assert.deepEqual(d.attempt,{action:'place_block',boundArguments:{blockItem:'chest'},unresolvedArgument:{name:'placementSite',availableValues:1},offeredArguments:[{name:'placementSite',values:s.placementSites} ]});
});
test('LLM planning sees unexecuted JEV evidence, retained across generic reconsideration',async()=>{
 const world=new MockWorld();let i=0;
 const brain:Brain={parameterSelection:true,choose:new MockBrain().choose,plan:()=>new Promise(()=>{}),supervise:async()=>({choice:'unresolved',confidence:.5,review:'medium',routes:{},reason:++i===1?'No suitable placementSite':'Model requested planning',...(i===1?{attempt:{action:'place_block' as const,boundArguments:{blockItem:'chest'},unresolvedArgument:{name:'placementSite',availableValues:3}}}:{})})};
 const r=new Runtime(world,brain,{planMs:30000,actionMs:10000,minConfidence:0,selectorMs:0},()=>{});const x=r as any;x.lastReady=true;x.lastLifeKey='true';
 try{await r.tick();const first=r.planning.selectorFeedback;assert.ok(first?.includes('placementSite'));assert.ok(first?.includes('chest'));await r.tick();assert.equal(r.planning.selectorFeedback,first);assert.equal(r.planning.recentActions.length,0);}finally{r.close();}
});

test('destination arguments exclude reached references while retaining their factual context',async()=>{
 const s=fixture();s.position={x:-1.5,y:64,z:-1.5};s.navigationTargets=[{x:-2,y:65,z:-3},{x:8,y:64,z:0}];s.vision={yaw:0,pitch:0,blocks:s.navigationTargets.map(position=>({name:'stone',position,lastSeen:1}))};const calls:any[]=[];
 const d=await parameterSupervise(s,input,responder('move',{destination:p=>p.x===8},calls));
 assert.deepEqual(d.selected?.plan.destination,{x:8,y:64,z:0});
 const q=calls.find(c=>c.questions.destination);assert.ok(q.context.argumentSemantics.alreadyWithinArrivalRadius.coordinates.some((p:any)=>p.x===-2&&p.y===65&&p.z===-3));assert.equal(q.context.argumentSemantics.arrivalRadiusBlocks,2);
 assert.ok(candidates(s,d.selected!.plan).includes('move'));assert.deepEqual(s.navigationTargets[0],{x:-2,y:65,z:-3});
});

test('explicit live contract preserves all argument values and allows withdrawal',async()=>{
 const calls:any[]=[];
 const d=await parameterSupervise(fixture(),input,async(q,c)=>{
  calls.push({q,c});
  if(c.argumentName){const name=Object.keys(q)[0];assert.ok(!('none' in q[name].criteria));assert.ok('revise' in q[name].criteria);return {[name]:{type:'choice',choice:'revise',confidence:.01}};}
  return responder('place_block')(q,c);
 },'explicit');
 assert.equal(d.choice,'unresolved');assert.match(d.reason!,/withdrew.*blockItem/);
 assert.equal(calls.length,2);assert.equal(d.selected,undefined);
 assert.equal(Object.keys(calls[1].q.blockItem.criteria).length,fixture().placeableItems!.length+1);
});
test('explicit live contract binds low-confidence values without mandatory execution',async()=>{
 const d=await parameterSupervise(fixture(),input,async(q,c)=>{
  if(c.argumentName){const name=Object.keys(q)[0];const choice=Object.keys(q[name].criteria).find(k=>k.startsWith('value_')||k.startsWith('group_'))!;return {[name]:{type:'choice',choice,confidence:.01}};}
  return responder('place_block')(q,c);
 },'explicit');
 assert.equal(d.selected?.action,'place_block');assert.equal(d.confidence,.1);
});

test('runtime provider separates withdrawal while preserving coordinated review and selected destination',async()=>{
 for(const mode of ['separate','proposal'] as const)for(const withdraw of [false,true]){
  const calls:string[][]=[];
  const brain=new ApiBrain({...config(),mode:'jev',jevKey:'test-only-jev',argumentContract:'coordinated',withdrawalMode:mode},new Budget(20,2),(async(_url:any,init:any)=>{
   const body=JSON.parse(init.body),keys=Object.keys(body.questions);calls.push(keys);
   const sent=decodeReferenceRequest(body.state,body.questions).context;assert.ok(sent.lookFeedback);assert.equal(sent.movementEvidence,undefined);assert.match(sent.moveSemantics,/radius 2/);assert.deepEqual(sent.lookFeedback.recentLooks.map((r:any)=>r.id),[42]);
   return Response.json({answers:Object.fromEntries(keys.map(k=>[k,{type:'choice',confidence:.01,choice:k==='action'?'move':k==='review'?'none':k==='bindingDecision'?(withdraw?'withdraw':'bind'):Object.keys(body.questions[k].criteria).find(v=>v.startsWith('value_'))}])),usage:{input_tokens:100,output_tokens:0}});
  }) as typeof fetch);
  const state=fixture();state.vision!.blocks=[{name:"stone",position:{x:5,y:64,z:0},lastSeen:1}];state.places=[];
  const d=await brain.supervise(state,{...input,recentLookResults:[{id:42,outcome:'succeeded',view:{camera:{yawDeltaDegrees:0,pitchDeltaDegrees:0}}}]},new AbortController().signal);
  assert.equal(d.review,'none');assert.equal(calls[mode==='proposal'?2:1][0],'bindingDecision');
  if(withdraw){assert.equal(d.choice,'unresolved');assert.equal(d.selected,undefined);assert.equal(calls.length,mode==='proposal'?3:2);}
  else {assert.equal(d.selected?.action,'move');assert.deepEqual(d.selected?.plan.destination,{x:5,y:64,z:0});assert.equal(calls.length,3);}
 }
});

import {directSelection} from '../src/direct-selection.js';
test('direct selection applies the same no-extra-approval contract to all 17 actions',async()=>{
 for(const action of ['mine','move','craft','place_block','place_table','pickup','equip','eat','follow','attack','flee','look','give','inspect_container','deposit','withdraw']){
  const calls:any[]=[];const result=await parameterSupervise(fixture(),input,directSelection(responder(action,{},calls)));
  assert.equal(result.selected?.action,action);
  for(const call of calls)if(call.context.argumentName){assert.equal(call.questions.bindingDecision,undefined);for(const q of Object.values(call.questions)as any[]){assert.equal(q.criteria.none,undefined);assert.ok(q.criteria.revise);}}
 }
});
test('direct choice does not invent missing targets, accept unknown answers, or replace model angles',async()=>{
 const s=fixture();s.placementSites=[];await assert.rejects(parameterSupervise(s,input,directSelection(responder('place_block'))),/Invalid parameter selection/);
 await assert.rejects(directSelection(async()=>({x:{type:'choice',choice:'none',confidence:1}}))({x:{type:'choice',instructions:'',criteria:{none:'withdraw',value_0:'0'}}},{argumentName:'x'}),/Invalid direct/);
 const calls:any[]=[];const d=await parameterSupervise(fixture(),input,directSelection(async(q,c)=>{calls.push({q,c});return Object.fromEntries(Object.keys(q).map(k=>[k,{type:'choice',confidence:.01,choice:k==='action'?'look':k==='review'?'none':k==='yawDegrees'?(q[k].criteria.group_2?'group_2':'value_90'):'value_90'}]));}),'coordinated');
 assert.deepEqual(d.selected?.plan.look,{yaw:Math.PI/2,pitch:0});assert.equal(calls.length,4);assert.equal(calls.at(-1).c.boundArguments.yawDegrees,90);assert.match(calls.at(-1).c.argumentSemantics.pitchDegrees,/together/);
});

test('JEV wire preserves mining time estimates separately from observed completion',async()=>{
 const s=fixture(),motor={phase:'digging' as const,phaseElapsedMs:1100,estimatedDigMs:2250,estimatedRemainingMs:1150,digBudgetMs:5375,estimateCapped:false,blockBroken:false};let seen=false;
 const api=new ApiBrain({...config(),mode:'jev',targetPolicy:'observed',withdrawalMode:'direct',jevKey:'test'},new Budget(10,1),(async(_u:any,init:any)=>{
  const body=JSON.parse(init.body),wire=decodeReferenceRequest(body.state,body.questions);assert.deepEqual(wire.context.execution.motor,motor);seen=true;
  return Response.json({answers:Object.fromEntries(Object.keys(wire.questions).map(k=>[k,{type:'choice',choice:k==='action'?'continue':'none',confidence:1}])),usage:{input_tokens:1,output_tokens:0}});
 }) as typeof fetch);
 const out=await api.supervise(s,{...input,execution:{id:1,action:'mine',plan:{goal:'mine',preferred:'mine'},elapsedMs:1300,motor}},new AbortController().signal);
 assert.equal(seen,true);assert.equal(out.choice,'continue');
});

test('runtime stop cancels work without idle or automatic replacement; stale stop cannot cancel a new phase',async()=>{
 for(const stale of [false,true]){
  class W extends MockWorld{starts:string[]=[];phase:'digging'|'collecting'='digging';executionProgress(){return {phase:this.phase,phaseElapsedMs:1,blockBroken:false};}override async execute(a:any,signal:AbortSignal){this.starts.push(a);await delay(10000,undefined,{signal});return 'done';}}
  const w=new W();let n=0;const brain:Brain={parameterSelection:true,choose:new MockBrain().choose,plan:()=>new Promise(()=>{}),supervise:async()=>{if(++n===1)return {choice:'selected',confidence:1,review:'none',routes:{},selected:{id:'mine',action:'mine',plan:{goal:'wood',preferred:'mine',modelSelected:true,mine:{position:{x:1,y:64,z:0},expected:'oak_log',keepTool:true}}}};if(stale)w.phase='collecting';return {choice:'stop',confidence:1,review:'none',routes:{}};}};
  const runtime=new Runtime(w,brain,{planMs:30000,actionMs:10000,minConfidence:0,selectorMs:0},()=>{}),r=runtime as any;r.lastReady=true;r.lastLifeKey='true';
  try{await runtime.tick();await runtime.tick();assert.deepEqual(w.starts,['mine']);assert.equal(r.actionPending,stale);assert.equal(r.supervisorUrgent,true);}finally{runtime.close();await r.executionTask;}
 }
});

test('runtime rejects legacy wait and explicit idle without forcing replacement work',async()=>{
 for(const response of [{choice:'wait'},{choice:'selected',selected:{id:'old-idle',action:'idle' as const,plan:{goal:'wait',preferred:'idle' as const,waitMs:10000}}}]){
  class W extends MockWorld{starts=0;override async execute(){this.starts++;return 'unexpected';}}
  const w=new W();const brain:Brain={parameterSelection:true,choose:new MockBrain().choose,plan:()=>new Promise(()=>{}),supervise:async()=>({...response,confidence:1,review:'none',routes:{}})};
  const events:any[]=[];const runtime=new Runtime(w,brain,{planMs:30000,actionMs:10000,minConfidence:0,selectorMs:0},(event,data)=>events.push({event,data}));
  try{await runtime.tick();assert.equal(w.starts,0);assert.ok(events.some(e=>e.data?.reason==='intentional idle is not a selectable action'));}finally{runtime.close();}
 }
});

test('ApiBrain parallel look reaches executable plan in exactly two calls with full integer precision',async()=>{
 const calls:string[][]=[];const brain=new ApiBrain({...config(),mode:'jev',targetPolicy:'observed',argumentContract:'coordinated',withdrawalMode:'direct',lookBinding:'parallel-branches',jevKey:'test'},new Budget(5,1),(async(_url:any,init:any)=>{
  const p=JSON.parse(init.body),q=decodeReferenceRequest(p.state,p.questions).questions;calls.push(Object.keys(q));
  const answers=Object.fromEntries(Object.entries(q).map(([k,v]:[string,any])=>[k,{type:'choice',confidence:.01,choice:k==='action'?'look':k==='review'?'none':k==='yawSector'?'value_7':k==='pitchDegrees'?'value_53':k==='yawInSector7'?'value_359':Object.keys(v.criteria)[0]}]));
  return Response.json({answers,usage:{input_tokens:1,output_tokens:0}});
 }) as typeof fetch);
 const s=fixture(),d=await brain.supervise(s,input,new AbortController().signal);
 assert.equal(calls.length,2);assert.equal(calls[1].length,10);assert.equal(d.selected?.action,'look');assert.equal(d.selected?.plan.look?.yaw,359*Math.PI/180);assert.equal(d.selected?.plan.look?.pitch,-37*Math.PI/180);assert.ok(candidates(s,d.selected!.plan).includes('look'));
});

test('ApiBrain relative look executes the model-selected absolute target in two calls',async()=>{
 let count=0;const brain=new ApiBrain({...config(),mode:'jev',targetPolicy:'observed',argumentContract:'coordinated',withdrawalMode:'direct',lookBinding:'relative-branches',jevKey:'test'},new Budget(5,1),(async(_url:any,init:any)=>{
  const p=JSON.parse(init.body),q=decodeReferenceRequest(p.state,p.questions).questions;count++;
  // Heading rounds to 95: yaw359 is turn-96, in sector1, offset39.
  const answers=Object.fromEntries(Object.entries(q).map(([k,v]:[string,any])=>[k,{type:'choice',confidence:0,choice:k==='action'?'look':k==='review'?'none':k==='turnSector'?'value_1':k==='pitchDegrees'?'value_53':k==='exactTurn1'?'value_39':Object.keys(v.criteria)[0]}]));
  return Response.json({answers,usage:{input_tokens:1,output_tokens:0}});
 })as typeof fetch);
 const s=fixture();s.vision={...s.vision!,yaw:94.95*Math.PI/180,pitch:0};
 const d=await brain.supervise(s,input,new AbortController().signal);
 assert.equal(count,2);assert.equal(d.selected?.action,'look');assert.equal(d.selected?.plan.look?.yaw,359*Math.PI/180);assert.equal(d.selected?.plan.look?.pitch,-37*Math.PI/180);
});

test('small panorama movement domain bypasses region round while all coordinates remain model selectable',async()=>{
 const s=fixture();s.perception={mode:'panorama',range:48,occlusion:[],semantics:'fixture'};
 s.vision={yaw:0,pitch:0,blocks:[{name:'stone',position:{x:8,y:64,z:0},lastSeen:1},{name:'stone',position:{x:-8,y:64,z:0},lastSeen:1}]};s.places=[];s.navigationTargets=[];
 for(const x of [-8,8]){
  const calls:any[]=[];const d=await parameterSupervise(s,input,responder('move',{destination:(p:any)=>(p.position??p).x===x},calls),'coordinated');
  assert.equal(d.selected?.plan.destination?.x,x);
  assert.equal(calls.some(c=>c.questions.destinationRegion),false);
  assert.equal(calls.length,2);
 }
});

test('replacement argument latency overlaps running work; invalid replacement cannot stop it',async()=>{
 for(const valid of [true,false]){
  class W extends MockWorld{starts:string[]=[];override async execute(a:any,signal:AbortSignal){this.starts.push(a);await delay(10000,undefined,{signal});return 'done';}}
  const w=new W();w.state.observedDestinationKeys=['8,64,0'];w.state.vision!.blocks.push({name:'stone',position:{x:8,y:64,z:0},lastSeen:1});let n=0,finish!:(v:any)=>void;
  const brain:Brain={parameterSelection:true,choose:new MockBrain().choose,plan:()=>new Promise(()=>{}),supervise:async()=>{
   if(++n===1)return {choice:'selected',confidence:1,review:'none',routes:{},selected:{id:'mine',action:'mine',plan:{goal:'wood',preferred:'mine',modelSelected:true,mine:{position:{x:1,y:64,z:0},expected:'oak_log',keepTool:true}}}};
   return new Promise(resolve=>{finish=resolve;});
  }};
  const runtime=new Runtime(w,brain,{planMs:30000,actionMs:10000,minConfidence:0,selectorMs:0},()=>{}),r=runtime as any;r.lastReady=true;r.lastLifeKey='true';
  try{
   await runtime.tick();const pending=runtime.tick();await delay(20);
   assert.equal(r.actionPending,true);assert.deepEqual(w.starts,['mine']);
   finish(valid?{choice:'selected',confidence:1,review:'none',routes:{},selected:{id:'move',action:'move',plan:{goal:'relocate',preferred:'move',modelSelected:true,destination:{x:8,y:64,z:0}}}}:{choice:'unresolved',confidence:1,review:'none',routes:{},reason:'missing argument'});
   await pending;
   assert.equal(r.actionPending,true);assert.deepEqual(w.starts,valid?['mine','move']:['mine']);
  }finally{runtime.close();await r.executionTask;}
 }
});

test('equipment binds source item and destination in one argument call, preserving identical items and removals',async()=>{
 const s=fixture();s.inventory=Array.from({length:41},(_,i)=>({name:'iron_helmet',count:1,slot:i+5}));
 for(const [want,expected] of [[[44,'iron_helmet','default'],{item:'iron_helmet',destination:'head',sourceSlot:44}],[[-1,null,'off-hand'],{item:null,destination:'off-hand'}]] as const){
  const calls:any[]=[];
  const d=await parameterSupervise(s,input,responder('equip',{equipmentChange:v=>JSON.stringify(v)===JSON.stringify(want)},calls));
  assert.deepEqual(d.selected?.plan.equip,expected);assert.equal(calls.length,2);
  const q=calls[1].questions.equipmentChange;assert.ok(Object.keys(q.criteria).length<=255);
  assert.equal(Object.values(q.criteria).filter((v:any)=>typeof v==='object'&&v.value?.[1]==='iron_helmet'&&v.value?.[2]==='default').length,41);
 }
});

test('armor, ordinary hands and every removal bind in exactly two calls for all contracts',async()=>{
 const s=fixture();s.inventory=[{slot:9,name:'iron_helmet',count:1},{slot:10,name:'iron_chestplate',count:1},{slot:11,name:'iron_leggings',count:1},{slot:12,name:'iron_boots',count:1},{slot:13,name:'iron_sword',count:1},{slot:14,name:'bread',count:2},{slot:15,name:'elytra',count:1}];
 const cases:any[]=[[9,'iron_helmet','default','head'],[10,'iron_chestplate','default','torso'],[11,'iron_leggings','default','legs'],[12,'iron_boots','default','feet'],[13,'iron_sword','default','hand'],[14,'bread','off-hand','off-hand'],[15,'elytra','default','torso'],...['head','torso','legs','feet','hand','off-hand'].map(d=>[-1,null,d,d])];
 for(const contract of ['legacy','explicit','coordinated'] as const)for(const [slot,item,mode,destination] of cases){
  let count=0;const out=await parameterSupervise(s,input,async q=>{
   count++;return Object.fromEntries(Object.entries(q).map(([name,q])=>{
    const choice=name==='action'?'equip':name==='review'?'none':Object.entries(q.criteria).find(([,v])=>typeof v==='object'&&JSON.stringify(v.value)===JSON.stringify([slot,item,mode]))?.[0];
    assert.ok(choice);return [name,{type:'choice',choice,confidence:.01}];
   }));
  },contract);
  assert.equal(count,2);assert.deepEqual(out.selected?.plan.equip,{item,destination,...(slot<0?{}:{sourceSlot:slot})});
 }
});

test('equipment API adapter uses action then one complete change without a slot round',async()=>{
 const s=fixture();s.inventory=[{name:'iron_helmet',slot:9,count:1}];const calls:any[]=[];
 const respond=responder('equip',{equipmentChange:v=>v[0]===9&&v[2]==='default'},calls);
 const b=new ApiBrain({...config(),mode:'jev',targetPolicy:'observed',jevKey:'test',llmKey:'test',withdrawalMode:'direct'},new Budget(20,2),(async(_url:any,init:any)=>{
  const p=JSON.parse(init.body),decoded=decodeReferenceRequest(p.state,p.questions);
  return Response.json({answers:await respond(decoded.questions,decoded.context),usage:{input_tokens:1,output_tokens:0}});
 }) as typeof fetch);
 const out=await b.supervise(s,input,new AbortController().signal);
 assert.equal(calls.length,2);assert.deepEqual(out.selected?.plan.equip,{item:'iron_helmet',sourceSlot:9,destination:'head'});
});
