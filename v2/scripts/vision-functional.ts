import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {config} from '../src/config.js';
import {MineflayerWorld} from '../src/mineflayer.js';
if(!process.argv.includes('--live-functional'))throw Error('Explicit --live-functional required');
const world=new MineflayerWorld('Bob',config(),event=>console.log(event));
const bot=(world as any).bot;
const deadline=setTimeout(()=>{world.stop();world.close();process.exit(2)},70000);
const signal=()=>AbortSignal.timeout(15000);
try{
 for(let i=0;i<150&&!world.snapshot().ready;i++)await delay(100);
 assert.ok(world.snapshot().ready);
 console.log(JSON.stringify({event:'initial',state:world.snapshot()}));
 for(let i=0;i<8;i++)await world.execute('look',signal(),{goal:'functional view scan',preferred:'look',look:{yaw:i*Math.PI/4,pitch:-Math.PI/4}});
 for(let i=0;i<8;i++)await world.execute('look',signal(),{goal:'horizontal scan',preferred:'look',look:{yaw:i*Math.PI/4,pitch:0}});
 await world.execute('look',signal(),{goal:'inspect immediate floor',preferred:'look',look:{yaw:0,pitch:-Math.PI/2}});
 const remembered=world.snapshot().places!;assert.ok(remembered.length>0);
 await world.execute('look',signal(),{goal:'look upward',preferred:'look',look:{yaw:0,pitch:Math.PI/2}});
 assert.ok(world.snapshot().places!.length>0);assert.ok(world.snapshot().vision!.blocks.length<remembered.length);
 console.log(JSON.stringify({event:'memory_pass',remembered:remembered.length,visibleUp:world.snapshot().vision!.blocks.length}));
 // Fixture preparation only: withdraw one existing log from the shared chest.
 // Withdrawal is not exposed as an agent action.
 const chest=remembered.find(b=>b.name==='chest');
 if(chest){
   const {createRequire}=await import('node:module');const req=createRequire(import.meta.url);
   const {goals}=req('mineflayer-pathfinder');
   await bot.pathfinder.goto(new goals.GoalNear(chest.position.x,chest.position.y,chest.position.z,2));
   const w=await bot.openChest(bot.blockAt(bot.entity.position.scaled(0).offset(chest.position.x,chest.position.y,chest.position.z)));
   try{const log=w.containerItems().find((i:any)=>i.name.endsWith('_log'));if(log)await w.withdraw(log.type,log.metadata,1);}finally{w.close();}
 }
 const log=bot.inventory.items().find((i:any)=>i.name.endsWith('_log'));
 if(log){
  const item=log.name.replace(/_log$/,'_planks');
  console.log(await world.execute('craft',signal(),{goal:'one crafting check',preferred:'craft',craft:{item,count:1}}));
  assert.ok(world.snapshot().inventory!.some(i=>i.name===item&&i.count>=4));
  console.log('craft_pass');
 } else console.log('craft_pending_no_carried_log');
 const dest=remembered.find(b=>b.name==='grass_block'&&Math.hypot(b.position.x-bot.entity.position.x,b.position.z-bot.entity.position.z)>3);
 if(dest)console.log(await world.execute('move',signal(),{goal:'remembered destination check',preferred:'move',destination:dest.position}));
 console.log(JSON.stringify({event:'final',state:world.snapshot()}));
}catch(e){console.error(e);process.exitCode=1;}
finally{world.stop();world.close();clearTimeout(deadline);setTimeout(()=>process.exit(process.exitCode||0),500);}
