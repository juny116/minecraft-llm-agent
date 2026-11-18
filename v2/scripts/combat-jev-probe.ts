import {openBotMemory} from '../src/experience-memory.js';
import {Journal,compact,changes,classify,type Outcome} from '../src/planning.js';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {config} from '../src/config.js';
import {MineflayerWorld} from '../src/mineflayer.js';
import {ApiBrain,Budget} from '../src/providers.js';
import {CombatStart} from '../src/combat-start.js';
import {chooseCombat} from '../src/combat-decision.js';
if(!process.argv.includes('--live-functional')||!process.argv.includes('--with-jev'))throw Error('Requires explicit --live-functional --with-jev');
const startTrigger=new CombatStart();
const c=config(),budget=new Budget(4,.01),brain=new ApiBrain({...c,mode:'jev'},budget);
const memory=openBotMemory('--live','Bob',c),journal=new Journal();
const world=new MineflayerWorld('Bob',c,e=>log(e));
const bot=(world as any).bot;
const lifetime=new AbortController();
let stage='connecting',closed=false;
function log(event:string,detail:unknown={}){console.log(JSON.stringify({time:new Date().toISOString(),event,detail}));}
function close(reason:string){if(closed)return;closed=true;lifetime.abort();world.stop();world.close();log('closed',{reason,calls:budget.calls,estimatedUsd:budget.usd,unknownUsage:budget.unknownUsage});}
const hardStop=setTimeout(()=>{close('five_minute_limit');process.exit(2)},300000);
const monitor=setInterval(()=>{
 const s=world.snapshot();
 writeFileSync('runs/combat-jev-state.json',JSON.stringify({time:new Date().toISOString(),pid:process.pid,stage,online:s.ready,position:s.position,health:s.health,equipment:s.equipment,calls:budget.calls,estimatedUsd:budget.usd}),{mode:0o600});
 if(s.ready&&s.health<=10)close('functional_probe_health_floor_10');
},200);
process.on('SIGTERM',()=>close('SIGTERM'));
try{
 for(let i=0;i<150&&!world.snapshot().ready;i++)await delay(100,undefined,{signal:lifetime.signal});
 assert.ok(world.snapshot().ready,'Spawn timeout');
 stage='floor_scan';
 for(const pitch of [-Math.PI/2,-Math.PI/4])for(let i=0;i<8;i++)await world.execute('look',lifetime.signal,{goal:'functional floor scan',preferred:'look',look:{yaw:i*Math.PI/4,pitch}});
 await world.execute('look',lifetime.signal,{goal:'face prepared mob',preferred:'look',look:{yaw:-Math.PI/2,pitch:0}});
 stage='waiting_for_visible_zombie';log(stage,{position:world.snapshot().position,health:world.snapshot().health,equipment:world.snapshot().equipment});
 // Arm BEFORE administrator enables AI. No human-relayed gate after activation.
 while(!closed){
  lifetime.signal.throwIfAborted();
  const state=world.snapshot();assert.ok(state.ready,'Disconnected before start');
  const status=startTrigger.update(state.enemies??[]);
  if(status==='armed'&&stage!=='armed_waiting_for_motion'){
   stage='armed_waiting_for_motion';log(stage,{target:state.enemies?.[0],pollMs:50,displacementThreshold:.15});
  }
  if(status==='start'){stage='motion_detected';log(stage,{target:state.enemies?.[0]});break;}
  await delay(50,undefined,{signal:lifetime.signal});
 }
 lifetime.signal.throwIfAborted();
 const encounterTimer=setTimeout(()=>close('30_second_active_probe_limit'),30000);
 try{
  for(let i=0;i<4&&!closed&&!budget.exhausted;i++){
   stage='jev_choice';
   const selected=await chooseCombat({snapshot:()=>{const s=world.snapshot();s.memoryGuidance=memory.retrieve(s);return s;},brain,exhausted:()=>budget.exhausted,signal:lifetime.signal,minConfidence:c.minConfidence,
    log:(event,detail)=>log(event,{...(detail as object),model:c.jevModel,calls:budget.calls,estimatedUsd:budget.usd})});
   if(!selected){log('decision_sequence_stopped',{calls:budget.calls,budgetExhausted:budget.exhausted});break;}
   const {choice,state}=selected,target=state.enemies![0].id;
   let hurt=0;const onHurt=(e:any)=>{if(e?.id===target)hurt++;};bot.on('entityHurt',onHurt);
   stage='local_'+choice.action;
   const before=world.snapshot(),startedAt=Date.now();let result='incomplete',outcome:Outcome='failed';
   try{result=await world.execute(choice.action,AbortSignal.any([lifetime.signal,AbortSignal.timeout(5000)]));outcome=classify(choice.action,result);log('local_result',{action:choice.action,result,targetHurtEvents:hurt,health:world.snapshot().health,position:world.snapshot().position});}
   catch(e){outcome=lifetime.signal.aborted?'cancelled':'failed';throw e;}
   finally{
    bot.removeListener('entityHurt',onHurt);
    const after=world.snapshot(),a=compact(before),b=compact(after);
    memory.add(journal.add({decision:choice,decisionObserved:compact(state),source:'selector',selectorKind:'jev',options:['idle','attack','flee'],planVersion:0,goal:null,stepId:null,before:a,after:b,changes:changes(a,b),outcome,result,startedAt,endedAt:Date.now()}),(state.memoryGuidance??[]).map(g=>({id:g.id,version:g.version})));
   }
   const evidence=world.snapshot().combatEvents?.find(e=>e.id===target);
   log('target_evidence',evidence);
   if(evidence?.deathObserved){log('death_confirmed',{ownKillConfirmed:evidence.ownKillConfirmed});break;}
   await delay(200,undefined,{signal:lifetime.signal});
  }
 }finally{clearTimeout(encounterTimer);}
 stage='finished';
}catch(e){stage='stopped_or_failed';log(stage,e instanceof Error?e.message:String(e));process.exitCode=1;}
finally{close(stage);clearInterval(monitor);clearTimeout(hardStop);setTimeout(()=>process.exit(process.exitCode||0),500);}
