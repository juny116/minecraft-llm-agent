import test from 'node:test';
import assert from 'node:assert/strict';
import {MineflayerWorld} from '../src/mineflayer.js';
import {parsePlan} from '../src/providers.js';
import {candidates,type Plan} from '../src/types.js';
import {classify} from '../src/planning.js';
import {MockWorld} from '../src/mock.js';
class V {constructor(public x:number,public y:number,public z:number){} offset(x:number,y:number,z:number){return new V(this.x+x,this.y+y,this.z+z);} scaled(n:number){return new V(this.x*n,this.y*n,this.z*n);} minus(p:V){return this.offset(-p.x,-p.y,-p.z);} norm(){return Math.hypot(this.x,this.y,this.z);} distanceTo(p:V){return this.minus(p).norm();}}
const pos={x:3,y:0,z:0};const signal=()=>new AbortController().signal;
function fixture(){
 const w=Object.create(MineflayerWorld.prototype) as any;
 const inventory:Record<string,number>={crafting_table:1,oak_log:3};let chestCount=5;let closed=0;let withdrawn=0;let pending=0;let placed=false;let tossed=0;
 const chest={name:'chest',position:new V(3,0,0)},support={name:'dirt',boundingBox:'block',position:new V(2,-1,0)};
 const items=()=>Object.entries(inventory).filter(([,count])=>count>0).map(([name,count],i)=>({name,count,type:i+1,metadata:0,slot:9+i}));
 w.containers=[];w.recentDrops=new Map();w.visible=[{name:'chest',position:pos}];w.observe=()=>{};w.stop=()=>{};w.navigate=async()=>{};w.entityVisible=()=>true;w.blockInSight=()=>true;w.placementSupport=()=>support;
 w.bot={entity:{position:new V(0,0,0)},players:{Bob:{entity:{position:new V(1,0,0)}}},inventory:{items},lookAt:async()=>{},clickWindow:async()=>{},equip:async()=>{},
  blockAt:(p:V)=>p.x===3?chest:{name:placed?'crafting_table':'air',position:p},
  placeBlock:async()=>{placed=true;inventory.crafting_table--;},
  toss:async(_t:number,_m:number,n:number)=>{await w.bot.clickWindow();inventory.oak_log-=n;tossed++;},
  openChest:async()=>({containerItems:()=>[{name:'oak_log',count:chestCount,type:2,metadata:0}],withdraw:async(_t:number,_m:number,n:number)=>{await w.bot.clickWindow();chestCount-=n;pending=n;withdrawn++;},close:()=>{closed++;inventory.oak_log+=pending;pending=0;}})};
 return {w,inventory,counts:()=>({closed,withdrawn,tossed}),setStock:(n:number)=>chestCount=n};
}
const withdrawal:Plan={goal:'get wood',preferred:'withdraw',container:pos,transfer:{item:'oak_log',count:2}};
test('new parameters survive parser and medium steps; invalid quantities/targets rejected',()=>{
 const p=parsePlan({...withdrawal,steps:[{id:'take',description:'take wood',action:'withdraw',completion:{kind:'action_success'},container:pos,transfer:withdrawal.transfer}]});assert.deepEqual(p.steps?.[0].transfer,withdrawal.transfer);
 for(const count of [0,-1,65,1.5])assert.throws(()=>parsePlan({...withdrawal,transfer:{item:'oak_log',count}}));
 assert.throws(()=>parsePlan({...withdrawal,container:undefined}));assert.throws(()=>parsePlan({goal:'give',preferred:'give',transfer:{item:'oak_log',count:1,recipient:'/op'}}));
});
test('candidate selection requires visible chest or recipient and own carried inventory',()=>{
 const s=new MockWorld().snapshot();s.vision={yaw:0,pitch:0,blocks:[{name:'chest',position:pos,lastSeen:0}]};s.inventory=[{name:'oak_log',count:2,slot:9}];s.nearbyPlayers=[{name:'Bob',position:pos}];s.canPlaceTable=true;
 assert.ok(candidates(s,withdrawal).includes('withdraw'));assert.ok(candidates(s,withdrawal).includes('inspect_container'));assert.ok(candidates(s,withdrawal).includes('place_table'));
 const p:Plan={goal:'give',preferred:'give',transfer:{item:'oak_log',count:2,recipient:'Bob'}};assert.ok(candidates(s,p).includes('give'));s.nearbyPlayers=[];assert.ok(!candidates(s,p).includes('give'));s.vision.blocks=[];assert.ok(!candidates(s,withdrawal).includes('withdraw'));
});
test('inspection observes only an opened chest and always closes it',async()=>{
 const f=fixture();assert.equal(f.w.containers.length,0);await f.w.execute('inspect_container',signal(),{goal:'inspect',preferred:'inspect_container',container:pos});assert.equal(f.w.containers[0].items[0].count,5);assert.equal(f.counts().closed,1);
});
test('withdrawal verifies inventory after window closure and updates observed chest contents',async()=>{
 const f=fixture();assert.equal(await f.w.execute('withdraw',signal(),withdrawal),'Withdrew 2 oak_log');assert.equal(f.inventory.oak_log,5);assert.equal(f.w.containers[0].items[0].count,3);assert.equal(f.counts().closed,1);
});
test('contention is checked against fresh chest, not remembered contents',async()=>{
 const f=fixture();f.setStock(1);await assert.rejects(f.w.execute('withdraw',signal(),withdrawal),/Insufficient/);assert.equal(f.counts().withdrawn,0);assert.equal(f.counts().closed,1);
});
test('occluded chest cannot be opened',async()=>{
 const f=fixture();f.w.blockInSight=()=>false;await assert.rejects(f.w.execute('withdraw',signal(),withdrawal),/visible/);assert.equal(f.counts().closed,0);
});
test('abort after opening prevents withdrawal and restores click handler',async()=>{
 const f=fixture(),c=new AbortController(),original=f.w.bot.openChest,click=f.w.bot.clickWindow;f.w.bot.openChest=async()=>{const w=await original();c.abort();return w;};await assert.rejects(f.w.execute('withdraw',c.signal,withdrawal));assert.equal(f.counts().withdrawn,0);assert.equal(f.counts().closed,1);assert.equal(f.w.bot.clickWindow,click);
});
test('placement requires both real block and inventory decrement',async()=>{
 const f=fixture();assert.match(await f.w.execute('place_table',signal()),/Placed crafting_table/);assert.equal(f.inventory.crafting_table,0);
 const bad=fixture();bad.w.bot.placeBlock=async()=>{};await assert.rejects(bad.w.execute('place_table',signal()),/not confirmed/);
});
test('cancel during equip cannot place block',async()=>{
 const f=fixture(),c=new AbortController();f.w.bot.equip=async()=>c.abort();await assert.rejects(f.w.execute('place_table',c.signal));assert.equal(f.inventory.crafting_table,1);
});
test('give is an observed drop, not a confirmed receipt; repeat drops blocked',async()=>{
 const f=fixture(),p:Plan={goal:'give',preferred:'give',transfer:{item:'oak_log',count:1,recipient:'Bob'}};
 const result=await f.w.execute('give',signal(),p);assert.equal(JSON.parse(result).receiptConfirmed,false);assert.equal(classify('give',result),'partial');assert.equal(f.inventory.oak_log,2);
 await assert.rejects(f.w.execute('give',signal(),p),/receipt pending/);assert.equal(f.counts().tossed,1);
});
test('recipient leaving during approach prevents dropping',async()=>{
 const f=fixture();f.w.bot.players.Bob.entity.position=new V(4,0,0);f.w.navigate=async()=>{delete f.w.bot.players.Bob;};await assert.rejects(f.w.execute('give',signal(),{goal:'give',preferred:'give',transfer:{item:'oak_log',count:1,recipient:'Bob'}}),/moved out/);assert.equal(f.counts().tossed,0);
});
test('known block center ray detects occlusion without depending on sparse grid',()=>{
 const f=fixture();delete f.w.blockInSight;f.w.bot.entity.yaw=-Math.PI/2;f.w.bot.entity.pitch=0;
 const block={position:new V(3,1,0)};f.w.bot.world={raycast:()=>block};assert.equal(f.w.blockInSight(block),true);f.w.bot.world.raycast=()=>({position:new V(2,1,0)});assert.equal(f.w.blockInSight(block),false);
});

test('runtime activates interaction parameters for later steps instead of retaining earlier target',async()=>{
 const {Runtime}=await import('../src/runtime.js');const world=new MockWorld();world.state.vision={yaw:0,pitch:0,blocks:[{name:'chest',position:pos,lastSeen:Date.now()}]};
 const plan:Plan={goal:'inspect then take',preferred:'inspect_container',container:pos,steps:[{id:'see',description:'inspect',action:'inspect_container',container:pos,completion:{kind:'action_success'}},{id:'take',description:'take',action:'withdraw',container:pos,transfer:{item:'oak_log',count:2},completion:{kind:'action_success'}}]};
 const runtime=new Runtime(world,{plan:async()=>plan,choose:async()=>({action:'inspect_container',confidence:1})},{planMs:60000,actionMs:1000,minConfidence:0},()=>{});
 await runtime.tick();await runtime.tick();assert.equal(runtime.plan.preferred,'withdraw');assert.deepEqual(runtime.plan.transfer,{item:'oak_log',count:2});assert.deepEqual(runtime.plan.container,pos);runtime.close();
});
test('already reached destination is excluded instead of endlessly succeeding at no movement',()=>{
 const s=new MockWorld().snapshot();s.places=[{name:'dirt',position:{x:0,y:63,z:0},lastSeen:0}];assert.ok(!candidates(s,{goal:'go',preferred:'move',destination:{x:0,y:63,z:0}}).includes('move'));
});
test('abort inside inventory transfer prevents subsequent click',async()=>{
 const f=fixture(),c=new AbortController();let clicks=0;const originalClick=async()=>{clicks++;c.abort();};f.w.bot.clickWindow=originalClick;
 f.w.bot.toss=async()=>{await f.w.bot.clickWindow();await f.w.bot.clickWindow();};
 await assert.rejects(f.w.execute('give',c.signal,{goal:'give',preferred:'give',transfer:{item:'oak_log',count:1,recipient:'Bob'}}));assert.equal(clicks,1);assert.equal(f.w.bot.clickWindow,originalClick);
});


test('table placement waits for delayed inventory/block acknowledgements instead of false failure',async()=>{
 const f=fixture(),original=f.w.bot.placeBlock;f.w.bot.placeBlock=async()=>{setTimeout(()=>void original(),80);};assert.match(await f.w.execute('place_table',signal()),/Placed crafting_table/);assert.equal(f.inventory.crafting_table,0);
});
