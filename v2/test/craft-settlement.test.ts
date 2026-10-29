import test from 'node:test';
import assert from 'node:assert/strict';
import {settleCraftInventory} from '../src/craft-settlement.js';
import {MineflayerWorld} from '../src/mineflayer.js';
function fixture(){
 const inv:any={id:0,inventoryStart:9,inventoryEnd:45,selectedItem:null,slots:Array(46).fill(null)};
 const server={cursor:{name:'oak_planks',count:4} as any,grid:{name:'oak_log',count:1} as any};let carried=0,syncs=0;const clicks:number[]=[];
 const bot:any={inventory:inv,_syncWindow:async()=>{syncs++;await new Promise(r=>setTimeout(r,2));inv.selectedItem=server.cursor;inv.slots[1]=server.grid;},putSelectedItemRange:async()=>{carried+=server.cursor.count;server.cursor=null;},putAway:async(slot:number)=>{clicks.push(slot);server.grid=null;}};
 return {bot,inv,server,clicks,carried:()=>carried,syncs:()=>syncs};
}
test('authoritative cursor and leftover ingredients are settled without clicking crafting output',async()=>{
 const f=fixture();await settleCraftInventory(f.bot);
 assert.equal(f.carried(),4);assert.deepEqual(f.clicks,[1]);assert.equal(f.inv.selectedItem,null);assert.equal(f.inv.slots[1],null);assert.equal(f.syncs(),3);
});
test('full inventory is reported, never throws cursor items onto ground',async()=>{
 const f=fixture();f.bot.putSelectedItemRange=async()=>{};await assert.rejects(settleCraftInventory(f.bot),/incomplete/);assert.ok(!f.clicks.includes(-999));
});
test('craft waits for per-batch authoritative inventory before confirming output',async()=>{
 const f=fixture();f.server.cursor=null;f.server.grid=null;let held=0,pending=0,crafts=0;
 f.bot._syncWindow=async()=>{await new Promise(r=>setTimeout(r,2));held+=pending;pending=0;};
 Object.assign(f.bot,{registry:{itemsByName:{oak_planks:{id:2}}},recipesFor:()=>[{result:{count:4},delta:[]}],clickWindow:async()=>{},craft:async()=>{crafts++;pending+=4;},pathfinder:{setGoal(){}},clearControlStates(){},stopDigging(){},deactivateItem(){}});
 f.inv.items=()=>[{type:2,name:'oak_planks',count:held}];f.inv.count=()=>10;
 const world=Object.create(MineflayerWorld.prototype) as any;world.bot=f.bot;world.observe=()=>{};world.table=()=>null;world.recipeBook={snapshot:()=>({unlocked:[]})};
 assert.equal(await world.execute('craft',new AbortController().signal,{craft:{item:'oak_planks',count:2}}),'Crafted 8 oak_planks');assert.equal(crafts,2);
 const abort=new AbortController();f.bot.craft=async()=>{crafts++;pending+=4;abort.abort();};
 await assert.rejects(world.execute('craft',abort.signal,{craft:{item:'oak_planks',count:2}}));
 assert.equal(crafts,3);assert.equal(held,12);assert.deepEqual(world.executionReceipt().actionEvidence.inventoryDelta,[{item:'oak_planks',delta:4}]);
});
