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
