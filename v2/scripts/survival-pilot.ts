// Prepared bounded functional pilot. Never starts on import or without both explicit flags.
import {mkdirSync,appendFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';import {setTimeout as delay} from 'node:timers/promises';
import {config} from '../src/config.js';import {ApiBrain} from '../src/providers.js';import {Runtime} from '../src/runtime.js';
import {MineflayerWorld} from '../src/mineflayer.js';import {GoalBook} from '../src/goals.js';import {SocialMemory} from '../src/social.js';
import {openBotMemory,botMemoryLocation} from '../src/experience-memory.js';import {FunctionalLedger} from './functional-ledger.js';
import {pilotStopReason} from '../src/pilot.js';
if(!process.argv.includes('--live-functional')||!process.argv.includes('--with-api'))throw Error('Explicit live/API functional flags required');
process.env.MEMORY_NAMESPACE??='survival-pilot-v1';
const c={...config(),mode:'jev' as const};if(c.names.length!==2)throw Error('Pilot needs exactly two bot names');
if(!c.llmKey||!c.jevKey)throw Error('Missing API key');
const dir=join('runs',`survival-pilot-${Date.now()}`);mkdirSync(dir,{recursive:true,mode:0o700});
const ledger=new FunctionalLedger('runs/functional-cost-ledger.json',Math.min(c.maxCalls,300),Math.min(c.maxUsd,.25));
const budget=ledger.budget,brain=new ApiBrain(c,budget),worlds:MineflayerWorld[]=[],runtimes:Runtime[]=[],pending=new Set<Promise<void>>();
let reason='',lastProgress=Date.now();const failureStreak=new Map<string,number>();const runtimeMs=Math.min(c.runSeconds,300)*1000;
const log=(bot:string,event:string,data:Record<string,unknown>={})=>{
 appendFileSync(join(dir,'events.jsonl'),JSON.stringify({at:Date.now(),bot,event,...data})+'\n',{mode:0o600});
 if(event==='action_record'){
  const r=data.record as any;
  if(r.outcome==='failed'||r.outcome==='partial')failureStreak.set(bot,(failureStreak.get(bot)??0)+1);else if(r.outcome==='succeeded'&&!['idle','look'].includes(r.decision.action))failureStreak.set(bot,0);
  if(r.outcome==='succeeded'&&!['idle','look'].includes(r.decision.action))lastProgress=Date.now();
 }else if(event==='social_speech'&&data.sent)lastProgress=Date.now();
};
const interrupt=()=>{reason='operator_stop';};process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
try{
 writeFileSync(join(dir,'config.json'),JSON.stringify({mode:'live-functional',agentTrack:'A',goalInterface:'evidence-goals-v1',names:c.names,llmModel:c.llmModel,jevModel:c.jevModel,runtimeMs,maxCalls:budget.maxCalls,maxRunUsd:budget.maxUsd}),{mode:0o600});
 for(const name of c.names){const w=new MineflayerWorld(name,c,(e,f)=>log(name,e,f));worlds.push(w);const location=botMemoryLocation('--live',name,c);runtimes.push(new Runtime(w,brain,{planMs:c.planMs,actionMs:c.actionMs,minConfidence:c.minConfidence,selectorKind:'jev',goals:new GoalBook(join(location.dir,'goals.json'),location.profile),memory:openBotMemory('--live',name,c),social:new SocialMemory(name,join(location.dir,'social.json'))},(e,f)=>log(name,e,f)));}
 const connecting=Date.now();while(!reason&&!worlds.every(w=>w.snapshot().ready)&&Date.now()-connecting<20000)await delay(100);
 if(!worlds.every(w=>w.snapshot().ready))reason||='spawn_timeout';
 const started=Date.now();lastProgress=started;
 while(!reason){
  reason=pilotStopReason({elapsedMs:Date.now()-started,maxMs:runtimeMs,states:worlds.map(w=>w.snapshot()),budgetExhausted:budget.exhausted,noProgressMs:Date.now()-lastProgress,consecutiveFailures:Math.max(0,...failureStreak.values())})??'';
  if(reason)break;
  for(const r of runtimes){const task=r.tick().catch(()=>{reason='runtime_error';});pending.add(task);void task.finally(()=>pending.delete(task));}
  await delay(Math.max(100,c.tickMs));
 }
}catch{reason='startup_or_runtime_error';process.exitCode=1;}
finally{
 for(const r of runtimes)r.close();for(const w of worlds)if(!runtimes.some(r=>r.world===w))w.close();
 // Close aborts model requests; allow usage handling to settle before writing the cumulative ledger.
 await Promise.race([Promise.allSettled([...pending]),delay(c.apiMs+1000)]);
 for(let i=0;i<100&&budget.reservedUsd>1e-12;i++)await delay(100);
 const costs=ledger.finish();writeFileSync(join(dir,'summary.json'),JSON.stringify({reason,costs,budget,planning:runtimes.map(r=>r.planning)}),{mode:0o600});
 console.log(JSON.stringify({reason,costs,dir}));process.exit(process.exitCode??0);
}
