import test from 'node:test';import assert from 'node:assert/strict';import {parameterSupervise,type Ask} from '../src/parameter-supervisor.js';import {directSelection} from '../src/direct-selection.js';import {MockWorld} from '../src/mock.js';
const input:any={options:[],inbox:[],goal:null,parameterSelection:true};
function state(){const s=new MockWorld().snapshot();s.inventory=[{name:'oak_planks',count:3,slot:9,type:1}] as any;s.placeableItems=['oak_planks','dirt'];s.placementSites=[{position:{x:2,y:64,z:0},reference:{x:2,y:63,z:0}}];s.vision={yaw:0,pitch:0,blocks:[{name:'chest',position:{x:3,y:64,z:0},lastSeen:1}]};return s;}
function fake(action:string,trace:string[][]):Ask{return async(q)=>{trace.push(Object.keys(q));return Object.fromEntries(Object.entries(q).map(([k,v])=>[k,{type:'choice',confidence:.2,choice:k==='action'?action:k==='review'?'none':Object.keys(v.criteria).find(x=>x.startsWith('value_')||x.startsWith('group_'))}]));};}
test('independent placement gives identical parameters with 2 calls instead of 3',async()=>{
 const outcomes=[];for(const mode of ['sequential','independent'] as const){const trace:string[][]=[];outcomes.push(await parameterSupervise(state(),input,directSelection(fake('place_block',trace)),'coordinated','parallel-branches',mode));assert.equal(trace.length,mode==='independent'?2:3);if(mode==='independent')assert.deepEqual(trace[1],['blockItem','placementSite']);}assert.deepEqual(outcomes[0],outcomes[1]);
});
test('deposit batches container and item but quantity domain follows chosen inventory',async()=>{
 const trace:string[][]=[];const base=fake('deposit',trace);const ask:Ask=async(q,c)=>{if(q.count)assert.equal(Object.keys(q.count.criteria).length,3);return base(q,c);};const out=await parameterSupervise(state(),input,directSelection(ask),'coordinated','parallel-branches','independent');assert.equal(trace.length,3);assert.deepEqual(trace[1],['container','item']);assert.equal(out.selected?.plan.transfer?.count,1);
});
test('paging remains complete while independent short field binds once',async()=>{
 const s=state();s.placementSites=Array.from({length:40},(_,i)=>({position:{x:i,y:64,z:0},reference:{x:i,y:63,z:0}}));const trace:string[][]=[];const out=await parameterSupervise(s,input,directSelection(fake('place_block',trace)),'coordinated','parallel-branches','independent');assert.equal(trace.length,3);assert.deepEqual(trace[2],['placementSite']);assert.deepEqual(out.selected?.plan.build?.position,{x:0,y:64,z:0});
});
test('empty independent domain dispatches no argument request and no local substitute',async()=>{
 const s=state();s.placementSites=[];const trace:string[][]=[];const out=await parameterSupervise(s,input,directSelection(fake('place_block',trace)),'coordinated','parallel-branches','independent');assert.equal(trace.length,1);assert.equal(out.choice,'unresolved');assert.equal(out.selected,undefined);
});
test('furnace keeps container and slot dependencies instead of batching an incompatible item',async()=>{
 const s=state();s.vision!.blocks[0].name='furnace';const trace:string[][]=[];await parameterSupervise(s,input,directSelection(fake('deposit',trace)),'coordinated','parallel-branches','independent');assert.deepEqual(trace,[['action','review'],['container'],['containerSlot'],['item'],['count']]);
});
