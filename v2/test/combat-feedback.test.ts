import test from 'node:test';
import assert from 'node:assert/strict';
import {IncomingDamage} from '../src/incoming-damage.js';
import {chooseCombat} from '../src/combat-decision.js';
import {MockWorld} from '../src/mock.js';
import {ApiBrain,Budget} from '../src/providers.js';
import {config} from '../src/config.js';
import {Runtime} from '../src/runtime.js';
test('own health loss and visible attacker are distinct bounded facts',()=>{
 const m=new IncomingDamage();m.health(20,0);m.hit(1,{id:3,kind:'zombie'});m.health(18.62,2);
 const e=m.snapshot(3);assert.equal(e.length,2);assert.deepEqual(e[0],{at:1,type:'hit',attacker:{id:3,kind:'zombie'}});
 assert.equal(e[1].type,'health_loss');m.health(20,4);assert.equal(m.snapshot(5).length,2);
 m.hit(6);assert.deepEqual(m.snapshot(6)[2],{at:6,type:'hit',attacker:null});assert.equal(m.snapshot(20000).length,0);
 for(let i=0;i<30;i++)m.hit(i);assert.equal(m.snapshot(30).length,16);m.clear();assert.equal(m.snapshot(30).length,0);
});
function setup(){const w=new MockWorld();w.state.enemies=[{id:1,kind:'zombie',position:{x:3,y:0,z:0},distance:3}];return w;}
test('real request contract has no idle preference; low confidence valid attack is returned for execution',async()=>{
 const w=setup();w.state.incomingDamage=[{at:10,type:'hit',attacker:null}];let calls=0;
 const brain=new ApiBrain({...config(),mode:'jev',jevKey:'fake'},new Budget(4,.01),(async(_url:any,init:any)=>{
  calls++;const b=JSON.parse(init.body);assert.equal('preferred' in b.state.plan,false);assert.deepEqual(b.state.observation.incomingDamage,w.state.incomingDamage);
  return Response.json({answers:{action:{type:'choice',choice:'attack',confidence:.01}},usage:{input_tokens:1,output_tokens:0}});
 }) as typeof fetch);
 const r=await chooseCombat({snapshot:()=>w.snapshot(),brain,exhausted:()=>false,signal:new AbortController().signal,minConfidence:.55,log:()=>{}});
 assert.equal(r?.choice.action,'attack');assert.equal(calls,1);
});
test('stale invisible target still prevents execution regardless of confidence',async()=>{
 const w=setup();const r=await chooseCombat({snapshot:()=>w.snapshot(),brain:{choose:async()=>{w.state.enemies=[];return {action:'attack',confidence:1};}},exhausted:()=>false,signal:new AbortController().signal,minConfidence:.55,log:()=>{}});assert.equal(r,undefined);
});
test('runtime executes legal low-confidence action instead of skipping it',async()=>{
 const w=setup();let executed='';w.execute=async a=>{executed=a;return 'ok';};
 const r=new Runtime(w,{plan:()=>new Promise(()=>{}),choose:async()=>({action:'flee',confidence:.01})},{planMs:30000,actionMs:5000,minConfidence:.55},()=>{});
 await r.tick();assert.equal(executed,'flee');r.close();
});

test('planning journal preserves incoming events as evidence after the live window expires',async()=>{
 const {compact}=await import('../src/planning.js');const w=setup();w.state.incomingDamage=[{at:10,type:'hit',attacker:null}];
 const saved=compact(w.snapshot());w.state.incomingDamage=[];assert.equal(saved.incomingDamage.length,1);
});
