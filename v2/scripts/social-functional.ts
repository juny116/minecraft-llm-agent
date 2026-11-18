import {mkdirSync,appendFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {config} from '../src/config.js';
import {ApiBrain,Budget} from '../src/providers.js';
import {MineflayerWorld} from '../src/mineflayer.js';
import {Runtime} from '../src/runtime.js';
import {SocialMemory} from '../src/social.js';
import {openBotMemory,botMemoryLocation} from '../src/experience-memory.js';
if(!process.argv.includes('--live-functional')||!process.argv.includes('--with-social'))throw Error('Explicit --live-functional --with-social required');
const c=config(),budget=new Budget(18,.05),brain=new ApiBrain({...c,mode:'jev',maxOutput:1024,apiMs:10000},budget);
const dir=join('runs','social-functional-'+Date.now());mkdirSync(dir,{recursive:true,mode:0o700});
function log(bot:string,event:string,fields:unknown={}){const line=JSON.stringify({at:new Date().toISOString(),bot,event,fields});appendFileSync(join(dir,'events.jsonl'),line+'\n',{mode:0o600});console.log(line);}
const names=['Alice','Bob'],worlds:MineflayerWorld[]=[],runtimes:Runtime[]=[];
let stopping=false;const controller=new AbortController();
function stop(reason:string){if(stopping)return;stopping=true;controller.abort();for(const r of runtimes)r.close();for(const w of worlds)w.close();writeFileSync(join(dir,'summary.json'),JSON.stringify({reason,budget,models:{llm:c.llmModel,jev:c.jevModel}}),{mode:0o600});log('both','closed',{reason,budget,dir});}
const hard=setTimeout(()=>stop('90_second_process_limit'),90000);process.once('SIGTERM',()=>stop('SIGTERM'));process.once('SIGINT',()=>stop('SIGINT'));
try{
 for(const name of names)worlds.push(new MineflayerWorld(name,c,(e,f)=>log(name,e,f)));
 for(let n=0;n<150&&!worlds.every(w=>w.snapshot().ready);n++)await delay(100,undefined,{signal:controller.signal});
 if(!worlds.every(w=>w.snapshot().ready))throw Error('Spawn timeout');
 await Promise.all(worlds.map(async w=>{for(const pitch of [-Math.PI/2,-Math.PI/4])for(let i=0;i<8;i++)await w.execute('look',controller.signal,{goal:'Observe initial surroundings',preferred:'look',look:{yaw:i*Math.PI/4,pitch}});await w.execute('look',controller.signal,{goal:'Look ahead',preferred:'look',look:{yaw:-Math.PI/2,pitch:0}});}));
 for(let i=0;i<2;i++){const name=names[i];runtimes.push(new Runtime(worlds[i],brain,{planMs:15000,actionMs:7000,minConfidence:c.minConfidence,selectorKind:'jev',reflectionEnabled:false,memory:openBotMemory('--live',name,c),social:new SocialMemory(name,join(botMemoryLocation('--live',name,c).dir,'social.json'))},(e,f)=>log(name,e,f)));}
 log('both','social_ready',{dir,limits:{calls:18,estimatedUsd:.05,seconds:60},assignedGoal:null});
 const start=Date.now();while(!stopping&&Date.now()-start<60000&&!budget.exhausted){
  if(worlds.some(w=>!w.snapshot().ready||w.snapshot().health<=10)){stop('health_or_connection');break;}
  for(const r of runtimes)void r.tick().catch(()=>stop('runtime_error'));
  await delay(2000,undefined,{signal:controller.signal});
 }
 stop(budget.exhausted?'api_budget_limit':'60_second_functional_limit');
}catch(e){log('both','error',{message:e instanceof Error?e.message:String(e)});stop('error');}
finally{clearTimeout(hard);await delay(500);writeFileSync(join(dir,'summary.json'),JSON.stringify({budget,dir,stopped:true}),{mode:0o600});process.exit(0);}
