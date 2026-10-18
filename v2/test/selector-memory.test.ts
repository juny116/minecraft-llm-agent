import test from 'node:test';import assert from 'node:assert/strict';
import {rememberedPlaces} from '../src/selector-memory.js';import {MockWorld} from '../src/mock.js';
import {SpatialMemory} from '../src/spatial-memory.js';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
test('bounded retrieval preserves unseen workstation memory without pretending visibility',()=>{
 const s=new MockWorld().snapshot();s.vision={yaw:0,pitch:0,blocks:[]};
 s.places=Array.from({length:128},(_,i)=>({name:'oak_leaves',position:{x:i,y:64,z:0},lastSeen:100}));s.places.push({name:'crafting_table',position:{x:90,y:64,z:5},lastSeen:1});
 const before=JSON.stringify(s),selected=rememberedPlaces(s,{goal:'Craft tools',preferred:'craft'});
 assert.equal(selected.length,8);assert.equal(selected[0].name,'crafting_table');assert.equal(selected[0].lastSeen,1);assert.equal(selected[0].status,'historical_not_currently_visible');assert.equal(JSON.stringify(s),before);
 s.vision.blocks=[s.places.at(-1)!];assert.ok(!rememberedPlaces(s).some(b=>b.name==='crafting_table'));
});
test('newer same-cell observation supersedes historical workstation and memory survives reload',()=>{
 const dir=mkdtempSync(join(tmpdir(),'selector-memory-'));try{const file=join(dir,'places.json'),m=new SpatialMemory(file,'test'),s=new MockWorld().snapshot();
 s.vision={yaw:0,pitch:0,blocks:[]};
 const table={name:'crafting_table',position:{x:3,y:64,z:0},lastSeen:1};m.update('overworld',[table],[]);m.flush(true);s.places=new SpatialMemory(file,'test').get('overworld').places;
 assert.ok(rememberedPlaces(s).some(b=>b.name==='crafting_table'));
 s.places.push({...table,name:'air',lastSeen:2});assert.ok(!rememberedPlaces(s).some(b=>b.name==='crafting_table'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

import {ApiBrain,Budget} from '../src/providers.js';import {config} from '../src/config.js';
test('actual JEV payload includes bounded historical places and separately dated recent results',async()=>{
 const s=new MockWorld().snapshot();s.vision={yaw:0,pitch:0,blocks:[]};s.places=[{name:'crafting_table',position:{x:9,y:64,z:0},lastSeen:1}];
 const recentResults=[{id:7,endedAt:2,action:'place_table',outcome:'succeeded',result:'placed',changes:{}}];
 const b=new ApiBrain({...config(),mode:'jev',jevKey:'test',llmKey:'test'},new Budget(1,1),(async(_url:any,init:any)=>{
  const body=JSON.parse(init.body);assert.equal(body.state.rememberedPlaces[0].name,'crafting_table');assert.equal(body.state.rememberedPlaces[0].status,'historical_not_currently_visible');assert.deepEqual(body.state.recentResults,recentResults);assert.equal(body.state.observation.vision.blocks.length,0);
  return Response.json({answers:{action:{type:'choice',choice:'wait',confidence:1},review:{type:'choice',choice:'none',confidence:1}},usage:{input_tokens:1,output_tokens:0}});
 }) as typeof fetch);
 await b.supervise(s,{options:[],execution:null,inbox:[],goal:null,recentResults},new AbortController().signal);
});
