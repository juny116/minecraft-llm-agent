import test from 'node:test';import assert from 'node:assert/strict';
import {MockWorld} from '../src/mock.js';
import {currentModelState,selectorContext,feedbackView} from '../src/selector-context.js';
import {moveDomain} from '../src/action-contracts.js';
import {placeEvidence} from '../src/important-places.js';
import {referenceRequest,decodeReferenceRequest} from '../src/jev-references.js';
import {parameterSupervise} from '../src/parameter-supervisor.js';
const input={options:[],execution:null,inbox:[],goal:null,parameterSelection:true};
const clean=(x:any)=>JSON.parse(JSON.stringify(x));
function fixture(){const s=new MockWorld().snapshot();s.dimension='overworld';s.position={x:0,y:64,z:0};s.vision={yaw:0,pitch:0,blocks:[{name:'stone',position:{x:8,y:64,z:0},lastSeen:1}]};s.navigationTargets=[];s.importantPlaces=[{id:'base',dimension:'overworld',position:{x:1000,y:64,z:2},label:'Base',reason:'Own chosen landmark',importance:'active',registeredBlock:'crafting_table',lastObservedBlock:'crafting_table',lastSeen:1,evidenceId:'original',status:'historical'}];return s;}
test('ordinary map growth cannot enlarge selector context or choices; all landmarks remain',()=>{
 const s=fixture();s.places=[];const before=clean(selectorContext(s,input,{})),domain=moveDomain(s);
 s.places=Array.from({length:10000},(_,i)=>({name:'dirt',position:{x:i+100,y:62,z:80},lastSeen:i}));
 s.navigationTargets=[{x:110,y:62,z:80}];
 assert.deepEqual(clean(selectorContext(s,input,{})),before);assert.deepEqual(moveDomain(s),domain);
 assert.equal(currentModelState(s).places!.length,0);assert.equal(s.places.length,10000);
 assert.equal(placeEvidence(s).length,2);assert.ok(domain.eligible.some(p=>p.x===1000));
});
test('factual feedback groups equal receipts without turning them into behavioral rules',()=>{
 const f=JSON.stringify({reason:'Destination reached during selection',selected:{action:'move',plan:{goal:'large prose'}}});
 const view=feedbackView({history:[{id:1,at:1,status:'reviewed',feedback:f},{id:2,at:2,status:'reviewed',feedback:f}],current:{id:3,at:3,status:'unreviewed',feedback:f},total:3,omittedHistoryCount:0});
 assert.equal(view.entries.length,2);assert.equal(view.entries[0].count,2);assert.deepEqual(view.entries[0].ids,[1,2]);assert.equal(view.entries[1].status,'unreviewed');assert.ok(!JSON.stringify(view).includes('large prose'));
});
test('shared object references preserve every observed target and arbitrary coordinates exactly',()=>{
 const s=fixture(),context=selectorContext(s,input,{}),b=s.vision!.blocks[0];
 const questions={block:{type:'choice',instructions:'Choose',criteria:{a:{description:'Target',value:b},b:{description:'Coordinate',value:b.position},withdraw:'Withdraw'}}};
 const wire=referenceRequest(context,questions),decoded=decodeReferenceRequest(wire.state,wire.questions);
 assert.deepEqual(decoded.context,clean(context));assert.deepEqual(decoded.questions,questions);
 assert.ok(JSON.stringify(wire.questions).includes('$entity'));assert.ok(!JSON.stringify(wire.questions).includes('"lastSeen"'));
});
test('current terrain IDs resolve through actual model-selection transport to unchanged executable parameters',async()=>{
 const s=fixture();const d=await parameterSupervise(s,input,async(q,c)=>{
  const full=selectorContext(s,input,c),wire=referenceRequest(full,q),restored=decodeReferenceRequest(wire.state,wire.questions);
  assert.deepEqual(restored.questions,clean(q));assert.deepEqual(restored.context,clean(full));
  return Object.fromEntries(Object.entries(restored.questions).map(([k,v]:any)=>[k,{type:'choice',confidence:.1,choice:k==='action'?'move':k==='review'?'none':Object.keys(v.criteria).find(k=>k.startsWith('value_'))}]));
 },'coordinated');assert.deepEqual(d.selected!.plan.destination,{x:8,y:64,z:0});
});
test('reference decoder rejects unresolved references rather than inventing coordinates',()=>{
 assert.throws(()=>decodeReferenceRequest({entityTable:{},x:{$entity:'missing'}},{}),/Invalid entity reference/);
});
test('complete guidebook is visible without raw evidence, matching scope is left to the model',()=>{
 const s=fixture();s.memoryGuidance=Array.from({length:12},(_,i)=>({id:'g'+i,status:'active',version:1,updatedAt:1,model:'fake',text:'Conditional advice',uncertainty:'Tentative',scope:{action:'eat',food:[0,2],health:[0,20],species:[],equipment:[]},support:['raw-episode'],counterexamples:[]})) as any;
 const c=selectorContext(s,input,{});assert.equal(c.guidance.length,12);assert.ok(!JSON.stringify(c.guidance).includes('raw-episode'));assert.equal(c.guidance[0].scope.food![1],2);
});
