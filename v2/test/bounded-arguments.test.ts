import test from 'node:test';import assert from 'node:assert/strict';
import {MockWorld} from '../src/mock.js';import {parameterSupervise,type Ask} from '../src/parameter-supervisor.js';
import {directSelection} from '../src/direct-selection.js';import {actionDomains,actionScopes} from '../src/action-domains.js';
import {localDomain,cellCenter,cellKey} from '../src/local-domain.js';import {placementDomain} from '../src/map-regions.js';
import {currentModelState} from '../src/selector-context.js';
const input:any={options:[],execution:null,inbox:[],goal:'Test supplied arguments',parameterSelection:true};
export function fixture(){
 const s=new MockWorld().snapshot();s.position={x:.5,y:64,z:.5};s.dimension='overworld';s.perception={mode:'panorama',range:48};s.places=[];
 s.vision={yaw:0,pitch:0,blocks:[{name:'oak_log',position:{x:5,y:64,z:0},lastSeen:1},{name:'crafting_table',position:{x:3,y:64,z:1},lastSeen:1},{name:'chest',position:{x:4,y:64,z:1},lastSeen:1},{name:'furnace',position:{x:4,y:64,z:2},lastSeen:1},{name:'stone',position:{x:2,y:63,z:0},lastSeen:1}]};
 s.inventory=[{slot:9,name:'oak_planks',count:8},{slot:10,name:'bread',count:3},{slot:11,name:'iron_pickaxe',count:1}];s.placeableItems=['oak_planks'];s.edibleItems=['bread'];s.craftable=['wooden_pickaxe'];s.inventoryCraftable=[];
 s.placementSites=[{position:{x:2,y:64,z:0},reference:{x:2,y:63,z:0}}];s.visibleItems=[{id:7,name:'oak_log',count:1,position:{x:4,y:64,z:0}}];
 s.nearbyPlayers=[{name:'Bob',position:{x:3,y:64,z:0}}];s.enemies=[{id:12,kind:'zombie',distance:4,position:{x:4,y:64,z:0}}];
 s.containers=[{position:{x:4,y:64,z:1},observedAt:1,items:[{name:'oak_log',count:7},{name:'stone',count:2}]},{position:{x:4,y:64,z:2},observedAt:1,items:[],slots:{input:{name:'raw_iron',count:3},fuel:{name:'coal',count:4},output:{name:'iron_ingot',count:2}}}];return s;
}
function responder(action:string,trace:any[],choose:(name:string,v:any)=>boolean=()=>true):Ask{return async(q,c)=>{
 trace.push({q,c});return Object.fromEntries(Object.entries(q).map(([name,q])=>{
 assert.ok(Object.keys(q.criteria).length<=255);assert.ok(!Object.keys(q.criteria).some(k=>k.startsWith('group_')));
 const choice=name==='action'?action:name==='review'?'none':Object.entries(q.criteria).find(([k,v])=>k.startsWith('value_')&&choose(name,typeof v==='string'?JSON.parse(v):v.value))?.[0];assert.ok(choice,'no value for '+name);
 return [name,{type:'choice',choice,confidence:.01}];
 }));};}
test('all live actions have two or three rounds, with coherent dependent fields',async()=>{
 for(const [action,rounds] of [['move',2],['mine',3],['place_block',2],['craft',3],['pickup',2],['equip',2],['eat',2],['follow',2],['attack',2],['flee',2],['give',3],['inspect_container',2],['deposit',3],['withdraw',3]] as const){
  const trace:any[]=[];const s=fixture();const out=await parameterSupervise(s,input,directSelection(responder(action,trace)),'coordinated');
  assert.equal(out.choice,'selected',action+': '+out.reason);assert.equal(trace.length,rounds,action);
  assert.ok(trace[0].c.actionScopes);assert.ok(trace[1].c.flatArguments);assert.ok(!trace.some(t=>t.q.blockRegion||t.q.destinationRegion||t.q.placementRegion));
  if(action==='craft'){assert.ok(trace[2].q.recipeExecutions&&trace[2].q.workstation);assert.equal(out.selected?.plan.craft?.item,'wooden_pickaxe');}
 }
});
test('container item/slot and conditional count agree for chest and furnace',async()=>{
 for(const kind of ['chest','furnace'])for(const action of ['deposit','withdraw']){
  const trace:any[]=[];const out=await parameterSupervise(fixture(),input,directSelection(responder(action,trace,(name,v)=>{
   if(name==='container')return v.name===kind;
   if(name==='transferSource')return action==='deposit'?v.item==='bread':kind==='chest'?v.item==='stone':v.slot==='output';
   if(name.startsWith('count_if_'))return v===(name.includes('iron_pickaxe')?1:2);return true;
  })),'coordinated');assert.equal(trace.length,3);assert.equal(out.selected?.plan.transfer?.count,2);
  assert.equal(out.selected?.plan.transfer?.item,action==='deposit'?'bread':kind==='chest'?'stone':'iron_ingot');
  if(kind==='furnace')assert.equal(out.selected?.plan.transfer?.slot,action==='deposit'?'input':'output');
 }
});
test('dense spatial domains shrink whole radii, preserve every inside target, and do not rank material or direction',()=>{
 const points=[];for(let x=-12;x<=12;x++)for(let y=-4;y<=4;y++)for(let z=-12;z<=12;z++)points.push({x,y,z});
 const origin={x:.5,y:1.62,z:.5};const a=localDomain(points,origin,cellCenter,cellKey);const b=localDomain([...points].reverse(),origin,cellCenter,cellKey);
 assert.ok(a.scope.radiusBlocks<12);assert.ok(a.values.length<=254);assert.deepEqual(a.scope,b.scope);
 const expected=points.filter(p=>Math.hypot(p.x+.5-origin.x,p.y+.5-origin.y,p.z+.5-origin.z)<=a.scope.radiusBlocks).map(cellKey).sort();
 assert.deepEqual(a.values.map(cellKey).sort(),expected);assert.deepEqual(b.values.map(cellKey).sort(),expected);
});
test('duplicate support faces do not consume distinct placement choices; far memory remains in model input',()=>{
 const s=fixture();s.placementSites!.push({position:{x:2,y:64,z:0},reference:{x:3,y:64,z:0}});s.vision!.blocks.push({name:'stone',position:{x:3,y:64,z:0},lastSeen:1});
 assert.equal(placementDomain(s).values.length,1);
 s.importantPlaces=[{id:'far',dimension:'overworld',position:{x:100,y:64,z:100},label:'Base',reason:'Known',importance:'active',registeredBlock:'stone',lastObservedBlock:'stone',lastSeen:1,evidenceId:'old',status:'historical'}];
 const state=currentModelState(s);assert.deepEqual(state.actionScopes,actionScopes(s));assert.equal(state.importantPlaces?.length,1);assert.ok(!actionDomains(s).move.values.some(p=>p.x===100));assert.deepEqual(currentModelState(state),state);
});
test('over-cap nonspatial input fails explicitly instead of dropping candidates or adding rounds',async()=>{
 const s=fixture();s.craftable=Array.from({length:255},(_,i)=>'recipe_'+i);const trace:any[]=[];
 const out=await parameterSupervise(s,input,directSelection(responder('craft',trace)),'coordinated');assert.equal(trace.length,1);assert.equal(out.choice,'unresolved');assert.match(out.reason!,/exceeding 254/);
});

test('medium and long LLM requests receive the same numeric scopes as action selection',async()=>{
 const {ApiBrain,Budget}=await import('../src/providers.js');const {config}=await import('../src/config.js');
 const s=fixture(),expected=actionScopes(s);let calls=0;
 const b=new ApiBrain({...config(),targetPolicy:'observed',mode:'jev',llmKey:'test'},new Budget(2,1),(async(_url:any,init:any)=>{
  const body=JSON.parse(init.body),request=JSON.parse(body.messages.at(-1).content);calls++;
  assert.deepEqual(request.state.actionScopes,expected);
  if(calls===1){assert.deepEqual(request.actionCapabilities.localSelection,expected);assert.match(body.messages[0].content,/outside that scope require move/);}
  return Response.json({choices:[{message:{content:JSON.stringify(calls===1?{goal:'Explore',intent:{description:'Choose a local step toward the known site',desiredInventory:[],constraints:[]},proposals:[]}:{goalUpdates:[],activeGoalId:'existing_goal',userRequestStatus:{status:'in_progress',reason:'Test fixture'},noGoalReason:'Test only'})}}],usage:{prompt_tokens:1,completion_tokens:1}});
 }) as typeof fetch);
 await b.plan(s,[],new AbortController().signal,null,{longTermGoal:'Explore'} as any);
 await b.reviewGoals(s,{} as any,new AbortController().signal);assert.equal(calls,2);
});

test('oversized batched field is rejected before any partial argument request is sent',async()=>{
 const s=fixture();s.placeableItems=Array.from({length:255},(_,i)=>'block_'+i);const trace:any[]=[];
 const out=await parameterSupervise(s,input,directSelection(responder('place_block',trace)),'coordinated');
 await new Promise(resolve=>setTimeout(resolve,0));assert.equal(trace.length,1);assert.equal(out.choice,'unresolved');assert.match(out.reason!,/no partial request/);
});
