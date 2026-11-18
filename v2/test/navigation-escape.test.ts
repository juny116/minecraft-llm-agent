import test from 'node:test';import assert from 'node:assert/strict';

import pathfinderPackage from 'mineflayer-pathfinder';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),dep=createRequire(require.resolve('mineflayer')),registry=dep('minecraft-data')('1.21.1');
import {MineflayerWorld} from '../src/mineflayer.js';
const {goals}=pathfinderPackage;
// A bot sealed in a pocket: no walkable path anywhere. Only a chosen move may dig/pillar out.
function sealed(){
 const w=Object.create(MineflayerWorld.prototype) as any,logged:string[]=[];let escapeSearches=0;
 const feet={x:0,y:64,z:0};
 w.visible=[];w.observe=()=>{};w.log=(e:string)=>logged.push(e);
 w.bot={entity:{position:{...feet,floored:()=>feet,x:.5,y:64,z:.5}},look:async()=>{},clearControlStates:()=>{},
  registry,game:{minY:-64},entities:{},inventory:{items:()=>[]},blockAt:()=>null,
  pathfinder:{movements:{},setGoal:()=>{},setMovements:()=>{},goto:async()=>{},getPathTo:(m:any)=>{if(m!==w.bot.pathfinder.movements)escapeSearches++;return {path:[],status:'noPath'};}}};
 return {w,logged,escapeSearches:()=>escapeSearches};
}
test('approaches other than a chosen move fail instead of digging out of an enclosure',async()=>{
 const {w,logged,escapeSearches}=sealed();
 await assert.rejects(w.navigate(new goals.GoalNear(0,67,0,1)),/no observed route/);
 assert.equal(escapeSearches(),0);assert.ok(!logged.includes('navigation_escape'));
});
test('a chosen move still searches a dig/pillar route when no walkable route exists',async()=>{
 const {w,escapeSearches}=sealed();
 await assert.rejects(w.navigate(new goals.GoalNear(0,67,0,1),undefined,{escape:true}),/no observed route/);
 assert.ok(escapeSearches()>0);
});
