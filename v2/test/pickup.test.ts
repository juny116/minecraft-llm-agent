import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {MineflayerWorld} from '../src/mineflayer.js';
import {parsePlan} from '../src/providers.js';
import {candidates,type Plan} from '../src/types.js';
import {classify} from '../src/planning.js';
import {MockWorld} from '../src/mock.js';
class V{constructor(public x:number,public y:number,public z:number){}offset(x:number,y:number,z:number){return new V(this.x+x,this.y+y,this.z+z);}}
const plan:Plan={goal:'collect existing item',preferred:'pickup',pickup:{entityId:42,expected:'cobblestone'}};
function setup(){const w=Object.create(MineflayerWorld.prototype) as any;let gained:any[]=[],visible=true;let moves=0;const e={id:42,name:'item',position:new V(2,0,0),getDroppedItem:()=>({name:'cobblestone',count:1})};const bot=Object.assign(new EventEmitter(),{health:20,entity:{position:new V(0,0,0)},entities:{42:e},inventory:{items:()=>gained},lookAt:async()=>{}});w.bot=bot;w.entityVisible=()=>visible;w.enemies=()=>[];w.stop=()=>{};w.observe=()=>{};w.navigate=async()=>{moves++;gained=[{name:'cobblestone',count:1}];};return {w,bot,hide:()=>visible=false,moves:()=>moves,gain:(name:string)=>gained=[{name,count:1}]};}
const signal=()=>new AbortController().signal;
test('pickup schema and step parameters survive parse, candidates require visible matching id and no threat',()=>{const p=parsePlan({goal:'pick',preferred:'pickup',steps:[{id:'p',description:'pick',action:'pickup',pickup:plan.pickup,completion:{kind:'action_success'}}]});assert.deepEqual(p.pickup,plan.pickup);assert.deepEqual(p.steps?.[0].pickup,plan.pickup);assert.throws(()=>parsePlan({goal:'p',preferred:'pickup'}));assert.throws(()=>parsePlan({...plan,pickup:{entityId:-1,expected:'stone'}}));const s=new MockWorld().snapshot();assert.ok(!candidates(s,p).includes('pickup'));s.visibleItems=[{id:42,name:'cobblestone',count:1,position:{x:2,y:0,z:0}}];assert.ok(candidates(s,p).includes('pickup'));s.enemies=[{} as any];assert.ok(!candidates(s,p).includes('pickup'));});
test('pickup actual gain produces structured success',async()=>{const f=setup(),r=JSON.parse(await f.w.execute('pickup',signal(),plan));assert.equal(r.status,'finished');assert.deepEqual(r.inventoryGained,[{name:'cobblestone',count:1}]);assert.equal(classify('pickup',JSON.stringify(r)),'succeeded');assert.equal(f.bot.listenerCount('health'),0);});
test('hidden or changed target never starts navigation',async()=>{const f=setup();f.hide();const r=JSON.parse(await f.w.execute('pickup',signal(),plan));assert.equal(r.status,'failed');assert.equal(f.moves(),0);});
test('disappearing item or full inventory without gain is not receipt',async()=>{const f=setup();f.w.navigate=async()=>{delete (f.bot.entities as any)[42];};const r=JSON.parse(await f.w.execute('pickup',signal(),plan));assert.equal(r.status,'failed');assert.deepEqual(r.inventoryGained,[]);});
test('unrelated gain recorded but does not complete target pickup',async()=>{const f=setup();f.w.navigate=async()=>f.gain('dirt');const r=JSON.parse(await f.w.execute('pickup',signal(),plan));assert.equal(r.status,'failed');assert.equal(r.inventoryGained[0].name,'dirt');});
test('damage interrupts pending navigation and cleans listener',async()=>{const f=setup();f.w.navigate=async()=>{f.bot.health=19;f.bot.emit('health');return new Promise(()=>{});};const r=JSON.parse(await f.w.execute('pickup',signal(),plan));assert.equal(r.status,'cancelled');assert.equal(f.bot.listenerCount('health'),0);});
test('new visible danger stops shared collection promptly',async()=>{const f=setup();let danger=false;f.w.navigate=async()=>{danger=true;return new Promise(()=>{});};f.w.enemies=()=>danger?[{}]:[];const r=JSON.parse(await f.w.execute('pickup',signal(),plan));assert.equal(r.status,'failed');assert.match(r.detail,/danger/);});
test('runtime journal retains pickup evidence and activated step target',async()=>{const {Runtime}=await import('../src/runtime.js');const w=new MockWorld();w.state.visibleItems=[{id:42,name:'cobblestone',count:1,position:{x:2,y:64,z:0}}];w.execute=async(a,_s,p)=>{assert.deepEqual(p?.pickup,plan.pickup);w.state.inventory=[{name:'cobblestone',count:1,slot:9}];return JSON.stringify({kind:'pickup',target:plan.pickup,status:'finished',inventoryGained:[{name:'cobblestone',count:1}]});};const r=new Runtime(w,{plan:async()=>parsePlan({...plan,steps:[{id:'p',description:'pick',action:'pickup',pickup:plan.pickup,completion:{kind:'action_success'}}]}),choose:async()=>({action:'pickup',confidence:1})},{planMs:60000,actionMs:1000,minConfidence:0},()=>{});await r.tick();await r.tick();assert.equal(r.planning.recentActions.at(-1)?.pickup?.inventoryGained[0].count,1);r.close();});

test('observed target-item gain counts as acquisition despite a final approach failure, preserving attribution limits',async()=>{
 const {classify}=await import('../src/planning.js');
 const r={kind:'pickup',target:{entityId:7,expected:'oak_log'},status:'failed',elapsedMs:1,inventoryGained:[{name:'oak_log',count:1}],detail:'Destination not reached',attribution:'inventory_delta_not_proof_of_target_origin'};
 assert.equal(classify('pickup',JSON.stringify(r)),'succeeded');
 assert.equal(classify('pickup',JSON.stringify({...r,inventoryGained:[{name:'dirt',count:1}]})),'failed');
 assert.equal(classify('pickup',JSON.stringify({...r,status:'cancelled'})),'cancelled');
});
