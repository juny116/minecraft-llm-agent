import test from 'node:test';
import assert from 'node:assert/strict';
import {MineflayerWorld} from '../src/mineflayer.js';
test('navigation hints never replace the active pathfinder search or share its movement state',()=>{
 const world:any=Object.create(MineflayerWorld.prototype),hintMovements={},activeMovements={};let calls=0;
 Object.assign(world,{ready:true,navigationHintsAt:0,navigationHints:[],navigationHintMovements:hintMovements,memory:{snapshot:()=>[{name:'stone',position:{x:5,y:64,z:0},lastSeen:1}]},bot:{entity:{position:{x:0,y:64,z:0}},pathfinder:{movements:activeMovements,getPathTo:()=>{throw Error('Shared search must not be touched');},getPathFromTo:function*(movements:any,_from:any,_goal:any,options:any){calls++;assert.equal(movements,hintMovements);assert.notEqual(movements,activeMovements);assert.equal(options.tickTimeout,8);assert.equal(options.optimizePath,false);yield {result:{status:'success'}};}}}});
 assert.deepEqual(world.navigationTargets(),[{x:5,y:64,z:0}]);assert.equal(calls,1);world.navigationTargets();assert.equal(calls,1);
});
