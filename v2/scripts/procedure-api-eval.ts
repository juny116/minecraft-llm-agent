// Actual model calls, synthetic observations/motors. Never opens a Minecraft connection.
// Comparison deliberately shares the initial LLM procedure and auto-starts it in
// both arms, isolating mid-execution supervision rather than initial approval.
import {mkdirSync,writeFileSync,appendFileSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {config} from '../src/config.js';
import {ApiBrain,Budget} from '../src/providers.js';
import {ProcedureRunner,carried,recipeKey,type RecipeFact} from '../src/procedure.js';
import {bindWorkIntent} from '../src/task-review.js';
import {classify,compact,changes,type PlanningContext} from '../src/planning.js';
import {candidates,type Action,type Plan,type Snapshot,type MotorProgress} from '../src/types.js';
import {executionIdentity,type SupervisorInput,type Supervision} from '../src/supervision.js';

type Case={id:string;wood:'oak'|'birch';logs:number;planks:number};
const cases:Case[]=[{id:'oak_empty',wood:'oak',logs:0,planks:0},{id:'oak_partial',wood:'oak',logs:1,planks:3},{id:'birch_empty',wood:'birch',logs:0,planks:0}];
type Scenario='normal'|'hunger'|'threat';
const context=(goal:string):PlanningContext=>({longTermGoal:goal,userRequest:goal,mediumTerm:{summary:'Choose a bounded work procedure from observations',steps:[],activeStep:0},replanReasons:['initial'],recentActions:[],olderSummary:{count:0,byAction:{},inventoryNet:{},healthNet:0},failureStreak:0});
const goalFor=(c:Case)=>`주변에서 관측한 ${c.wood==='oak'?'참나무':'자작나무'} 원목을 필요한 만큼 모아 ${c.wood}_planks를 최종 8개 이상 소지하세요. 이미 소지한 원목과 판자는 활용하세요.`;
class SimWorld{
 state:Snapshot;recipe:RecipeFact;active?:{action:Action;at:number;duration:number};
 firstStart?:number;disturbanceAt?:number;responseAt?:number;responseAction?:Action;starvationNoted=false;hitNoted=false;
 starts:any[]=[];finishes:any[]=[];activeCount=0;maxActive=0;retreated=false;
 constructor(readonly c:Case,readonly scenario:Scenario='normal',readonly instant=false){
  const log=c.wood+'_log',planks=c.wood+'_planks';
  this.recipe={key:'',item:planks,output:4,ingredients:[{item:log,count:1}],requiresTable:false};this.recipe.key=recipeKey(this.recipe);
  const blocks=Array.from({length:8},(_,i)=>({name:log,position:{x:3+i%4,y:64+Math.floor(i/4),z:2},lastSeen:Date.now()}));
  const floor=Array.from({length:25},(_,i)=>({name:'grass_block',position:{x:i%5-2,y:63,z:Math.floor(i/5)-2},lastSeen:Date.now()}));
  this.state={ready:true,health:20,food:20,logs:c.logs,canMine:true,canDeposit:false,canEat:false,canFollow:false,position:{x:0,y:64,z:0},dimension:'overworld',messages:[],
   recipeBook:{initialized:true,unlocked:[`minecraft:${planks}`]},inventory:[{name:'bread',count:2,slot:9},{name:'wooden_axe',count:1,slot:36},...(c.logs?[{name:log,count:c.logs,slot:10}]:[]),...(c.planks?[{name:planks,count:c.planks,slot:11}]:[])],
   equipment:[{slot:'hand',name:'wooden_axe'}],edibleItems:['bread'],craftable:c.logs?[planks]:[],inventoryCraftable:c.logs?[planks]:[],
   vision:{yaw:0,pitch:0,blocks:[...blocks,...floor]},places:[],visibleItems:[],enemies:[],
   perception:{mode:'panorama',range:48,semantics:'Synthetic controlled fixture: automatic all-direction occlusion-aware current observations; no hidden targets supplied.'},
   navigationTargets:[{x:-5,y:64,z:0},{x:5,y:64,z:0},{x:0,y:64,z:5}],environment:{inWater:false,inLava:false,onGround:true},incomingDamage:[]};
 }
 set(item:string,count:number){
  const old=this.state.inventory!.find(i=>i.name===item);
  if(old)old.count=count;else if(count>0){const slot=Array.from({length:36},(_,i)=>i+9).find(n=>!this.state.inventory!.some(i=>i.slot===n))!;this.state.inventory!.push({name:item,count,slot});}
  this.state.inventory=this.state.inventory!.filter(i=>i.count>0);
  this.state.logs=carried(this.state,this.c.wood+'_log');
  this.state.craftable=this.state.inventoryCraftable=this.state.logs?[this.c.wood+'_planks']:[];
 }
 snapshot(){
  const now=Date.now(),elapsed=this.firstStart===undefined?0:now-this.firstStart;
  if(this.scenario!=='normal'&&elapsed>=500&&!this.disturbanceAt){
   this.disturbanceAt=now;
   if(this.scenario==='hunger'){this.state.food=0;this.state.canEat=true;}
   else{this.state.health=16;this.state.enemies=[{id:41,kind:'zombie',position:{x:1.5,y:64,z:0},distance:1.5}];this.state.incomingDamage=[{at:now,type:'hit',attacker:{id:41,kind:'zombie'}},{at:now,type:'health_loss',before:20,after:16,amount:4}];}
  }
  // Fixed injected observations, not a Minecraft damage simulator.
  if(this.disturbanceAt&&this.scenario==='hunger'&&elapsed>=6000&&this.state.food===0&&!this.starvationNoted){this.starvationNoted=true;this.state.health-=1;this.state.incomingDamage!.push({at:now,type:'health_loss',before:this.state.health+1,after:this.state.health,amount:1});}
  if(this.disturbanceAt&&this.scenario==='threat'&&elapsed>=6000&&!this.retreated&&!this.hitNoted){this.hitNoted=true;const before=this.state.health;this.state.health-=4;this.state.incomingDamage!.push({at:now,type:'hit',attacker:{id:41,kind:'zombie'}},{at:now,type:'health_loss',before,after:this.state.health,amount:4});}
  this.state.canEat=this.state.food<20&&carried(this.state,'bread')>0;
  return structuredClone(this.state);
 }
 progress():MotorProgress|undefined{
  if(!this.active)return;const elapsed=Date.now()-this.active.at,action=this.active.action;
  return {phase:action==='mine'?'digging':action==='craft'?'crafting':action==='attack'||action==='flee'?'tracking':'prepare',phaseElapsedMs:elapsed,estimatedDigMs:action==='mine'?this.active.duration:undefined,estimatedRemainingMs:action==='mine'?Math.max(0,this.active.duration-elapsed):undefined,digBudgetMs:action==='mine'?10000:undefined,blockBroken:false};
 }
 async execute(action:Action,signal:AbortSignal,plan:Plan){
  const duration=this.instant?0:action==='mine'?4000:action==='craft'?1500:action==='eat'?1600:action==='attack'||action==='flee'?1800:600;
  const at=Date.now();this.firstStart??=at;this.active={action,at,duration};this.activeCount++;this.maxActive=Math.max(this.maxActive,this.activeCount);
  this.snapshot();this.starts.push({at,action,plan:structuredClone(plan)});
  if(this.disturbanceAt&&!this.responseAt&&(this.scenario==='hunger'&&action==='eat'||this.scenario==='threat'&&['attack','flee'].includes(action))){this.responseAt=at;this.responseAction=action;}
  try{
   await delay(duration,undefined,{signal});this.snapshot();
   if(action==='mine'){
    const i=this.state.vision!.blocks.findIndex(b=>b.name===plan.mine?.expected&&JSON.stringify(b.position)===JSON.stringify(plan.mine.position));
    if(i<0)throw Error('No current mining target');
    const [b]=this.state.vision!.blocks.splice(i,1);this.set(b.name,carried(this.state,b.name)+1);
    return JSON.stringify({kind:'mining',target:plan.mine,blockBroken:true,status:'finished',drops:[],inventoryGained:[{name:b.name,count:1}]});
   }
   if(action==='craft'){
    const r=plan.craft!;if(r.item!==this.recipe.item||r.recipeKey&&r.recipeKey!==this.recipe.key)throw Error('Unknown item recipe in fixture');
    if(carried(this.state,this.c.wood+'_log')<r.count)throw Error('Insufficient crafting material');
    this.set(this.c.wood+'_log',carried(this.state,this.c.wood+'_log')-r.count);this.set(r.item,carried(this.state,r.item)+4*r.count);return `Crafted ${r.count*4} ${r.item}`;
   }
   if(action==='eat'){if(carried(this.state,plan.foodItem??'bread')<1)throw Error('Missing food');this.set(plan.foodItem??'bread',carried(this.state,plan.foodItem??'bread')-1);this.state.food=Math.min(20,this.state.food+5);return 'Ate bread';}
   if(action==='flee'){this.retreated=true;this.state.position={x:-8,y:64,z:0};this.state.enemies=[];return JSON.stringify({outcome:'distance_increased',synthetic:true});}
   if(action==='attack')return JSON.stringify({outcome:'time_limit',synthetic:true,note:'Attack attempt only; fixture does not simulate combat damage or kills'});
   if(action==='move'&&plan.destination){this.state.position=structuredClone(plan.destination);return 'Synthetic move completed';}
   if(action==='equip'){this.state.equipment=[{slot:plan.equip!.destination,name:plan.equip!.item??'air'}];return 'Synthetic equipment update';}
   throw Error('Fixture does not simulate this action: '+action);
  }finally{this.active=undefined;this.activeCount--;this.finishes.push({at:Date.now(),action,cancelled:signal.aborted});}
 }
}
function quickExecution(plan:Plan,c:Case){
 return (async()=>{
  if(!plan.procedure)return {valid:false,reason:'LLM omitted procedure'};
  const w=new SimWorld(c,'normal',true),r=new ProcedureRunner(plan,plan.procedure);
  for(let n=0;n<65;n++){
   const cmd=r.next(w.snapshot(),item=>item===w.recipe.item?[w.recipe]:[]);
   if(!cmd)break;
   try{const result=await w.execute(cmd.action,new AbortController().signal,cmd.plan);r.finish(classify(cmd.action,result),w.snapshot());}
   catch{r.finish('failed',w.snapshot());}
  }
  return {valid:r.view().status==='completed'&&carried(w.state,c.wood+'_planks')>=8,procedure:r.view(),inventory:w.state.inventory,actions:w.starts};
 })();
}
async function compareArm(api:Pick<ApiBrain,'supervise'>,plan:Plan,c:Case,scenario:Scenario,supervised:boolean,budget:Budget,log:(e:any)=>void,horizonMs=14000){
 const w=new SimWorld(c,scenario),started=Date.now(),life=new AbortController();
 let runner=new ProcedureRunner(plan,plan.procedure!),active:{id:number;action:Action;plan:Plan;at:number;controller:AbortController;task:Promise<void>;observed:Snapshot}|undefined;
 let id=0,pending:Promise<void>|undefined,lastCall=0,closed=false;
 const rows:any[]=[],decisions:any[]=[];let restarts=0;
 const record=(e:any)=>{rows.push({at:Date.now(),...e});log(rows.at(-1));};
 const pump=()=>{if(closed||active||runner.view().status!=='running')return;const cmd=runner.next(w.snapshot(),item=>item===w.recipe.item?[w.recipe]:[]);if(cmd)start(cmd.action,cmd.plan,runner);else record({event:'procedure_boundary',state:runner.view()});};
 const start=(action:Action,p:Plan,owner?:ProcedureRunner)=>{
  const controller=new AbortController(),observed=w.snapshot(),before=compact(observed);
  const execution={id:++id,action,plan:structuredClone(p),at:Date.now(),controller,observed,task:undefined as unknown as Promise<void>};active=execution;
  record({event:'action_start',id,action,source:owner?'local_procedure':'jev',plan:p});
  execution.task=(async()=>{
   let result='',outcome:import('../src/planning.js').Outcome='failed';
   try{result=await w.execute(action,AbortSignal.any([controller.signal,life.signal]),p);outcome=controller.signal.aborted?'cancelled':classify(action,result);}
   catch(e){result=e instanceof Error?e.message:'fixture error';outcome=controller.signal.aborted||life.signal.aborted?'cancelled':'failed';}
   const after=w.snapshot();owner?.finish(outcome,after);record({event:'action_end',id:execution.id,action,outcome,result,changes:changes(before,compact(after))});
   if(active===execution)active=undefined;
   if(!closed&&owner===runner&&runner.view().status==='running')pump();
  })();
 };
 const cancel=async(reason:string)=>{runner.suspend(reason);const old=active;if(old){old.controller.abort();await old.task;}};
 // Shared experimental initialization, not an actual JEV decision.
 record({event:'shared_procedure_start',source:'experiment_autostart',definition:plan.procedure});pump();
 while(Date.now()-started<horizonMs&&!budget.exhausted){
  const s=w.snapshot();
  if(supervised&&!pending&&Date.now()-lastCall>=1000){
   lastCall=Date.now();const observedId=id,motor=w.progress(),requested=lastCall;
   const input:SupervisorInput={parameterSelection:true,options:[],execution:active?{id:active.id,action:active.action,plan:active.plan,elapsedMs:Date.now()-active.at,motor,observedChanges:changes(compact(active.observed),compact(s))}:null,inbox:[],goal:goalFor(c),plan,procedure:runner.view(),procedureAvailable:true,
    recentResults:rows.filter(e=>e.event==='action_end').slice(-4),progress:{noProgressMs:0}};
   record({event:'supervisor_input',snapshot:s,input});
   pending=(async()=>{
    let d:Supervision;
    try{d=await api.supervise(s,input,life.signal);}catch(e){record({event:'selector_error',message:e instanceof Error?e.message:'error'});return;}
    const fresh=w.snapshot(),elapsedMs=Date.now()-requested;
    const row:any={event:'decision',elapsedMs,choice:d.choice,selected:d.selected,review:d.review,confidence:d.confidence};decisions.push(row);record(row);
    if(closed||observedId!==id||fresh.health<s.health||JSON.stringify(fresh.enemies)!==JSON.stringify(s.enemies)){row.applied=false;record({event:'stale_decision',reason:'execution or threat changed'});return;}
    if(d.choice==='continue'||d.choice==='unresolved'){row.applied=d.choice==='continue';return;}
    if(active&&input.execution?.motor?.phase!==w.progress()?.phase){row.applied=false;record({event:'stale_decision',reason:'motor phase changed'});return;}
    if(d.choice==='stop'){row.applied=true;await cancel('JEV stop');return;}
    if(d.choice==='procedure'){row.applied=true;await cancel('JEV procedure selection');if(!closed){runner=new ProcedureRunner(plan,plan.procedure!);restarts++;pump();}return;}
    if(d.selected&&candidates(fresh,d.selected.plan).includes(d.selected.action)){
     const selected=d.selected;
     // Same identity does not restart a running primitive.
     if(active&&executionIdentity(active.action,active.plan)===executionIdentity(selected.action,selected.plan)){runner.suspend('JEV selected an individual action instead of the procedure');row.applied=true;return;}
     await cancel('JEV replacement');if(!closed&&candidates(w.snapshot(),selected.plan).includes(selected.action)){row.applied=true;start(selected.action,selected.plan);}return;
    }
    row.applied=false;record({event:'unapplied_decision',reason:'No physically valid selected action'});
   })().finally(()=>pending=undefined);
  }
  if(scenario==='normal'&&carried(w.state,c.wood+'_planks')>=8&&!active)break;
  await delay(50);
 }
 const end=Date.now(),durationMs=end-started;
 closed=true;runner.suspend('Experiment horizon');active?.controller.abort();await active?.task;
 // Drain a paid response without applying it after the measurement window.
 await pending;life.abort();const apiDrainMs=Date.now()-end;
 const intervals=rows.filter(e=>e.event==='action_start').map(e=>{const done=rows.find(x=>x.event==='action_end'&&x.id===e.id);return [Math.max(started,e.at),Math.min(end,done?.at??end)];});
 const activeMs=intervals.reduce((n,[a,b])=>n+Math.max(0,b-a),0);
 return {scenario,supervised,durationMs,apiDrainMs,syntheticExecutorGapFraction:1-activeMs/durationMs,planks:carried(w.state,c.wood+'_planks'),goalReached:carried(w.state,c.wood+'_planks')>=8,
  responseAction:w.responseAction??null,responseDelayMs:w.responseAt&&w.disturbanceAt?w.responseAt-w.disturbanceAt:null,food:w.state.food,health:w.state.health,disturbanceInjected:!!w.disturbanceAt,
  maxActive:w.maxActive,actions:w.starts.map(x=>x.action),cancelled:w.finishes.filter(x=>x.cancelled).length,restarts,procedure:runner.view(),decisions};
}

async function main(){
 const stage=process.argv[2],out=process.argv[3],input=process.argv[4];
 if(!['plan','compare','repair','role-probe','dry-run'].includes(stage)||!out)throw Error('Use: script plan|compare|repair|role-probe|dry-run <private runs directory> [plan report]');
 if(!/^runs\//.test(out)||out.split('/').includes('..'))throw Error('Store raw experiment output under ignored runs/');
 if(existsSync(join(out,'report.json')))throw Error('Use a fresh output directory to preserve prior evidence');
 mkdirSync(out,{recursive:true,mode:0o700});
 const prior=input?JSON.parse(readFileSync(input,'utf8')):undefined,priorUsd=prior?.totalEstimatedUsd??prior?.budget?.usd??0,priorCalls=prior?.totalCalls??prior?.budget?.calls??0;
 const c={...config(),workflowMode:'procedural' as const,targetPolicy:'observed' as const,mode:'jev' as const,argumentContract:'coordinated' as const,withdrawalMode:'direct' as const,selectorApiMs:15000};
 if(!Number.isFinite(priorUsd)||!Number.isFinite(priorCalls)||priorUsd<0||priorCalls<0||priorUsd>=1||priorCalls>=220)throw Error('Prior usage is invalid or the shared budget is exhausted');
 const budget=new Budget(220-priorCalls,1-priorUsd);let phase:any={stage},serial=0;
 const report:any={stage,fixture:{controller:'Evaluation controller using ProcedureRunner and ApiBrain, not the complete Runtime',mineMs:4000,craftMs:1500,eventAfterStartMs:500,comparisonHorizonMs:14000,supervisorIntervalMs:1000,damage:'Fixed injected observations; combat damage and kills are not simulated'},models:{llm:c.llmModel,jev:c.jevModel},rates:{llmInput:c.inputRate,llmOutput:c.outputRate,jevInput:c.jevRate},scope:'Actual APIs with synthetic observations and motors. No server. Shared frozen LLM plan; initial execution is autostarted in both arms; no mid-window LLM replanning, dialogue or reflection.',priorUsd,priorCalls,plans:[],comparisons:[],failures:[]};
 const snapshotBudget=()=>({calls:budget.calls,usd:budget.usd,input:budget.input,output:budget.output,unknownUsage:budget.unknownUsage,boundedUnknownUsage:budget.boundedUnknownUsage,invalidResponses:budget.invalidResponses,fatal:budget.fatal});
 const save=()=>{report.budget=snapshotBudget();report.totalEstimatedUsd=priorUsd+budget.usd;report.totalCalls=priorCalls+budget.calls;writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2),{mode:0o600});};
 const delta=(before:ReturnType<typeof snapshotBudget>)=>({calls:budget.calls-before.calls,usd:budget.usd-before.usd});
 budget.onDiagnostic=e=>appendFileSync(join(out,'diagnostics.jsonl'),JSON.stringify({phase,...e})+'\n',{mode:0o600});
 const transport:typeof fetch=async(url,init)=>{
  const traceId=++serial,kind=String(url).endsWith('/systemone')?'jev':'llm',at=Date.now();
  if(kind==='jev'&&phase.variant==='clarified'){
   const body=JSON.parse(String(init?.body)),question=body.questions?.action;
   if(question?.criteria?.continue){
    question.instructions='You are the online supervisor of a delegated work procedure. The LLM chose its task and sequence; your role is to reassess whether continuing is appropriate NOW when observations change. A useful procedure may be interrupted before it finishes for self-care, a visible threat, cooperation, or invalid prerequisites. Compare current food, health, incomingDamage, enemies, available responses and work progress. Continue authorizes only the next short review interval, not a commitment to finish the procedure. Selecting another action directly suspends it; requesting a plan review alone does not change execution. No fixed action or numerical threshold is prescribed. '+question.instructions;
    question.criteria.continue='Keep the current execution and delegated next steps until the next supervisor review; reassess new observations on every review. This is not a commitment to finish before responding to change.';
    init={...init,body:JSON.stringify(body)};
   }
  }
  appendFileSync(join(out,'api.jsonl'),JSON.stringify({traceId,phase,kind,at,request:JSON.parse(String(init?.body))})+'\n',{mode:0o600});
  const response=await fetch(url,init),data=await response.clone().json().catch(()=>null);
  appendFileSync(join(out,'api.jsonl'),JSON.stringify({traceId,phase,kind,elapsedMs:Date.now()-at,status:response.status,response:data})+'\n',{mode:0o600});
  return response;
 };
 const api=new ApiBrain(c,budget,transport);
 try{
  if(stage==='dry-run'){
   const {woodPlan}=await import('../test/fixtures/procedure.js');
   const check=await quickExecution(woodPlan,cases[0]);if(!check.valid)throw Error('Fixture execution failed');
   const control=await compareArm({supervise:async()=>({choice:'continue',confidence:1,review:'none',routes:{}})},woodPlan,cases[0],'normal',true,budget,()=>{},1000);
   report.fixtureCheck={check,control};return;
  }
  if(stage==='plan'){
   for(const scenario of cases)for(let repeat=0;repeat<2&&!budget.exhausted;repeat++){
    phase={stage,case:scenario.id,repeat};const before=snapshotBudget(),started=Date.now();
    try{
     const w=new SimWorld(scenario),p=await api.plan(w.snapshot(),[],AbortSignal.timeout(300000),goalFor(scenario),context(goalFor(scenario)));
     if(p.intent)p.intent=bindWorkIntent(p.intent);
     const execution=await quickExecution(p,scenario);
     report.plans.push({case:scenario,repeat,plan:p,execution,elapsedMs:Date.now()-started,...delta(before)});
     console.log(JSON.stringify({...phase,valid:execution.valid,procedure:p.procedure,usage:delta(before)}));
    }catch(e){report.failures.push({...phase,error:e instanceof Error?e.message:'error',...delta(before)});console.log(JSON.stringify(report.failures.at(-1)));}
    save();
   }
  }else if(stage==='role-probe'){
   const events=readFileSync(process.argv[5],'utf8').trim().split('\n').map(s=>JSON.parse(s));
   for(const scenario of ['normal','hunger','threat']){
    const event=events.find(e=>e.event==='supervisor_input'&&e.phase.repeat===0&&e.phase.scenario===scenario&&e.input.execution?.action==='mine'&&e.input.execution.elapsedMs>=1000&&(scenario==='normal'||scenario==='hunger'&&e.snapshot.food===0||scenario==='threat'&&e.snapshot.enemies?.length));
    if(!event)throw Error('Missing frozen event for '+scenario);
    for(let repeat=0;repeat<2;repeat++)for(const variant of repeat%2?['clarified','original']:['original','clarified']){
     phase={stage,scenario,repeat,variant};const before=snapshotBudget(),started=Date.now();
     try{
      const decision=await api.supervise(structuredClone(event.snapshot),structuredClone(event.input),AbortSignal.timeout(60000));
      report.comparisons.push({...phase,decision,elapsedMs:Date.now()-started,...delta(before)});
      console.log(JSON.stringify(report.comparisons.at(-1)));
     }catch(e){report.failures.push({...phase,error:e instanceof Error?e.message:'error',...delta(before)});console.log(JSON.stringify(report.failures.at(-1)));}
     save();
    }
   }
  }else if(stage==='repair'){
   // Replay the failed model plan with the runner's factual deficit report.
   // The next procedure is generated by the LLM, never patched locally.
   const source=JSON.parse(readFileSync(process.argv[5]??input,'utf8'));
   const failed=source.plans.filter((p:any)=>p.plan?.procedure&&!p.execution.valid);
   if(!failed.length)throw Error('Need a saved failed executable procedure');
   for(const original of failed)for(let repeat=0;repeat<2&&!budget.exhausted;repeat++){
    phase={stage,case:original.case.id,repeat};const before=snapshotBudget(),started=Date.now();
    try{
     const w=new SimWorld(original.case),blocked=original.execution.procedure;
     const ctx:PlanningContext={...context(goalFor(original.case)),workIntent:original.plan.intent,procedure:blocked,replanReasons:['procedure_blocked'],activeExecution:null};
     const p=await api.plan(w.snapshot(),[],AbortSignal.timeout(300000),goalFor(original.case),ctx);
     if(p.intent)p.intent=bindWorkIntent(p.intent,original.plan.intent,p.taskReview);
     const execution=await quickExecution(p,original.case);
     report.plans.push({case:original.case,repeat,original:original.plan,blocked,inputContext:ctx,plan:p,execution,elapsedMs:Date.now()-started,...delta(before)});
     console.log(JSON.stringify({...phase,valid:execution.valid,procedure:p.procedure,taskReview:p.taskReview,usage:delta(before)}));
    }catch(e){report.failures.push({...phase,error:e instanceof Error?e.message:'error',...delta(before)});console.log(JSON.stringify(report.failures.at(-1)));}
    save();
   }
  }else{
   const usable=prior.plans.filter((p:any)=>p.case.id==='oak_empty'&&p.execution.valid);
   if(usable.length<2)throw Error('Need two valid oak_empty LLM procedures; do not substitute a hand-authored plan');
   for(let repeat=0;repeat<2;repeat++)for(const scenario of ['normal','hunger','threat'] as Scenario[]){
    // Alternate ordering to reduce always-running-one-condition-first effects.
    for(const supervised of repeat%2?[true,false]:[false,true]){
     if(budget.exhausted)break;
     phase={stage,repeat,scenario,supervised};const before=snapshotBudget();
     const result=await compareArm(api,usable[repeat].plan,usable[repeat].case,scenario,supervised,budget,e=>appendFileSync(join(out,'events.jsonl'),JSON.stringify({phase,...e})+'\n',{mode:0o600}));
     report.comparisons.push({...phase,...result,...delta(before)});
     console.log(JSON.stringify({...phase,goalReached:result.goalReached,planks:result.planks,responseAction:result.responseAction,responseDelayMs:result.responseDelayMs,actions:result.actions,cancelled:result.cancelled,usage:delta(before)}));save();
    }
   }
  }
 }finally{save();}
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Evaluation failed');process.exitCode=1;});
