import {RESPAWN_SET_RESULT} from '../src/beds.js';import {classify} from '../src/planning.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {bedHead,bedFacings,isBed,bedYaw} from '../src/beds.js';
import {validateBuild,buildingMaterial,tableSupportMaterial} from '../src/building.js';
import {bindBoundedArguments} from '../src/bounded-arguments.js';
import {MockWorld} from '../src/mock.js';import {candidates} from '../src/types.js';
import {MineflayerWorld} from '../src/mineflayer.js';
class Vec3 {constructor(public x:number,public y:number,public z:number){} scaled(n:number){return new Vec3(this.x*n,this.y*n,this.z*n)} offset(x:number,y:number,z:number){return new Vec3(this.x+x,this.y+y,this.z+z)}}
test('bed geometry requires two cells and explicit orientation; beds are not solid supports',()=>{
 const position={x:2,y:0,z:0},reference={x:2,y:-1,z:0};
 for(const facing of bedFacings){validateBuild({item:'white_bed',position,reference,facing});const h=bedHead(position,facing);assert.equal(Math.abs(h.x-2)+Math.abs(h.z),1);assert.ok(Number.isFinite(bedYaw(facing)));}
 assert.ok(buildingMaterial('red_bed'));assert.ok(!tableSupportMaterial('red_bed'));assert.ok(!tableSupportMaterial('oak_slab'));assert.ok(!isBed('fake_bed'));
 assert.throws(()=>validateBuild({item:'white_bed',position,reference}));
 assert.throws(()=>validateBuild({item:'white_bed',position,reference:{x:1,y:0,z:0},facing:'east'}));
});
test('animal attack uses same action while flee remains hostile-only',async()=>{
 const s=new MockWorld().snapshot();s.enemies=[];s.animals=[{id:8,kind:'sheep',position:s.position,distance:2}];
 const p={goal:'collect wool',preferred:'attack' as const,modelSelected:true,targetEntityId:8};assert.ok(candidates(s,p).includes('attack'));assert.ok(!candidates(s,p).includes('flee'));
 let rounds=0;const args=await bindBoundedArguments(s,'attack',async(_n,v)=>{rounds++;return v[0]},async()=>[]);assert.equal(args.targetEntityId,8);assert.equal(rounds,1);
});
function sleepingFixture(){
 const w=Object.create(MineflayerWorld.prototype) as any,bedPos={x:2,y:0,z:0};let wakes=0;
 const bed={name:'white_bed',position:new Vec3(2,0,0)};
 w.knownPlaces=()=>[{...bed,lastSeen:0}];w.observe=()=>{};w.navigate=async()=>{};w.blockInSight=()=>true;w.stop=()=>{};w.log=()=>{};
 w.bot={entity:{position:new Vec3(0,0,0)},game:{dimension:'overworld'},time:{timeOfDay:13000},inventory:{items:()=>[]},blockAt:()=>bed,isSleeping:false,sleep:async()=>{w.bot.isSleeping=true;},wake:async()=>{w.bot.isSleeping=false;wakes++;}};
 return {w,bedPos,wakes:()=>wakes};
}
test('sleep cancellation wakes before releasing executor and rejects unsafe dimension',async()=>{
 const {w,bedPos,wakes}=sleepingFixture(),c=new AbortController();w.bot.sleep=async()=>{w.bot.isSleeping=true;c.abort();};
 await assert.rejects(w.execute('sleep',c.signal,{goal:'sleep',preferred:'sleep',bed:bedPos}));assert.equal(wakes(),1);assert.equal(w.bot.isSleeping,false);
 w.bot.game.dimension='the_nether';await assert.rejects(w.execute('sleep',new AbortController().signal,{goal:'sleep',preferred:'sleep',bed:bedPos}),/Overworld/);
});
test('daytime refusal is failure, confirmed sleep and wake is success',async()=>{
 const {w,bedPos}=sleepingFixture(),p={goal:'sleep',preferred:'sleep',bed:bedPos};w.bot.sleep=async()=>{throw Error('not night')};await assert.rejects(w.execute('sleep',new AbortController().signal,p),/not night/);
 w.bot.sleep=async()=>{w.bot.isSleeping=true;setTimeout(()=>w.bot.isSleeping=false,5);};assert.match(await w.execute('sleep',new AbortController().signal,p),/Sleep confirmed/);
});
test('daytime bed use sets the respawn point as partial progress; a daytime refusal stays a failure',async()=>{
 const {w,bedPos}=sleepingFixture(),p={goal:'sleep',preferred:'sleep',bed:bedPos};let listener:((m:unknown)=>void)|undefined;
 w.bot.time.timeOfDay=6000;w.bot.on=(e:string,f:any)=>{if(e==='message')listener=f;};w.bot.removeListener=()=>{listener=undefined;};
 w.bot.sleep=async()=>{throw Error('sleep must not be called by day')};
 w.bot.activateBlock=async()=>{listener?.({translate:'block.minecraft.set_spawn'});listener?.({translate:'block.minecraft.bed.no_sleep'});};
 const r=await w.execute('sleep',new AbortController().signal,p);assert.equal(r,RESPAWN_SET_RESULT);assert.equal(classify('sleep',r),'partial');
 assert.deepEqual(w.respawnBed.position,bedPos);
 w.bot.activateBlock=async()=>{listener?.({translate:'block.minecraft.bed.obstructed'});};
 await assert.rejects(w.execute('sleep',new AbortController().signal,p),/obstructed/);
});
