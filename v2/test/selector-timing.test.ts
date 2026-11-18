import test from 'node:test';
import assert from 'node:assert/strict';
import {Runtime} from '../src/runtime.js';
import {MockWorld} from '../src/mock.js';
import {MockBrain} from '../src/providers.js';
import type {Brain} from '../src/types.js';
import type {Supervision} from '../src/supervision.js';
const answer=(choice:string):Supervision=>({choice,confidence:1,review:'none',routes:{}});
const startLook=():Supervision=>({...answer('selected'),selected:{id:'look',action:'look',plan:{goal:'observe',preferred:'look',look:{yaw:1,pitch:0},modelSelected:true}}});
class ControlledWorld extends MockWorld {
 finish!:()=>void; starts=0;
 override execute(_action:any,signal:AbortSignal){this.starts++;return new Promise<string>(resolve=>{this.finish=()=>resolve('done');signal.addEventListener('abort',()=>resolve('cancelled'),{once:true});});}
}
function fixture(supervise:NonNullable<Brain['supervise']>){
 const world=new ControlledWorld(),events:{event:string;data:any}[]=[];
 const brain:Brain={plan:()=>new Promise(()=>{}),choose:new MockBrain().choose,supervise};
 const runtime=new Runtime(world,brain,{planMs:30000,actionMs:10000,minConfidence:0,selectorMs:1000},(event,data)=>events.push({event,data}));
 const x=runtime as any;x.lastReady=true;x.lastLifeKey='true';
 return {world,runtime,x,events};
}
for(const choice of ['continue','stop'])test(`finished execution invalidates late ${choice} and wakes next tick`,async()=>{
 let resolve!:(d:Supervision)=>void,calls=0;
 const {world,runtime,x,events}=fixture(async()=>++calls===2?new Promise<Supervision>(r=>resolve=r):startLook());
 try {
  await runtime.tick();const t=Date.now();const pending=runtime.tick(t+1100);
  world.finish();await x.executionTask;resolve(answer(choice));await pending;
  assert.equal(world.starts,1);assert.ok(events.some(e=>e.event==='decision_discarded'&&e.data.reason==='execution already finished'));
  await runtime.tick(t+1101);assert.equal(calls,3);assert.equal(world.starts,2);
  const req=events.filter(e=>e.event==='supervisor_request'),res=events.filter(e=>e.event==='supervisor_response');assert.deepEqual(req.map(e=>e.data.requestId),res.map(e=>e.data.requestId));
 }finally{runtime.close();await x.executionTask;}
});
for(const action of ['look'] as const)test(`${action} completion wakes selection without truncating the running action`,async()=>{
 let calls=0;
 const {world,runtime,x}=fixture(async(_s,i)=>{calls++;return startLook();});
 runtime.plan={goal:'Observe',preferred:action};
 try {const t=Date.now();await runtime.tick(t);await runtime.tick(t+1);assert.equal(calls,1);assert.equal(world.starts,1);
 world.finish();await x.executionTask;await runtime.tick(t+2);assert.equal(calls,2);assert.equal(world.starts,2);
 }finally{runtime.close();await x.executionTask;}
});
test('pending selector stays single flight after action completion',async()=>{
 let resolve!:(d:Supervision)=>void,calls=0;
 const {world,runtime,x}=fixture(async()=>++calls===2?new Promise<Supervision>(r=>resolve=r):startLook());
 try {await runtime.tick();const pending=runtime.tick(Date.now()+1100);world.finish();await x.executionTask;await runtime.tick(Date.now()+1200);assert.equal(calls,2);resolve(answer('continue'));await pending;}
 finally{runtime.close();await x.executionTask;}
});
test('health lost while deciding discards an ordinary choice but not a response to the attacker',async()=>{
 const zombie={id:7,kind:'zombie',position:{x:1,y:64,z:0},distance:1};
 const pick=(action:'look'|'attack'):Supervision=>action==='look'?startLook():({...answer('selected'),selected:{id:'attack',action:'attack',plan:{goal:'fight',preferred:'attack',targetEntityId:7,modelSelected:true}}});
 for(const action of ['look','attack'] as const){
  let resolve!:(d:Supervision)=>void;
  const {world,runtime,x,events}=fixture(async()=>new Promise<Supervision>(r=>resolve=r));
  try{
   world.state.enemies=[zombie];const pending=runtime.tick();await new Promise(r=>setTimeout(r,0));
   world.state.health=17;resolve(pick(action));await pending;
   const discarded=events.some(e=>e.event==='decision_discarded'&&e.data.reason==='threat changed');
   assert.equal(discarded,action==='look');assert.equal(world.starts,action==='attack'?1:0);
  }finally{runtime.close();await x.executionTask;}
 }
});
