import test from 'node:test';
import assert from 'node:assert/strict';
import {MineflayerWorld} from '../src/mineflayer.js';
function fixture() {
 const world=Object.create(MineflayerWorld.prototype) as any;
 let count=0, clicks=0;
 const bot:any={registry:{itemsByName:{oak_planks:{id:2}}},inventory:{items:()=>count?[{type:2,count}]:[],count:()=>10},recipesFor:()=>[{result:{count:4},delta:[{id:1,metadata:null,count:-1}]}],clickWindow:async()=>{clicks++},craft:async()=>{await bot.clickWindow();count+=4;},pathfinder:{setGoal(){}},clearControlStates(){},stopDigging(){},deactivateItem(){}};
 world.bot=bot;world.observe=()=>{};world.table=()=>null;
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
 world.bot={pathfinder:{goto:async()=>{}},entity:{position:{floored:()=>({x:0,y:0,z:0})}}};
 await assert.rejects(world.navigate({isEnd:()=>false}),/Destination not reached/);
 await world.navigate({isEnd:()=>true});
});
