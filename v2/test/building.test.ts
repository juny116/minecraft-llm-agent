import {EventEmitter} from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBuild,validateDig,buildingMaterial,overlapsCell} from '../src/building.js';
import {MineflayerWorld} from '../src/mineflayer.js';
import {parsePlan} from '../src/providers.js';
import {candidates,type Plan} from '../src/types.js';
import {MockWorld} from '../src/mock.js';
class V {constructor(public x:number,public y:number,public z:number){} offset(x:number,y:number,z:number){return new V(this.x+x,this.y+y,this.z+z);} scaled(n:number){return new V(this.x*n,this.y*n,this.z*n);} minus(p:V){return this.offset(-p.x,-p.y,-p.z);} norm(){return Math.hypot(this.x,this.y,this.z);} distanceTo(p:V){return this.minus(p).norm();}}
const reference={x:2,y:-1,z:0},position={x:2,y:0,z:0};
const plan:Plan={goal:'my chosen structure',preferred:'place_block',build:{item:'oak_planks',reference,position}};
function fixture(){
 const w=Object.create(MineflayerWorld.prototype) as any;let count=5,placed=0,dug=0;const cells=new Map<string,any>();const key=(p:V)=>`${p.x},${p.y},${p.z}`;
 const put=(p:any,name:string)=>cells.set(key(p),{name,position:new V(p.x,p.y,p.z),stateId:name==='dirt'?1:name==='air'?0:2,diggable:true});put(reference,'dirt');put(position,'air');
 w.visible=[{name:'dirt',position:reference}];w.observe=()=>{};w.memory={observe:()=>{}};w.stop=()=>{};w.navigate=async()=>{};w.blockInSight=()=>true;w.miningFace=()=>new V(0,1,0);
 const bot={entity:{position:new V(0,0,0),width:.6,height:1.8},entities:{},registry:{blocksByName:{oak_planks:{}}},inventory:{items:()=>[{name:'oak_planks',count,type:1}]},blockAt:(p:V)=>cells.get(key(p)),pathfinder:{bestHarvestTool:()=>null},canDigBlock:()=>true,lookAt:async()=>{},equip:async()=>{},clickWindow:async()=>{},getControlState:()=>false,setControlState:()=>{},world:{raycast:()=>null},placeBlock:async()=>{placed++;count--;put(position,'oak_planks');},dig:async(b:any)=>{dug++;put(b.position,'air');}};Object.assign(bot,{on:EventEmitter.prototype.on,removeListener:EventEmitter.prototype.removeListener,stopDigging:()=>{}});w.bot=bot;
 return {w,bot,put,stats:()=>({count,placed,dug})};
}
const signal=()=>new AbortController().signal;
test('materials and face adjacency validated without imposing a building goal',()=>{
 for(const name of ['oak_planks','stone','glass','red_wool','dirt'])assert.ok(buildingMaterial(name));
 for(const name of ['sand','water_bucket','oak_door','red_bed','tnt'])assert.ok(!buildingMaterial(name));
 validateBuild(plan.build!);assert.throws(()=>validateBuild({...plan.build!,position:{x:5,y:0,z:0}}));assert.throws(()=>validateDig({position,expected:'bedrock'}));
 const parsed=parsePlan({...plan,steps:[{id:'a',description:'place',action:'place_block',build:plan.build,completion:{kind:'action_success'}}]});assert.deepEqual(parsed.steps?.[0].build,plan.build);
 assert.throws(()=>parsePlan({goal:'dig',preferred:'mine'}));
});
test('candidate filtering requires seen support plus carried permitted material, or exact seen removal target',()=>{
 const s=new MockWorld().snapshot();s.placeableItems=['oak_planks'];s.vision={yaw:0,pitch:0,blocks:[{name:'dirt',position:reference,lastSeen:0}]};assert.ok(candidates(s,plan).includes('place_block'));
 s.placeableItems=[];assert.ok(!candidates(s,plan).includes('place_block'));assert.ok(candidates(s,{goal:'dig',preferred:'mine',mine:{position:reference,expected:'dirt'}}).includes('mine'));
 s.vision.blocks=[];assert.ok(!candidates(s,plan).includes('place_block'));
});
test('placement confirms block and count; rejected without either evidence',async()=>{
 const f=fixture();assert.match(await f.w.execute('place_block',signal(),plan),/Placed oak_planks/);assert.equal(f.stats().count,4);
 const bad=fixture();bad.bot.placeBlock=async()=>{};await assert.rejects(bad.w.execute('place_block',signal(),plan),/not confirmed/);
});
test('occupied destination, entity collision and occluded face never send placement',async()=>{
 for(const reason of ['occupied','entity','occluded']){const f=fixture();if(reason==='occupied')f.put(position,'stone');if(reason==='entity')(f.bot.entities as any).other={position:new V(2.5,0,.5),width:.6,height:1.8};if(reason==='occluded')f.bot.world.raycast=(()=>({})) as any;
 await assert.rejects(f.w.execute('place_block',signal(),plan));assert.equal(f.stats().placed,0);}
 assert.ok(overlapsCell(position,new V(2.5,0,.5)));assert.ok(!overlapsCell(position,new V(0,0,0)));
});
test('cancel during equip and changed reference prevent placement',async()=>{
 const f=fixture(),c=new AbortController();f.bot.equip=async()=>c.abort();await assert.rejects(f.w.execute('place_block',c.signal,plan));assert.equal(f.stats().placed,0);
 const changed=fixture();changed.bot.equip=async()=>{changed.put(reference,'stone');};await assert.rejects(changed.w.execute('place_block',signal(),plan),/changed/);assert.equal(changed.stats().placed,0);
});
test('removal confirms air but makes no collection claim',async()=>{
 const f=fixture();assert.equal(JSON.parse(await f.w.execute('mine',signal(),{goal:'remove',preferred:'mine',mine:{position:reference,expected:'dirt'}})).blockBroken,true);assert.equal(f.stats().dug,1);
});
test('unexpected block, own supporting floor, and server refusal cannot report removal success',async()=>{
 const p:Plan={goal:'remove',preferred:'mine',mine:{position:reference,expected:'dirt'}};
 const changed=fixture();changed.put(reference,'stone');assert.match(JSON.parse(await changed.w.execute('mine',signal(),p)).detail,/changed/);
 const floor=fixture();floor.bot.entity.position=new V(2.5,0,.5);assert.match(JSON.parse(await floor.w.execute('mine',signal(),p)).detail,/supports own feet/);assert.equal(floor.stats().dug,0);
 const refused=fixture();refused.bot.dig=async()=>{};assert.match(JSON.parse(await refused.w.execute('mine',signal(),p)).detail,/not confirmed/);
});
test('runtime carries block parameters when moving to next medium step',async()=>{
 const {Runtime}=await import('../src/runtime.js');const w=new MockWorld();w.state.vision={yaw:0,pitch:0,blocks:[{name:'dirt',position:reference,lastSeen:0}]};w.state.placeableItems=['oak_planks'];
 const p:Plan={...plan,steps:[{id:'a',description:'place',action:'place_block',build:plan.build,completion:{kind:'action_success'}},{id:'b',description:'remove',action:'mine',mine:{position,expected:'oak_planks'},completion:{kind:'action_success'}}]};
 const r=new Runtime(w,{plan:async()=>p,choose:async()=>({action:'place_block',confidence:1})},{planMs:60000,actionMs:1000,minConfidence:0},()=>{});await r.tick();await r.tick();assert.deepEqual(r.plan.mine,{position,expected:'oak_planks'});assert.equal(r.plan.build,undefined);r.close();
});
test('visible floor face remains placeable even when its buried center ray is occluded',async()=>{
 const f=fixture();f.w.blockInSight=()=>false;assert.match(await f.w.execute('place_block',signal(),plan),/Placed oak_planks/);
});
