import {mkdirSync,appendFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {config} from '../src/config.js';
import {MineflayerWorld} from '../src/mineflayer.js';
import type {Plan} from '../src/types.js';
if(!process.argv.includes('--live-functional'))throw Error('Explicit functional flag required');
const dir=`runs/build-mine-${Date.now()}`;mkdirSync(dir,{recursive:true,mode:0o700});
function log(event:string,data:unknown={}){const line=JSON.stringify({at:new Date().toISOString(),event,data});console.log(line);appendFileSync(dir+'/events.jsonl',line+'\n');}
const world=new MineflayerWorld('Bob',config(),(e,f)=>log(e,f)),bot=(world as any).bot;
const stop=new AbortController();const hard=setTimeout(()=>{stop.abort();world.stop();world.close();process.exitCode=2;},150000);
function snapshot(){const s=world.snapshot();return {ready:s.ready,position:s.position,health:s.health,inventory:s.inventory};}
async function aim(p:{x:number;y:number;z:number}){await bot.lookAt(bot.entity.position.scaled(0).offset(p.x+.5,p.y+.5,p.z+.5),false);await world.execute('look',stop.signal,{goal:'Inspect known functional fixture',preferred:'look',look:{yaw:bot.entity.yaw,pitch:bot.entity.pitch}});}
async function run(label:string,plan:Plan){log('before',{label,state:snapshot()});try{const result=await world.execute(plan.preferred,AbortSignal.any([stop.signal,AbortSignal.timeout(40000)]),plan);log('result',{label,result:plan.preferred==='mine'?JSON.parse(result):result});}catch(e){log('error',{label,error:e instanceof Error?e.message:String(e)});}log('after',{label,state:snapshot()});await delay(1000);}
try{
 for(let i=0;i<150&&!world.snapshot().ready;i++)await delay(100);if(!world.snapshot().ready)throw Error('Spawn timeout');await delay(2000);log('initial',snapshot());
 for(const pitch of [-Math.PI/2,-Math.PI/4])for(let i=0;i<8;i++)await world.execute('look',stop.signal,{goal:'Observe test terrain',preferred:'look',look:{yaw:i*Math.PI/4,pitch}});
 const floor={x:31,y:-61,z:0},plank={x:31,y:-60,z:0},glass={x:31,y:-60,z:3},stone={x:31,y:-60,z:-3};
 await aim(floor);await run('place_planks',{goal:'Functional block placement',preferred:'place_block',build:{item:'oak_planks',position:plank,reference:floor}});
 await aim(plank);await run('mine_planks',{goal:'Functional break and pickup',preferred:'mine',mine:{position:plank,expected:'oak_planks',maxMs:10000}});
 await aim(glass);await run('mine_glass_no_silk',{goal:'Functional break without expected yield',preferred:'mine',mine:{position:glass,expected:'glass',tool:'iron_pickaxe',maxMs:10000}});
 await aim(stone);await run('mine_stone_short_attempt',{goal:'Functional incomplete timed attempt',preferred:'mine',mine:{position:stone,expected:'stone',tool:'bread',maxMs:1000}});
 await aim(stone);await run('mine_stone_pickaxe',{goal:'Functional stone drop pickup',preferred:'mine',mine:{position:stone,expected:'stone',tool:'iron_pickaxe',maxMs:10000}});
 log('final',snapshot());
}catch(e){log('fatal',{error:e instanceof Error?e.message:String(e)});process.exitCode=1;}
finally{clearTimeout(hard);stop.abort();world.stop();world.close();log('closed',{dir,apiCalls:0});await delay(500);process.exit(process.exitCode??0);}
