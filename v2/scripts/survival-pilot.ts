import {RecoveryMemory} from '../src/recovery.js';
import {execFileSync} from 'node:child_process';
import {noOpMove} from '../src/pilot-report.js';
// Prepared bounded functional pilot. Never starts on import or without both explicit flags.
import {mkdirSync,appendFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';import {setTimeout as delay} from 'node:timers/promises';
import {config} from '../src/config.js';import {ApiBrain} from '../src/providers.js';import {Runtime} from '../src/runtime.js';
import {MineflayerWorld} from '../src/mineflayer.js';import {GoalBook} from '../src/goals.js';import {SocialMemory} from '../src/social.js';
import {openBotMemory,botMemoryLocation} from '../src/experience-memory.js';import {FunctionalLedger} from './functional-ledger.js';
import {compact} from '../src/planning.js';
import {pilotStopReason} from '../src/pilot.js';
if(!process.argv.includes('--live-functional')||!process.argv.includes('--with-api'))throw Error('Explicit live/API functional flags required');
process.env.MEMORY_NAMESPACE??='survival-pilot-v1';
const extended=process.argv.includes('--extended-functional');
const authorizedTotal=Number(process.argv.find(a=>a.startsWith('--authorized-total-usd='))?.split('=')[1]??5);
const source=(()=>{try{return {revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()};}catch{return {revision:null,dirty:null};}})();
const c={...config(),mode:'jev' as const};if(c.names.length!==2)throw Error('Pilot needs exactly two bot names');
if(!c.llmKey||!c.jevKey)throw Error('Missing API key');
const dir=join('runs',`survival-pilot-${Date.now()}`);mkdirSync(dir,{recursive:true,mode:0o700});
const ledger=new FunctionalLedger('runs/functional-cost-ledger.json',Math.min(c.maxCalls,extended?5000:300),Math.min(c.maxUsd,extended?2.25:.25),authorizedTotal);
let creditBlocked=false;
const transport:typeof fetch=async(url,init)=>{if(process.env.TRACE_MODEL_INPUTS==='1'&&typeof init?.body==='string'){const req=JSON.parse(init.body),input=req.messages?JSON.parse(req.messages.at(-1).content):req.state;log('api','model_input',{model:req.model,state:input.state??input.observation,plan:input.plan,requirements:input.responseRequirements,context:input,questions:req.questions});}const response=await fetch(url,init);if(response.status===402)creditBlocked=true;if(response.ok){const data=await response.clone().json();log('api','model_output',{model:String(url).startsWith(c.jevUrl)?c.jevModel:c.llmModel,content:data.choices?.[0]?.message?.content??data.answers,usage:data.usage});}else log('api','http_error',{status:response.status});return response;};
const budget=ledger.budget,brain=new ApiBrain(c,budget,transport),worlds:MineflayerWorld[]=[],runtimes:Runtime[]=[],pending=new Set<Promise<void>>();
let activityTimer:ReturnType<typeof setInterval>|undefined;
let respawnSince:number|null=null;let reason='',lastProgress=Date.now();const failureStreak=new Map<string,number>();const runtimeMs=Math.min(c.runSeconds,extended?1800:300)*1000;
const log=(bot:string,event:string,data:Record<string,unknown>={})=>{
 appendFileSync(join(dir,'events.jsonl'),JSON.stringify({at:Date.now(),bot,event,data})+'\n',{mode:0o600});
 if(event==='action_record'){
  const r=data.record as any;
  if(r.outcome==='failed'||r.outcome==='partial'||noOpMove(r))failureStreak.set(bot,(failureStreak.get(bot)??0)+1);else if(r.outcome==='succeeded'&&!noOpMove(r)&&!['idle','look'].includes(r.decision.action))failureStreak.set(bot,0);
  if(r.outcome==='succeeded'&&!noOpMove(r)&&!['idle','look'].includes(r.decision.action))lastProgress=Date.now();
 }else if(event==='social_speech'&&data.sent)lastProgress=Date.now();
};
budget.onDiagnostic=data=>log('api','api_request',data);
const interrupt=()=>{reason='operator_stop';};process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
try{
 writeFileSync(join(dir,'config.json'),JSON.stringify({source,mode:'live-functional',targetPolicy:c.targetPolicy,agentTrack:'A',goalInterface:'evidence-goals-v1',names:c.names,llmModel:c.llmModel,jevModel:c.jevModel,runtimeMs,maxCalls:budget.maxCalls,maxRunUsd:budget.maxUsd}),{mode:0o600});
 for(const name of c.names){const w=new MineflayerWorld(name,c,(e,f)=>log(name,e,f));worlds.push(w);const location=botMemoryLocation('--live',name,c);runtimes.push(new Runtime(w,brain,{selectorMs:c.tickMs,longPlanMs:c.longPlanMs,reflectionMs:c.reflectionMs,socialMs:c.socialMs,recovery:new RecoveryMemory(join(location.dir,'recovery.json')),planMs:c.planMs,actionMs:c.actionMs,minConfidence:c.minConfidence,selectorKind:'jev',goals:new GoalBook(join(location.dir,'goals.json'),location.profile),memory:openBotMemory('--live',name,c),social:new SocialMemory(name,join(location.dir,'social.json'))},(e,f)=>log(name,e,f)));}
 const connecting=Date.now();while(!reason&&!worlds.every(w=>w.snapshot().ready)&&Date.now()-connecting<20000)await delay(100);
 if(!worlds.every(w=>w.snapshot().ready))reason||='spawn_timeout';
 if(!reason)await delay(1000);
 for(let i=0;i<worlds.length;i++)log(c.names[i],'initial_observation',{observation:compact(worlds[i].snapshot())});
 const started=Date.now();lastProgress=started;
 activityTimer=setInterval(()=>{for(let i=0;i<runtimes.length;i++)log(c.names[i],'activity_sample',{...runtimes[i].executionStatus});},100);
 log('run','started',{runtimeMs});
 while(!reason){
  const states=worlds.map(w=>w.snapshot());if(states.some(s=>s.health<=0||s.lifecycle?.phase==='dead'))respawnSince??=Date.now();else respawnSince=null;
  reason=creditBlocked?'credit_required':budget.unsettledUsage?'usage_unknown':pilotStopReason({elapsedMs:Date.now()-started,maxMs:runtimeMs,authorizedMaxMs:extended?1800000:300000,states,allowRespawn:true,respawnWaitMs:respawnSince===null?0:Date.now()-respawnSince,budgetExhausted:budget.exhausted,noProgressMs:Math.max(0,Date.now()-lastProgress-Math.max(0,2*c.apiMs-30000)),agentGoalValidationFailures:runtimes.map(r=>r.executionStatus.hasLongGoal?0:r.executionStatus.goalValidationFailures),agentNoProgressMs:runtimes.map(r=>r.executionStatus.progress.noProgressMs),consecutiveFailures:Math.max(0,...failureStreak.values())})??'';
  if(reason)break;
  for(const r of runtimes){const task=r.tick().catch(()=>{reason='runtime_error';});pending.add(task);void task.finally(()=>pending.delete(task));}
  await delay(Math.max(1,Math.min(100,runtimeMs-(Date.now()-started))));
 }
}catch{reason='startup_or_runtime_error';process.exitCode=1;}
finally{
 if(activityTimer)clearInterval(activityTimer);log('run','stopped',{reason});
 for(let i=0;i<worlds.length;i++){try{log(c.names[i],'final_observation',{observation:compact(worlds[i].snapshot())});}catch{log(c.names[i],'final_observation_unavailable');}}
 for(const r of runtimes)r.close(true);for(const w of worlds)if(!runtimes.some(r=>r.world===w))w.close();
 // Disconnect immediately but drain already-dispatched model responses for usage accounting; late plans cannot execute.
 await Promise.race([Promise.allSettled([...pending]),delay(c.apiMs+1000)]);
 for(let i=0;i<Math.ceil((c.apiMs+1000)/100)&&budget.reservedUsd>1e-12;i++)await delay(100);
 const costs=ledger.finish();writeFileSync(join(dir,'summary.json'),JSON.stringify({reason,costs,budget,planning:runtimes.map(r=>r.planning)}),{mode:0o600});
 console.log(JSON.stringify({reason,costs,dir}));process.exit(process.exitCode??0);
}
