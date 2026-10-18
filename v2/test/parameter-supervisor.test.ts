import {decodeJevState} from '../src/jev-state.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {parameterSupervise,selectValue,type Ask} from '../src/parameter-supervisor.js';
import {MockWorld} from '../src/mock.js';import {ApiBrain,Budget,MockBrain} from '../src/providers.js';import {config} from '../src/config.js';
import {candidates,type Brain,type Plan} from '../src/types.js';import {Runtime} from '../src/runtime.js';import {setTimeout as delay} from 'node:timers/promises';
const input={options:[],execution:null,inbox:[],goal:'Self chosen goal',parameterSelection:true};
function fixture(){const s=new MockWorld().snapshot();s.dimension='overworld';s.inventory=[{name:'chest',count:12,slot:9},{name:'bread',count:5,slot:10},{name:'iron_sword',count:1,slot:11}];s.edibleItems=['bread'];s.placeableItems=['chest','crafting_table'];s.placementSites=[{reference:{x:2,y:63,z:0},position:{x:2,y:64,z:0}}];s.nearbyPlayers=[{name:'Bob',position:{x:1,y:64,z:1}}];s.enemies=[{id:1,kind:'zombie',distance:2,position:{x:2,y:64,z:0}},{id:2,kind:'skeleton',distance:6,position:{x:6,y:64,z:0}}];s.craftable=Array.from({length:20},(_,i)=>'recipe_'+i);s.vision={yaw:0,pitch:0,blocks:[{name:'chest',position:{x:3,y:64,z:0},lastSeen:1},...Array.from({length:40},(_,i)=>({name:'oak_log',position:{x:i,y:66,z:0},lastSeen:1}))]};s.containers=[{position:{x:3,y:64,z:0},observedAt:1,items:[{name:'bread',count:5}]}];s.visibleItems=[{id:5,name:'bread',count:1,position:{x:1,y:64,z:1},distance:1} as any];s.navigationTargets=Array.from({length:20},(_,i)=>({x:i+5,y:64,z:0}));return s;}
function responder(action:string,select:Record<string,(v:any)=>boolean>={},record:any[]=[]):Ask{return async(questions,context)=>{record.push({questions,context});return Object.fromEntries(Object.entries(questions).map(([name,q])=>{
 let choice=name==='action'?action:name==='review'?'none':name.startsWith('message_')?'defer':undefined;
 if(!choice){const entries=Object.entries(q.criteria).filter(([k])=>k!=='none');const predicate=select[name]??(()=>true);choice=entries.find(([k,v])=>typeof v==='string'?(k.startsWith('group_')?JSON.parse(v).some((x:any)=>predicate(x.value)):predicate(JSON.parse(v))):(k.startsWith('group_')?v.values!.some(predicate):predicate(v.value)))?.[0]??'none';}
 return [name,{type:'choice',choice,confidence:.1}];}));};}
test('JEV selects previously truncated block, tool and duration without goal filtering',async()=>{const s=fixture();s.health=3;const d=await parameterSupervise(s,input,responder('mine',{block:b=>b.position.x===39,tool:t=>t.slot===11,attemptSeconds:n=>n===90}));assert.equal(d.selected?.plan.mine?.position.x,39);assert.equal(d.selected?.plan.mine?.tool,'iron_sword');assert.equal(d.selected?.plan.mine?.maxMs,90000);assert.ok(candidates(s,d.selected!.plan).includes('mine'));});
test('craft output beyond former eight-entry cap and non-unit count are model choices',async()=>{const d=await parameterSupervise(fixture(),input,responder('craft',{recipeOutput:v=>v==='recipe_19',recipeExecutions:n=>n===7}));assert.deepEqual(d.selected?.plan.craft,{item:'recipe_19',count:7});});
test('placement needs no LLM proposal; item and observed site are selected by JEV',async()=>{const d=await parameterSupervise(fixture(),input,responder('place_block'));assert.equal(d.selected?.plan.build?.item,'chest');assert.deepEqual(d.selected?.plan.build?.position,{x:2,y:64,z:0});});
test('all parameterized skills resolve observed arguments',async()=>{for(const action of ['move','place_table','pickup','equip','eat','follow','attack','flee','look','give','inspect_container','deposit','withdraw']){const d=await parameterSupervise(fixture(),input,responder(action));assert.equal(d.selected?.action,action,action);}});
test('target enemy and followed player are model choices rather than nearest/configured',async()=>{const d=await parameterSupervise(fixture(),input,responder('attack',{enemy:e=>e.id===2}));assert.equal(d.selected?.plan.targetEntityId,2);const f=await parameterSupervise(fixture(),input,responder('follow'));assert.equal(f.selected?.plan.followPlayer,'Bob');});
test('hierarchical transport keeps every argument reachable with at most 255 choices',async()=>{const calls:any[]=[];const v=await selectValue('number',Array.from({length:1000},(_,i)=>i),responder('wait',{number:n=>n===999},calls),{});assert.equal(v,999);assert.equal(calls.length,2);for(const c of calls)assert.ok(Object.keys(c.questions.number.criteria).length<=255);});
test('missing argument domain is explicit; no locally chosen fallback execution',async()=>{const s=fixture();s.placementSites=[];const d=await parameterSupervise(s,input,responder('place_block'));assert.equal(d.choice,'unresolved');assert.equal(d.selected,undefined);assert.match(d.reason!,/placementSite/);assert.equal(d.review,'medium');});
test('model-selected wait duration and maintain do not require unrelated arguments',async()=>{const calls:any[]=[];const d=await parameterSupervise(fixture(),input,responder('wait',{waitMilliseconds:n=>n===1700},calls));assert.equal(d.selected?.plan.waitMs,1700);const c=await parameterSupervise(fixture(),{...input,execution:{id:1,action:'mine',plan:{goal:'wood',preferred:'mine'},elapsedMs:1}},responder('continue',{},calls));assert.equal(c.choice,'continue');assert.equal(calls.length,3);});
test('actual API path performs action then conditional argument selection',async()=>{const s=fixture(),calls:any[]=[],respond=responder('craft',{recipeOutput:v=>v==='recipe_19',recipeExecutions:n=>n===4},calls);const b=new ApiBrain({...config(),mode:'jev',targetPolicy:'observed',jevKey:'test',llmKey:'test'},new Budget(20,2),(async(_url:any,init:any)=>{const p=JSON.parse(init.body);return Response.json({answers:await respond(p.questions,decodeJevState(p.state)),usage:{input_tokens:1,output_tokens:0}});}) as typeof fetch);assert.equal(b.parameterSelection,true);const d=await b.supervise(s,input,new AbortController().signal);assert.equal(d.selected?.plan.craft?.count,4);assert.equal(calls.length,3);assert.equal(calls[2].context.boundArguments.recipeOutput,'recipe_19');});
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
 const d=await parameterSupervise({...fixture(),placementSites:[]},{...input,execution:{id:7,action:'mine',plan:{goal:'wood',preferred:'mine'},elapsedMs:100}},responder('place_block'));assert.equal(d.choice,'unresolved');assert.equal(d.selected,undefined);
});
test('changed enemy identity is not silently replaced by another visible target',async()=>{const s=fixture(),d=await parameterSupervise(s,input,responder('attack',{enemy:e=>e.id===2}));s.enemies=s.enemies!.filter(e=>e.id!==2);assert.ok(!candidates(s,d.selected!.plan).includes('attack'));});

import {combat,type CombatPort} from '../src/combat.js';
test('combat motor honors chosen target and leaves low-health strategy to model',async()=>{
 let time=0;const hits:number[]=[];const port:CombatPort={observe:()=>({health:3,position:{x:0,y:0,z:0},enemies:[{id:1,kind:'zombie',distance:1,position:{x:1,y:0,z:0}},{id:2,kind:'skeleton',distance:2,position:{x:2,y:0,z:0}}]}),equipWeapon:async()=>{},cooldownMs:()=>700,approach:()=>{},strike:async id=>{hits.push(id);return true;},retreat:()=>true,stop:()=>{},wait:async ms=>{time+=ms;},now:()=>time};
 const result=await combat(port,'attack',new AbortController().signal,{targetId:2,modelSelected:true});assert.equal(result.targetId,2);assert.equal(result.outcome,'time_limit');assert.deepEqual(hits,[2,2,2,2]);
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
 assert.deepEqual(d.attempt,{action:'place_block',boundArguments:{blockItem:'chest'},unresolvedArgument:{name:'placementSite',availableValues:1}});
});
test('LLM planning sees unexecuted JEV evidence, retained across generic reconsideration',async()=>{
 const world=new MockWorld();let i=0;
 const brain:Brain={parameterSelection:true,choose:new MockBrain().choose,plan:()=>new Promise(()=>{}),supervise:async()=>({choice:'unresolved',confidence:.5,review:'medium',routes:{},reason:++i===1?'No suitable placementSite':'Model requested planning',...(i===1?{attempt:{action:'place_block' as const,boundArguments:{blockItem:'chest'},unresolvedArgument:{name:'placementSite',availableValues:3}}}:{})})};
 const r=new Runtime(world,brain,{planMs:30000,actionMs:10000,minConfidence:0,selectorMs:0},()=>{});const x=r as any;x.lastReady=true;x.lastLifeKey='true';
 try{await r.tick();const first=r.planning.selectorFeedback;assert.ok(first?.includes('placementSite'));assert.ok(first?.includes('chest'));await r.tick();assert.equal(r.planning.selectorFeedback,first);assert.equal(r.planning.recentActions.length,0);}finally{r.close();}
});

test('destination candidates retain reached cells and expose exact motor arrival semantics',async()=>{
 const s=fixture();s.position={x:-1.5,y:64,z:-1.5};s.navigationTargets=[{x:-2,y:65,z:-3},{x:8,y:64,z:0}];const calls:any[]=[];
 const d=await parameterSupervise(s,input,responder('move',{destination:p=>p.x===-2},calls));
 assert.deepEqual(d.selected?.plan.destination,{x:-2,y:65,z:-3}); // model may still choose it
 const q=calls.find(c=>c.questions.destination);assert.ok(q.context.argumentSemantics.alreadyWithinArrivalRadius.some((p:any)=>p.x===-2&&p.y===65&&p.z===-3));assert.equal(q.context.argumentSemantics.arrivalRadiusBlocks,2);
 assert.ok(!candidates(s,d.selected!.plan).includes('move'));
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
 for(const withdraw of [false,true]){
  const calls:string[][]=[];
  const brain=new ApiBrain({...config(),mode:'jev',jevKey:'test-only-jev',argumentContract:'coordinated',withdrawalMode:'separate'},new Budget(20,2),(async(_url:any,init:any)=>{
   const body=JSON.parse(init.body),keys=Object.keys(body.questions);calls.push(keys);
   return Response.json({answers:Object.fromEntries(keys.map(k=>[k,{type:'choice',confidence:.01,choice:k==='action'?'move':k==='review'?'none':k==='bindingDecision'?(withdraw?'withdraw':'bind'):Object.keys(body.questions[k].criteria).find(v=>v.startsWith('value_'))}])),usage:{input_tokens:100,output_tokens:0}});
  }) as typeof fetch);
  const state=fixture();state.vision!.blocks=[];state.places=[];
  const d=await brain.supervise(state,input,new AbortController().signal);
  assert.equal(d.review,'none');assert.equal(calls[1][0],'bindingDecision');
  if(withdraw){assert.equal(d.choice,'unresolved');assert.equal(d.selected,undefined);assert.equal(calls.length,2);}
  else {assert.equal(d.selected?.action,'move');assert.deepEqual(d.selected?.plan.destination,{x:5,y:64,z:0});assert.equal(calls.length,3);}
 }
});
