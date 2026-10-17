import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import pathfinder from 'mineflayer-pathfinder';import {observedMovements} from '../src/navigation.js';import {PlaceMemory} from '../src/vision.js';
const require=createRequire(import.meta.url),dep=createRequire(require.resolve('mineflayer'));
const registry=dep('minecraft-data')('1.21.1'),Block=dep('prismarine-block')(registry),Vec3=dep('vec3').Vec3;
function fixture(origin:number){
 const memory=new PlaceMemory();memory.observe([{name:'grass_block',position:{x:origin+1,y:77,z:origin},lastSeen:1}]);
 const bot:any={registry,game:{minY:-64},entities:{},inventory:{items:()=>[]},entity:{position:new Vec3(origin+.5,77,origin+.5)},pathfinder:{bestHarvestTool:()=>null},blockAt:(p:any)=>{const solid=(p.x===origin&&p.z===origin&&p.y===76)||(p.x===origin+1&&p.z===origin&&p.y===77);const b=Block.fromStateId(registry.blocksByName[solid?'grass_block':'air'].minStateId,0);b.position=p;return b;}};
 const node:any=new Vec3(origin,77,origin);node.remainingBlocks=0;return {memory,bot,node};
}
test('real pathfinder reproduces old head-clearance rejection and permits observed one-block climb at negative/positive coordinates',()=>{
 for(const origin of [-478,20]){const {memory,bot,node}=fixture(origin),old=new pathfinder.Movements(bot);old.canDig=false;old.allowParkour=false;old.allow1by1towers=false;
 old.exclusionAreasStep.push((b:any)=>[0,1,2].some(dy=>memory.hasSupport({x:b.position.x,y:b.position.y-dy,z:b.position.z}))?0:100);
 const target=(n:any)=>n.x===origin+1&&n.y===78&&n.z===origin;
 assert.equal(old.getNeighbors(node).some(target),false);assert.equal(observedMovements(bot,memory).getNeighbors(node).some(target),true);
 memory.clear();assert.equal(observedMovements(bot,memory).getNeighbors(node).length,0);
 }
});
test('air and liquids in remembered cells cannot authorize walking support',()=>{
 const m=new PlaceMemory();for(const name of ['air','water','lava']){m.observe([{name,position:{x:0,y:0,z:0},lastSeen:1}]);assert.equal(m.hasSupport({x:0,y:1,z:0}),false);}
});

test('blocked navigation observes side/back footholds before retry and stops on cancellation',async()=>{
 const {MineflayerWorld}=await import('../src/mineflayer.js');
 for(const cancelled of [false,true]){
  const w=Object.create(MineflayerWorld.prototype) as any,c=new AbortController();let looks=0,seen=0,walked=0,stops=0;
  const pos=new Vec3(.5,1,.5),goal=new pathfinder.goals.GoalNear(2,1,0,0);
  w.observe=()=>{seen++;};w.bot={entity:{position:pos},look:async()=>{looks++;if(cancelled&&looks===2)c.abort();},clearControlStates:()=>{},pathfinder:{movements:{},getPathTo:()=>seen<4?{path:[],status:'noPath'}:{path:[new Vec3(2,1,0)],status:'success'},goto:async()=>{walked++;pos.x=2.5;},setGoal:()=>{stops++;}}};
  if(cancelled)await assert.rejects(w.navigate(goal,c.signal));else await w.navigate(goal,c.signal);
  assert.equal(walked,cancelled?0:1);assert.ok(stops>0);assert.equal(seen,cancelled?1:4);
 }
});

test('persisted observed destinations are selectable after reconnect while navigation rechecks current footholds',async()=>{
 const {MineflayerWorld}=await import('../src/mineflayer.js');const w=Object.create(MineflayerWorld.prototype) as any;
 let moves=0;w.observe=()=>{};w.knownPlaces=()=>[{name:'grass_block',position:{x:3,y:1,z:0},lastSeen:1}];w.memory=new PlaceMemory();w.navigate=async()=>{moves++;};w.stop=()=>{};
 await w.execute('move',new AbortController().signal,{destination:{x:3,y:1,z:0}});assert.equal(moves,1);
 await assert.rejects(w.execute('move',new AbortController().signal,{destination:{x:99,y:1,z:0}}),/Destination not observed/);assert.equal(moves,1);
});

test('arrival, completion and candidate availability agree with actual pathfinder cells',async()=>{
 const {reachedCell}=await import('../src/reach.js'),{candidates}=await import('../src/types.js'),{completed}=await import('../src/planning.js'),{MockWorld}=await import('../src/mock.js');
 for(const origin of [-50,50]){
  const s=new MockWorld().snapshot(),target={x:origin-2,y:5,z:origin-2};s.position={x:origin-.5,y:5,z:origin-.5};s.places=[{name:'grass_block',position:target,lastSeen:1}];
  const actual=new pathfinder.goals.GoalNear(target.x,target.y,target.z,2).isEnd(new Vec3(s.position.x,s.position.y,s.position.z).floored() as any);
  assert.equal(reachedCell(s.position,target,2),actual);assert.equal(actual,true);
  assert.equal(candidates(s,{goal:'approach',preferred:'move',destination:target}).includes('move'),false);
  assert.equal(completed({id:'near',description:'approach',action:'move',completion:{kind:'near',position:target,radius:2}},s),true);
 }
});
