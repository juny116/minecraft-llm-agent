import test from 'node:test';
import assert from 'node:assert/strict';
import {combat, type CombatPort, type Enemy} from '../src/combat.js';
import {candidates} from '../src/types.js';
import {MockWorld} from '../src/mock.js';
import {ApiBrain,Budget} from '../src/providers.js';
import {config} from '../src/config.js';
import {MineflayerWorld} from '../src/mineflayer.js';
function fixture(){
 let time=0, strikes:number[]=[],stops=0;
 const state={health:20,position:{x:0,y:0,z:0},enemies:[{id:1,kind:'zombie',position:{x:0,y:0,z:-2},distance:2}] as Enemy[]};
 const port:CombatPort={observe:()=>state,equipWeapon:async()=>{},cooldownMs:()=>700,approach:()=>{},strike:async()=>{strikes.push(time);return true;},retreat:()=>true,stop:()=>{stops++;},wait:async ms=>{time+=ms;},now:()=>time};
 return {port,state,strikes,stops:()=>stops};
}
test('attacks use local cooldown, terminate after a bounded interval, and do not claim kills',async()=>{
 const f=fixture();const r=await combat(f.port,'attack',new AbortController().signal);
 assert.equal(r.attacksSent,4);assert.equal(r.outcome,'time_limit');
 assert.deepEqual(f.strikes,[700,1400,2100,2800]);assert.ok(f.stops()>0);
});
test('occluded/lost target stops attacks, and no visible target rejects',async()=>{
 const f=fixture();const wait=f.port.wait;
 f.port.wait=async(ms,s)=>{await wait(ms,s);f.state.enemies=[];};
 const r=await combat(f.port,'attack',new AbortController().signal);
 assert.equal(r.outcome,'target_left_view');assert.equal(f.strikes.length,0);
 await assert.rejects(combat(f.port,'attack',new AbortController().signal),/No visible/);
});
test('cancellation prevents later swings and low health stops attack',async()=>{
 const f=fixture(),c=new AbortController();f.port.wait=async()=>{c.abort();};
 await assert.rejects(combat(f.port,'attack',c.signal));assert.equal(f.strikes.length,0);
 f.state.health=6;const r=await combat(f.port,'attack',new AbortController().signal);
 assert.equal(r.outcome,'low_health_stop');assert.equal(f.strikes.length,0);
});
test('flee verifies distance using immutable start and only last visible threat position',async()=>{
 const f=fixture();const wait=f.port.wait;
 f.port.wait=async(ms,s)=>{await wait(ms,s);f.state.enemies=[];f.state.position.z+=1;};
 const r=await combat(f.port,'flee',new AbortController().signal);
 assert.equal(r.outcome,'distance_increased');assert.equal(r.attacksSent,0);assert.equal(f.strikes.length,0);
});
test('blocked retreat is not success and attack is not offered at critical health',async()=>{
 const f=fixture();f.port.retreat=()=>false;
 assert.equal((await combat(f.port,'flee',new AbortController().signal)).outcome,'no_known_retreat_path');
 const s=new MockWorld().snapshot();s.enemies=f.state.enemies;s.health=6;
 assert.deepEqual(candidates(s),['idle','flee']);s.enemies=[];assert.deepEqual(candidates(s),['idle']);
});
test('adapter excludes occluded mobs and players even if the server reports them',()=>{
 const w=Object.create(MineflayerWorld.prototype) as any;
 w.ready=true;w.bot={entity:{position:{}},entities:{1:{id:1,name:'zombie',position:{x:1,y:2,z:3,distanceTo:()=>2}},2:{id:2,name:'skeleton'},3:{id:3,name:'player'}}};
 w.entityVisible=(e:any)=>e.id!==2;
 assert.deepEqual(w.enemies(),[{id:1,kind:'zombie',position:{x:1,y:2,z:3},distance:2}]);
});
test('JEV receives gear, own health and visible species without monster strength fields',async()=>{
 const s=new MockWorld().snapshot();s.enemies=fixture().state.enemies;s.equipment=[{slot:'hand',name:'iron_sword',durabilityUsed:2}];s.encounters=[];
 let calls=0;
 const fetcher=(async(_url:any,init:any)=>{calls++;const b=JSON.parse(init.body);const o=b.state.observation;
 assert.deepEqual(o.equipment,s.equipment);assert.equal(o.health,20);
 assert.deepEqual(Object.keys(o.enemies[0]).sort(),['distance','id','kind','position']);
 assert.ok(b.questions.action.criteria.attack);assert.ok(b.questions.action.criteria.flee);
 return Response.json({answers:{action:{type:'choice',choice:'flee',confidence:1}},usage:{input_tokens:1,output_tokens:0}});
 }) as typeof fetch;
 const brain=new ApiBrain({...config(),mode:'jev',jevKey:'fake'},new Budget(1,1),fetcher);
 const result=await brain.choose(s,{goal:'observe',preferred:'idle'},candidates(s),new AbortController().signal);
 assert.equal(result.action,'flee');assert.equal(calls,1);
});

test('runtime lets JEV choose flee at low health without hunger override',async()=>{
 const {Runtime}=await import('../src/runtime.js');const world=new MockWorld();
 world.state.health=5;world.state.food=10;world.state.enemies=fixture().state.enemies;
 const executed:string[]=[];world.execute=async a=>{executed.push(a);return a;};
 const brain={plan:()=>new Promise<import('../src/types.js').Plan>(()=>{}),choose:async(_s:any,_p:any,options:any)=>{assert.deepEqual(options,['idle','flee']);return {action:'flee' as const,confidence:1};}};
 const r=new Runtime(world,brain,{planMs:30000,actionMs:5000,minConfidence:.5},()=>{});
 await r.tick();assert.deepEqual(executed,['flee']);r.close();
});
test('runtime does not cancel retreat just because turning away hides the target',async()=>{
 const {Runtime}=await import('../src/runtime.js');const world=new MockWorld();world.state.enemies=fixture().state.enemies;
 let release!:()=>void;let signal:AbortSignal|undefined;
 world.execute=async(_a,s)=>{signal=s;await new Promise<void>(r=>{release=r;});return 'retreat';};
 const brain={plan:()=>new Promise<import('../src/types.js').Plan>(()=>{}),choose:async()=>({action:'flee' as const,confidence:1})};
 const r=new Runtime(world,brain,{planMs:30000,actionMs:5000,minConfidence:.5},()=>{});
 const pending=r.tick();await new Promise(resolve=>setTimeout(resolve,0));
 world.state.enemies=[];world.state.health=5;await r.tick();assert.equal(signal?.aborted,false);
 r.setGoal('stop this task');assert.equal(signal?.aborted,true);release();await pending;r.close();
});

test('runtime permits bounded attack reacquisition but explicit goals still cancel',async()=>{
 const {Runtime}=await import('../src/runtime.js');const world=new MockWorld();world.state.enemies=fixture().state.enemies;
 let release!:()=>void;let signal:AbortSignal|undefined;
 world.execute=async(_a,s)=>{signal=s;await new Promise<void>(r=>{release=r;});return 'retreat';};
 const brain={plan:()=>new Promise<import('../src/types.js').Plan>(()=>{}),choose:async()=>({action:'attack' as const,confidence:1})};
 const r=new Runtime(world,brain,{planMs:30000,actionMs:5000,minConfidence:.5},()=>{});
 const pending=r.tick();await new Promise(resolve=>setTimeout(resolve,0));
 world.state.enemies=[];world.state.health=5;await r.tick();assert.equal(signal?.aborted,false);
 r.setGoal('stop this task');assert.equal(signal?.aborted,true);release();await pending;r.close();
});
