import test from 'node:test';
import assert from 'node:assert/strict';
import {MineflayerWorld} from '../src/mineflayer.js';
function fixture() {
 const world=Object.create(MineflayerWorld.prototype) as any;
 let count=0, clicks=0;
 const bot:any={registry:{itemsByName:{oak_planks:{id:2}}},inventory:{items:()=>count?[{type:2,count}]:[],count:()=>10},recipesFor:()=>[{result:{count:4},delta:[{id:1,metadata:null,count:-1}]}],clickWindow:async()=>{clicks++},craft:async()=>{await bot.clickWindow();count+=4;},pathfinder:{setGoal(){}},clearControlStates(){},stopDigging(){},deactivateItem(){}};
 world.recipeBook={snapshot:()=>({unlocked:[]})};world.bot=bot;world.observe=()=>{};world.table=()=>null;
 return {world,bot,getClicks:()=>clicks};
}
test('craft validates result and restores click handler',async()=>{
 const {world,bot}=fixture();const original=bot.clickWindow;
 const result=await world.execute('craft',new AbortController().signal,{craft:{item:'oak_planks',count:2}});
 assert.equal(result,'Crafted 8 oak_planks');assert.equal(bot.clickWindow,original);
 bot.craft=async()=>{};
 await assert.rejects(world.execute('craft',new AbortController().signal,{craft:{item:'oak_planks',count:1}}),/not confirmed/);
});
test('craft cancellation blocks subsequent clicks and restores handler',async()=>{
 const {world,bot,getClicks}=fixture();const original=bot.clickWindow;const c=new AbortController();
 bot.craft=async()=>{await bot.clickWindow();c.abort();await bot.clickWindow();};
 await assert.rejects(world.execute('craft',c.signal,{craft:{item:'oak_planks',count:2}}));
 assert.equal(getClicks(),1);assert.equal(bot.clickWindow,original);
});
test('empty path resolution is not reported as successful arrival',async()=>{
 const world=Object.create(MineflayerWorld.prototype) as any;
 world.observe=()=>{};world.bot={look:async()=>{},clearControlStates:()=>{},pathfinder:{setGoal:()=>{},getPathTo:()=>({path:[],status:'noPath'}),goto:async()=>{}},entity:{position:{floored:()=>({x:0,y:0,z:0})}}};
 await assert.rejects(world.navigate({isEnd:()=>false}),/Destination not reached/);
 await world.navigate({isEnd:()=>true});
});

test('cancellation during approach look cannot start navigation afterwards',async()=>{
 const world=Object.create(MineflayerWorld.prototype) as any,controller=new AbortController();let moves=0;
 world.observe=()=>{};world.bot={look:async()=>controller.abort(),clearControlStates:()=>{},pathfinder:{setGoal:()=>{},goto:async()=>{moves++;}},entity:{position:{x:0,y:0,z:0,floored:()=>({x:0,y:0,z:0})}}};
 await assert.rejects(world.navigate({x:2,z:0,isEnd:()=>false},controller.signal));assert.equal(moves,0);
});


test('incomplete paths use an observed frontier and navigation failure clears leftover motion',async()=>{
 const world=Object.create(MineflayerWorld.prototype) as any;let x=0,clears=0,calls=0,stops=0;
 world.observe=()=>{};world.bot={look:async()=>{},clearControlStates:()=>clears++,entity:{position:{x:0,y:0,z:0,floored:()=>({x,y:0,z:0})}},pathfinder:{setGoal:()=>stops++,getPathTo:()=>({path:[{x:2,y:0,z:0}],status:'noPath'}),goto:async(g:any)=>{calls++;assert.equal(g.x,2);x=2;}}};
 await world.navigate({x:2,y:0,z:0,isEnd:(p:any)=>p.x===2});assert.equal(calls,1);assert.ok(stops>0&&clears>0);
 x=0;world.bot.pathfinder.goto=async()=>{throw Error('No path');};await assert.rejects(world.navigate({x:2,y:0,z:0,isEnd:()=>false}),/No path/);assert.ok(stops>=4&&clears>=4);
});

test('crafting re-aims at the observed table after navigation turns the camera',async()=>{
 const {world,bot}=fixture();let aimed=true;
 const table={name:'crafting_table',position:{x:2,y:0,z:0,offset:()=>({x:2.5,y:.5,z:.5})}};
 world.table=()=>aimed?table:null;world.navigate=async()=>{aimed=false;};world.blockInSight=()=>aimed;
 bot.lookAt=async()=>{aimed=true;};bot.blockAt=()=>table;
 bot.recipesFor=(_id:any,_meta:any,_count:any,t:any)=>t?[{result:{count:4},delta:[{id:1,metadata:null,count:-1}]}]:[];
 assert.equal(await world.execute('craft',new AbortController().signal,{craft:{item:'oak_planks',count:1}}),'Crafted 4 oak_planks');
 bot.blockAt=()=>({name:'air'});
 await assert.rejects(world.execute('craft',new AbortController().signal,{craft:{item:'oak_planks',count:1}}),/Missing ingredients/);
});
