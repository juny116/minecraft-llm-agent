import test from 'node:test';import assert from 'node:assert/strict';
import {MockWorld} from '../src/mock.js';import {spatialContext,MAP_INPUT_BYTES,boundedSpatialContext} from '../src/spatial-context.js';
import {selectValue} from '../src/parameter-supervisor.js';import {workBlocks} from '../src/types.js';
test('irregular local terrain has bounded overview without mutating selectable blocks or revealing hidden cells',()=>{
 const s=new MockWorld().snapshot();s.position={x:0,y:64,z:0};s.perception={mode:'panorama',range:48};s.places=[];s.placementSites=[];
 s.vision={yaw:0,pitch:0,blocks:[]};for(let x=-11;x<=11;x++)for(let z=-11;z<=11;z++)for(let y=62;y<=69;y++)s.vision.blocks.push({name:(x+z+y)%2?'oak_log':'stone',position:{x,y,z},lastSeen:100+x+z+y});
 const before=structuredClone(workBlocks(s));const c=spatialContext(s);assert.ok(Buffer.byteLength(JSON.stringify(c))<=MAP_INPUT_BYTES);assert.ok(c.near.omitted>0);assert.deepEqual(workBlocks(s),before);assert.deepEqual(boundedSpatialContext(c),c);assert.ok(c.regions.every(g=>!g.materials.includes('diamond_block')));
 s.places.push(...Array.from({length:10000},(_,i)=>({name:'stone',position:{x:100+i,y:64,z:0},lastSeen:1})));assert.deepEqual(spatialContext(s),c);
});
test('every member of a large summarized domain is reachable, including late members; questions stay bounded',async()=>{
 const values=Array.from({length:513},(_,i)=>({name:i%2?'oak_log':'stone',position:{x:i,y:64,z:0},lastSeen:i}));
 for(let wanted=0;wanted<values.length;wanted++){
  let index=wanted;
  const selected=await selectValue('block',values,async(q)=>{
   assert.ok(Buffer.byteLength(JSON.stringify(q))<16000);const entries=Object.entries(q.block.criteria).filter(([id])=>id!=='none');let choice='';
   if(entries[0][0].startsWith('group_')){for(const [id,v] of entries){const x=v as any,n=x.summary?.count??x.values.length;if(index<n){choice=id;break;}index-=n;}}
   else choice=entries[index][0];
   return {block:{type:'choice',choice,confidence:1}};
  },{selectedAction:'mine'});
  assert.deepEqual(selected,values[wanted]);
 }
});
