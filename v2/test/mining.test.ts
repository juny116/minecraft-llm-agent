// Regression coverage for the unified successor to gather and dig_block.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {MineflayerWorld} from '../src/mineflayer.js';
import {classify,completed} from '../src/planning.js';
import {miningTiming} from '../src/mining.js';
import {validateDig} from '../src/building.js';
import {actions,candidates,type Plan} from '../src/types.js';
import {MockWorld} from '../src/mock.js';
class V {constructor(public x:number,public y:number,public z:number){} offset(x:number,y:number,z:number){return new V(this.x+x,this.y+y,this.z+z);} scaled(n:number){return new V(this.x*n,this.y*n,this.z*n);} minus(p:V){return this.offset(-p.x,-p.y,-p.z);} norm(){return Math.hypot(this.x,this.y,this.z);} distanceTo(p:V){return this.minus(p).norm();}}
const p:Plan={goal:'mine observed stone',preferred:'mine',mine:{position:{x:2,y:0,z:0},expected:'stone'}};
function setup(){
 const w=Object.create(MineflayerWorld.prototype) as any;let broken=false;let received=0;let attacks=0;let stops=0;const target={name:'stone',stateId:1,diggable:true,position:new V(2,0,0)};
 w.containers=[];w.visible=[target];w.memory={observe:()=>{}};w.observe=()=>{};w.blockInSight=()=>true;w.miningFace=()=>new V(0,0,1);w.entityVisible=()=>true;w.enemies=()=>[];w.navigate=async()=>{};w.stop=()=>{stops++;};
 const bot=Object.assign(new EventEmitter(),{health:20,entity:{position:new V(0,0,0)},entities:{} as Record<string,any>,inventory:{items:()=>received?[{name:'cobblestone',count:received}]:[]},blockAt:()=>broken?{name:'air'}:target,lookAt:async()=>{},pathfinder:{bestHarvestTool:()=>null},canDigBlock:()=>true,heldItem:{name:'iron_pickaxe',enchants:[{name:'silk_touch',lvl:1}],durabilityUsed:4},clickWindow:async()=>{},equip:async()=>{},stopDigging:()=>{stops++;},dig:async()=>{attacks++;broken=true;}});w.bot=bot;
 return {w,bot,breakBlock:()=>{broken=true;},receive:(n=1)=>received+=n,stats:()=>({attacks,stops}),drop:()=>{const e={id:42,name:'item',position:new V(2,0,0),getDroppedItem:()=>({name:'cobblestone',count:1})};bot.entities['42']=e;bot.emit('itemDrop',e);}};
}
const signal=()=>new AbortController().signal;
test('only mine is selectable, requiring explicit observed target',()=>{assert.ok(actions.includes('mine'));assert.ok(!actions.includes('gather' as any));assert.ok(!actions.includes('dig_block' as any));const s=new MockWorld().snapshot();assert.ok(!candidates(s,{goal:'mine',preferred:'mine'}).includes('mine'));});
test('break without a visible drop or inventory gain remains honest and does not meet a resource goal',async()=>{
 const f=setup(),r=JSON.parse(await f.w.execute('mine',signal(),p));assert.equal(r.blockBroken,true);assert.equal(r.dropObservation,'none_observed');assert.deepEqual(r.inventoryGained,[]);assert.equal(r.tool.enchants[0].name,'silk_touch');assert.ok(r.attemptMs>=0);assert.equal(classify('mine',JSON.stringify(r)),'succeeded');
 assert.equal(completed({id:'stone',description:'obtain',action:'mine',completion:{kind:'inventory_at_least',item:'cobblestone',count:1}},new MockWorld().snapshot(),'mine'),false);
});
test('visible drop and actual inventory gain recorded independently',async()=>{
 const f=setup();f.bot.dig=async()=>{f.breakBlock();f.drop();};f.w.navigate=async()=>f.receive();const r=JSON.parse(await f.w.execute('mine',signal(),p));assert.equal(r.blockBroken,true);assert.equal(r.drops[0].name,'cobblestone');assert.deepEqual(r.inventoryGained,[{name:'cobblestone',count:1}]);assert.equal(r.pickup,'inventory_gain_observed');
});
test('seen drop with unreachable pickup records no gain, not no drop',async()=>{
 const f=setup();f.bot.dig=async()=>{f.breakBlock();f.drop();};f.w.navigate=async()=>{throw Error('No path');};const r=JSON.parse(await f.w.execute('mine',signal(),p));assert.equal(r.blockBroken,true);assert.equal(r.dropObservation,'observed_near_target');assert.deepEqual(r.inventoryGained,[]);assert.equal(r.pickup,'interrupted');
});
test('timeout is incomplete within budget, never an unmineable verdict; tool and elapsed attempt survive',async()=>{
 const f=setup();(f.bot as any).digTime=()=>0;f.bot.dig=()=>new Promise(()=>{});const r=JSON.parse(await f.w.execute('mine',signal(),{...p,mine:{...p.mine!,maxMs:1000}}));assert.equal(r.blockBroken,false);assert.equal(r.status,'time_limit');assert.ok(r.attemptMs>=900);assert.equal(classify('mine',JSON.stringify(r)),'partial');assert.ok(f.stats().stops>0);
});
test('damage stops mining and preserves break evidence if block already disappeared',async()=>{
 const f=setup();f.bot.dig=async()=>{f.breakBlock();f.bot.health=19;f.bot.emit('health');};const r=JSON.parse(await f.w.execute('mine',signal(),p));assert.equal(r.blockBroken,true);assert.equal(r.status,'cancelled');assert.equal(r.pickup,'not_attempted');assert.equal(f.bot.listenerCount('health'),0);
});
test('old successful attempt timeout cannot stop a later action',async()=>{
 const f=setup();await f.w.execute('mine',signal(),{...p,mine:{...p.mine!,maxMs:1000}});const before=f.stats().stops;await new Promise(r=>setTimeout(r,850));assert.equal(f.stats().stops,before);
});
test('occluded target is not mined and reports failure instead of guessing drops',async()=>{
 const f=setup();f.w.blockInSight=()=>false;const r=JSON.parse(await f.w.execute('mine',signal(),p));assert.equal(r.blockBroken,false);assert.equal(r.status,'failed');assert.equal(r.dropObservation,'not_checked');assert.equal(f.stats().attacks,0);
});
test('bounded timing validated and tool choice must be an item identifier',()=>{for(const maxMs of [0,999,120001,NaN])assert.throws(()=>validateDig({...p.mine!,maxMs}));validateDig({...p.mine!,maxMs:120000,tool:'diamond_pickaxe'});});
test('exact tool slot selects enchantments without assuming same-name tools are equivalent',async()=>{
 const f=setup();const plain={name:'iron_pickaxe',slot:9,enchants:[],durabilityUsed:0},silk={name:'iron_pickaxe',slot:10,enchants:[{name:'silk_touch',lvl:1}],durabilityUsed:2};
 f.bot.inventory.items=(()=>[plain,silk]) as any;f.bot.pathfinder.bestHarvestTool=(()=>plain) as any;f.bot.equip=(async(item:any)=>{f.bot.heldItem=item;}) as any;
 const r=JSON.parse(await f.w.execute('mine',signal(),{...p,mine:{...p.mine!,toolSlot:10}}));assert.equal(r.tool.enchants[0].name,'silk_touch');assert.equal(r.tool.durabilityUsed,2);
});
test('structured mining result is retained in the runtime journal separately from inventory deltas',async()=>{
 const {Runtime}=await import('../src/runtime.js');const w=new MockWorld();const target={position:{x:1,y:64,z:0},expected:'oak_log'};
 const r=new Runtime(w,{plan:async()=>({goal:'wood',preferred:'mine',mine:target}),choose:async()=>({action:'mine',confidence:1})},{planMs:60000,actionMs:1000,minConfidence:0},()=>{});
 await r.tick();await r.tick();assert.equal(r.planning.recentActions.at(-1)?.mining?.blockBroken,true);assert.equal(r.planning.recentActions.at(-1)?.changes.inventory.oak_log,1);r.close();
});
test('pickup approaches a standing cell within item reach',async()=>{
 const f=setup();f.bot.dig=async()=>{f.breakBlock();f.drop();};f.w.navigate=async(g:any)=>{assert.equal(g.isEnd({x:1,y:g.y,z:0}),true);assert.equal(g.isEnd({x:2,y:g.y+2,z:0}),false);f.receive();};
 const r=JSON.parse(await f.w.execute('mine',signal(),p));assert.equal(r.inventoryGained[0].count,1);
});

test('confirmed destruction invalidates previously observed storage at that cell',async()=>{const f=setup();f.w.containers=[{position:{x:2,y:0,z:0},observedAt:1,items:[]}];await f.w.execute('mine',signal(),p);assert.deepEqual(f.w.containers,[]);});


test('pickup uses visible drop elevation rather than the current feet height',async()=>{
 const f=setup();f.bot.dig=async()=>{f.breakBlock();f.drop();f.bot.entities['42'].position=new V(2,1,0);};f.w.navigate=async(g:any)=>{assert.equal(g.y,1);assert.equal(g.isEnd({x:1,y:g.y,z:0}),true);assert.equal(g.isEnd({x:2,y:g.y+2,z:0}),false);f.receive();};
 const r=JSON.parse(await f.w.execute('mine',signal(),p));assert.equal(r.inventoryGained[0].count,1);
});

test('partially visible target is approached once and revalidated before mining',async()=>{
 const f=setup();let approached=0;f.w.blockInSight=()=>approached>0;
 f.w.navigate=async(g:any)=>{assert.equal(g.rangeSq,1);approached++;};
 const r=JSON.parse(await f.w.execute('mine',signal(),p));assert.equal(approached,1);assert.equal(r.blockBroken,true);
});

test('supporting floor is excluded from action choices until the bot moves off it',()=>{
 const s=new MockWorld().snapshot();const target={position:{x:0,y:63,z:0},expected:'stone'};s.position={x:.5,y:64,z:.5};s.vision!.blocks=[{name:'stone',position:target.position,lastSeen:1}];
 assert.equal(candidates(s,{goal:'stone',preferred:'mine',mine:target}).includes('mine'),false);
 s.position.x=1.5;assert.equal(candidates(s,{goal:'stone',preferred:'mine',mine:target}).includes('mine'),true);
});

test('an unavailable explicit tool or stale stack slot is excluded without restricting automatic tool choice',()=>{
 const s=new MockWorld().snapshot(),mine={position:{x:1,y:64,z:0},expected:'oak_log'};
 assert.equal(candidates(s,{goal:'mine',preferred:'mine',mine:{...mine,tool:'wooden_shovel'}}).includes('mine'),false);
 assert.equal(candidates(s,{goal:'mine',preferred:'mine',mine}).includes('mine'),true);
 s.inventory=[{name:'wooden_axe',count:1,slot:9}];
 assert.equal(candidates(s,{goal:'mine',preferred:'mine',mine:{...mine,tool:'wooden_axe',toolSlot:10}}).includes('mine'),false);
 assert.equal(candidates(s,{goal:'mine',preferred:'mine',mine:{...mine,tool:'wooden_axe',toolSlot:9}}).includes('mine'),true);
});

test('confirmed ray face is passed explicitly to digging and occlusion still rejects a target',()=>{
 const f=setup();delete f.w.miningFace;Object.assign(f.bot.entity,{yaw:-Math.PI/2,pitch:0});
 (f.bot as any).world={raycast:()=>({position:new V(2,0,0),face:4})};
 assert.deepEqual(f.w.miningFace(f.bot.blockAt()),new V(-1,0,0));
 (f.bot as any).world.raycast=()=>({position:new V(1,0,0),face:4});assert.equal(f.w.miningFace(f.bot.blockAt()),undefined);
});
test('mining uses the previously verified face instead of the independent library raycast heuristic',async()=>{
 const f=setup();f.bot.dig=(async(_target:any,_look:any,face:any)=>{assert.deepEqual(face,new V(0,0,1));f.breakBlock();}) as any;
 const r=JSON.parse(await f.w.execute('mine',signal(),p));assert.equal(r.blockBroken,true);
});

test('dig watchdog scales with estimated tool/state time and bounds unknown estimates',()=>{
 assert.equal(miningTiming(1150).digBudgetMs,3725);
 assert.equal(miningTiming(250000).digBudgetMs,377000);
 assert.equal(miningTiming(Infinity).digBudgetMs,30000);
 assert.equal(miningTiming(NaN).estimatedDigMs,undefined);
 assert.equal(miningTiming(600000).estimateCapped,true);
 assert.equal(miningTiming(600000).digBudgetMs,600000);
});
test('executor estimates after tool equip and survives old one-second request while exposing progress',async()=>{
 const f=setup();let saw=false;
 (f.bot as any).digTime=()=>{assert.equal(f.bot.heldItem.name,'iron_pickaxe');return 1200;};
 f.bot.dig=async()=>{await new Promise(r=>setTimeout(r,1100));const progress=f.w.executionProgress();assert.equal(progress.phase,'digging');assert.equal(progress.digBudgetMs,3800);assert.ok(progress.estimatedRemainingMs<200);saw=true;f.breakBlock();};
 const result=JSON.parse(await f.w.execute('mine',signal(),{...p,mine:{...p.mine!,maxMs:1000}}));
 assert.equal(saw,true);assert.equal(result.blockBroken,true);assert.equal(result.digBudgetMs,3800);assert.equal(result.estimatedDigMs,1200);assert.equal(f.w.executionProgress(),undefined);
});

test('drop appearing after the first post-break scan is collected inside the same bounded window',async()=>{
 const f=setup();let timer:ReturnType<typeof setTimeout>|undefined;
 f.bot.dig=async()=>{f.breakBlock();timer=setTimeout(()=>f.drop(),350);};f.w.navigate=async()=>f.receive();
 try{const result=JSON.parse(await f.w.execute('mine',signal(),p));assert.equal(result.blockBroken,true);assert.equal(result.dropObservation,'observed_near_target');assert.deepEqual(result.inventoryGained,[{name:'cobblestone',count:1}]);}finally{clearTimeout(timer);}
});
test('a tool that cannot harvest the block is reported from block data with the tools that can',async()=>{
 const f=setup();const target=f.bot.blockAt();Object.assign(target,{harvestTools:{801:true,806:true},canHarvest:(id:number|null)=>id===801||id===806});
 Object.assign(f.bot,{heldItem:{name:'iron_sword',type:900,enchants:[],durabilityUsed:0},registry:{items:{801:{name:'wooden_pickaxe'},806:{name:'stone_pickaxe'}}}});
 const r=JSON.parse(await f.w.execute('mine',signal(),p));
 assert.equal(r.harvest.heldToolDropsItem,false);assert.deepEqual(r.harvest.toolsThatDropItem,['wooden_pickaxe','stone_pickaxe']);
 assert.equal(classify('mine',JSON.stringify(r)),'partial');
});
test('an empty hand or non-tool that cannot harvest is reported as false, not dropped from the record',async()=>{
 for(const held of [null,{name:'stick',type:900,enchants:[],durabilityUsed:null}]){
  const f=setup();const target=f.bot.blockAt();
  // prismarine-block returns null for no held item and undefined for an item outside harvestTools.
  Object.assign(target,{harvestTools:{801:true},canHarvest:(id:number|null)=>id&&({801:true} as any)[id]});
  Object.assign(f.bot,{heldItem:held,registry:{items:{801:{name:'wooden_pickaxe'}}}});
  const r=JSON.parse(await f.w.execute('mine',signal(),p));
  assert.equal(r.harvest.heldToolDropsItem,false);assert.equal(classify('mine',JSON.stringify(r)),'partial');
 }
});
