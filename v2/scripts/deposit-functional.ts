import {mkdirSync,appendFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {config} from '../src/config.js';
import {MineflayerWorld} from '../src/mineflayer.js';
import {candidates,type Plan} from '../src/types.js';
if(!process.argv.includes('--live-functional'))throw Error('Explicit functional flag required');
const dir=`runs/deposit-${Date.now()}`;mkdirSync(dir,{recursive:true,mode:0o700});
function log(event:string,data:unknown={}){const line=JSON.stringify({at:new Date().toISOString(),event,data});console.log(line);appendFileSync(dir+'/events.jsonl',line+'\n');}
const world=new MineflayerWorld('Bob',config(),(e,f)=>log(e,f)),stop=new AbortController(),container={x:3,y:-60,z:-3};
const hard=setTimeout(()=>{stop.abort();world.stop();world.close();log('hard_timeout');setTimeout(()=>process.exit(2),500);},60000);
const snapshot=()=>{const s=world.snapshot();return {position:s.position,health:s.health,inventory:s.inventory,containers:s.containers};};
async function face(){const bot=(world as any).bot;await bot.lookAt(bot.entity.position.scaled(0).offset(3.5,-59.5,-2.5),false);await world.execute('look',stop.signal,{goal:'Observe test chest',preferred:'look',look:{yaw:bot.entity.yaw,pitch:bot.entity.pitch}});}
try{
 for(let i=0;i<150&&!world.snapshot().ready;i++)await delay(100);if(!world.snapshot().ready)throw Error('Spawn timeout');await delay(1500);log('initial',snapshot());
 for(const pitch of [-Math.PI/2,-Math.PI/4])for(let i=0;i<8;i++)await world.execute('look',stop.signal,{goal:'Observe terrain',preferred:'look',look:{yaw:i*Math.PI/4,pitch}});
 await face();log('inspection',JSON.parse(await world.execute('inspect_container',stop.signal,{goal:'Inspect before storing',preferred:'inspect_container',container})));
 for(const item of ['cobblestone','iron_pickaxe'])for(const action of ['deposit','withdraw'] as const){
  await face();const plan:Plan={goal:'Functional chest round trip',preferred:action,container,transfer:{item,count:1}};
  if(!candidates(world.snapshot(),plan).includes(action))throw Error('Action unavailable');
  log('before',{action,item,state:snapshot()});const result=await world.execute(action,AbortSignal.any([stop.signal,AbortSignal.timeout(12000)]),plan);log('result',{action,item,result,state:snapshot()});await delay(1000);
 }
 await face();log('final_inspection',JSON.parse(await world.execute('inspect_container',stop.signal,{goal:'Verify restored chest',preferred:'inspect_container',container})));log('final',snapshot());
}catch(e){log('fatal',{error:e instanceof Error?e.message:String(e)});process.exitCode=1;}
finally{clearTimeout(hard);stop.abort();world.stop();world.close();log('closed',{dir,apiCalls:0});await delay(500);process.exit(process.exitCode??0);}
