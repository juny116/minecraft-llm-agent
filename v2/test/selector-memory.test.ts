import test from 'node:test';import assert from 'node:assert/strict';
import {rememberedPlaces} from '../src/selector-memory.js';import {MockWorld} from '../src/mock.js';
import {ImportantPlaces,placeEvidence} from '../src/important-places.js';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {ApiBrain,Budget} from '../src/providers.js';import {config} from '../src/config.js';
function evidence(){const s=new MockWorld().snapshot();s.dimension='overworld';s.vision={yaw:0,pitch:0,blocks:[]};s.places=Array.from({length:20},(_,i)=>({name:'stone',position:{x:i,y:64,z:0},lastSeen:1}));return {s,ev:placeEvidence(s)};}
test('LLM selects importance and all curated coordinates are supplied without top-k',()=>{
 const {s,ev}=evidence(),m=new ImportantPlaces();assert.equal(rememberedPlaces(s).length,0);
 for(const group of [ev.slice(0,10),ev.slice(10)])m.apply(group.map(e=>({evidenceId:e.id,label:'Meeting point',reason:'Useful for rendezvous'})),ev);
 s.importantPlaces=m.snapshot();s.places=[];s.position={x:10000,y:64,z:10000};assert.equal(rememberedPlaces(s).length,20);assert.equal(placeEvidence(s).length,20);
});
test('unknown evidence and invalid batch cannot manufacture coordinates or partly update memory',()=>{
 const {ev}=evidence(),m=new ImportantPlaces();assert.throws(()=>m.apply([{evidenceId:ev[0].id,label:'Place',reason:'Useful'},{evidenceId:'invented',label:'Fake',reason:'No proof'}],ev),/Invalid place evidence/);assert.equal(m.snapshot().length,0);
});
test('same coordinate updates, changes and delayed evidence preserve history through reconnect',()=>{
 const dir=mkdtempSync(join(tmpdir(),'important-map-'));try{const file=join(dir,'map.json'),{s,ev}=evidence(),m=new ImportantPlaces(file,'test');
 m.apply([{evidenceId:ev[0].id,label:'Station',reason:'Return later'}],ev);s.vision!.blocks=[{...ev[0],name:'air',lastSeen:5}];m.observe(s);
 m.apply([{evidenceId:ev[0].id,label:'Former station',reason:'Historical landmark',importance:'archived'}],ev);m.flush(true);
 const restored=new ImportantPlaces(file,'test').snapshot();assert.equal(restored.length,1);assert.equal(restored[0].lastObservedBlock,'air');assert.equal(restored[0].status,'changed');assert.equal(restored[0].importance,'archived');assert.ok(JSON.parse(readFileSync(file,'utf8')).history.length>=3);
 s.dimension='the_nether';m.observe(s);assert.equal(m.snapshot()[0].dimension,'overworld');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('actual JEV receives all selected places but not raw annotation evidence',async()=>{
 const {s,ev}=evidence(),m=new ImportantPlaces();for(const e of ev)m.apply([{evidenceId:e.id,label:'Landmark',reason:'Useful'}],ev);s.importantPlaces=m.snapshot();s.placeEvidence=ev;
 const b=new ApiBrain({...config(),mode:'jev',jevKey:'test',llmKey:'test'},new Budget(1,1),(async(_url:any,init:any)=>{
  const body=JSON.parse(init.body);assert.equal(body.state.rememberedPlaces.length,20);assert.equal(body.state.observation.placeEvidence,undefined);assert.equal(body.state.observation.importantPlaces,undefined);
  return Response.json({answers:{action:{type:'choice',choice:'wait',confidence:1},review:{type:'choice',choice:'none',confidence:1}},usage:{input_tokens:1,output_tokens:0}});
 }) as typeof fetch);await b.supervise(s,{options:[],execution:null,inbox:[],goal:null},new AbortController().signal);
});
test('medium LLM receives place evidence and returns annotation patches without mandatory places',async()=>{
 const {s,ev}=evidence();s.placeEvidence=ev;s.importantPlaces=[];
 const b=new ApiBrain({...config(),targetPolicy:'observed',mode:'jev',jevKey:'test',llmKey:'test'},new Budget(1,1),(async(_url:any,init:any)=>{
  const body=JSON.parse(init.body);assert.match(body.messages[0].content,/You decide importance/);const input=JSON.parse(body.messages.at(-1).content);assert.equal(input.memory.placeEvidence.length,20);
  return Response.json({choices:[{message:{content:JSON.stringify({goal:'Explore',intent:{description:'Learn surroundings',desiredInventory:[],constraints:[]},proposals:[],placeUpdates:[{evidenceId:ev[0].id,label:'Meeting point',reason:'Useful for cooperation'}]})}}],usage:{prompt_tokens:1,completion_tokens:1}});
 }) as typeof fetch);
 const p=await b.plan(s,[],new AbortController().signal,null,{longTermGoal:'Explore'} as any);assert.equal(p.placeUpdates?.[0].evidenceId,ev[0].id);
});

import {Runtime} from '../src/runtime.js';import {MockBrain} from '../src/providers.js';import {setTimeout as delay} from 'node:timers/promises';
test('runtime applies accepted medium annotations and feeds the complete map to later decisions',async()=>{
 const w=new MockWorld();w.state.dimension='overworld';const m=new ImportantPlaces();(w as any).importantPlaces=m;
 const r=new Runtime(w,{choose:new MockBrain().choose,supervise:async()=>({choice:'wait',confidence:1,review:'none',routes:{}}),plan:async(s)=>({goal:'Explore',preferred:'look',intent:{description:'Explore',desiredInventory:[],constraints:[]},placeUpdates:[{evidenceId:s.placeEvidence![0].id,label:'Return point',reason:'Useful landmark'}]})},{planMs:30000,actionMs:1000,minConfidence:0},()=>{});
 const x=r as any;x.longGoal='Explore';x.options.goals=undefined;x.refreshMedium(x.observation(),Date.now());await delay(0);
 assert.equal(m.snapshot().length,1);assert.equal(x.observation().importantPlaces.length,1);assert.equal(r.plan.placeUpdates,undefined);r.close();
});
