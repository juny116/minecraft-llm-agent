// Actual ApiBrain + Runtime with synthetic motors. No Minecraft connection.
import {mkdirSync,readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {config} from '../src/config.js';
import {ApiBrain,Budget} from '../src/providers.js';
import {Runtime} from '../src/runtime.js';
import {carried,recipeKey,type RecipeFact} from '../src/procedure.js';
import type {PlanningContext} from '../src/planning.js';
import type {Action,Plan,Snapshot,MotorProgress,World,Brain} from '../src/types.js';
type Case={id:string;wood:'oak'|'birch';logs:number;planks:number};
const cases:Case[]=[{id:'oak_empty',wood:'oak',logs:0,planks:0},{id:'oak_partial',wood:'oak',logs:1,planks:3},{id:'birch_empty',wood:'birch',logs:0,planks:0}];
type Scenario='normal'|'hunger'|'threat';
const context=(goal:string):PlanningContext=>({longTermGoal:goal,userRequest:goal,mediumTerm:{summary:'Choose a bounded work procedure from observations',steps:[],activeStep:0},replanReasons:['initial'],recentActions:[],olderSummary:{count:0,byAction:{},inventoryNet:{},healthNet:0},failureStreak:0});
const goalFor=(c:Case)=>`주변에서 관측한 ${c.wood==='oak'?'참나무':'자작나무'} 원목을 필요한 만큼 모아 ${c.wood}_planks를 최종 8개 이상 소지하세요. 이미 소지한 원목과 판자는 활용하세요.`;
class SimWorld implements World{
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
  if(this.disturbanceAt&&this.scenario==='threat'&&!this.retreated){
   const age=now-this.disturbanceAt;
   if(age>=6500){this.state.enemies=[];}
   else{const expected=16-4*Math.floor(age/2000);if(this.state.health>expected){const before=this.state.health;this.state.health=expected;this.state.incomingDamage!.push({at:now,type:'hit',attacker:{id:41,kind:'zombie'}},{at:now,type:'health_loss',before,after:expected,amount:before-expected});}}
  }
  this.state.canEat=this.state.food<20&&carried(this.state,'bread')>0;
  return structuredClone(this.state);
 }
 progress():MotorProgress|undefined{
  if(!this.active)return;const elapsed=Date.now()-this.active.at,action=this.active.action;
  return {phase:action==='mine'?'digging':action==='craft'?'crafting':action==='attack'||action==='flee'?'tracking':'prepare',phaseElapsedMs:elapsed,estimatedDigMs:action==='mine'?this.active.duration:undefined,estimatedRemainingMs:action==='mine'?Math.max(0,this.active.duration-elapsed):undefined,digBudgetMs:action==='mine'?10000:undefined,blockBroken:false};
 }
 recipes(item:string){return item===this.recipe.item?[this.recipe]:[];}
 executionProgress(){return this.progress();}
 stop(){} close(){} chat(_text:string){}
 async execute(action:Action,signal:AbortSignal,plan?:Plan){
  if(!plan)throw Error('Missing plan');
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

const out=process.argv[2],prior=JSON.parse(readFileSync(process.argv[3],'utf8'));
if(!out?.startsWith('runs/')||out.split('/').includes('..')||existsSync(join(out,'report.json')))throw Error('Use a new private runs directory');
mkdirSync(out,{recursive:true,mode:0o700});
const priorUsd=prior.totalEstimatedUsd,priorCalls=prior.totalCalls;
if(priorUsd>=.5||priorCalls>=900)throw Error('Shared evaluation budget exhausted');
const c={...config(),workflowMode:'procedural' as const,targetPolicy:'observed' as const,mode:'jev' as const,argumentContract:'coordinated' as const,withdrawalMode:'direct' as const,selectorApiMs:15000};
const budget=new Budget(900-priorCalls,.5-priorUsd);let phase:any={},serial=0;
const report:any={scope:'Real Runtime and ApiBrain; synthetic observations/motors and fixed experiment goal. Initial procedure from prior actual LLM output, subsequent medium reviews use actual LLM. Setup waits for that procedure offer; JEV chooses start/continue/switch/resume thereafter. Combat damage and disappearance are scripted, not measured kills. No server.',priorUsd,priorCalls,models:{llm:c.llmModel,jev:c.jevModel},rates:{llmInput:c.inputRate,llmOutput:c.outputRate,jevInput:c.jevRate},arms:[],errors:[]};
const save=()=>{report.budget={calls:budget.calls,usd:budget.usd,unknownUsage:budget.unknownUsage,boundedUnknownUsage:budget.boundedUnknownUsage};report.totalCalls=priorCalls+budget.calls;report.totalEstimatedUsd=priorUsd+budget.usd;writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));};
budget.onDiagnostic=e=>appendFileSync(join(out,'diagnostics.jsonl'),JSON.stringify({phase,...e})+'\n');
const api=new ApiBrain(c,budget,async(url,init)=>{
 const id=++serial,at=Date.now(),kind=String(url).endsWith('/systemone')?'jev':'llm';
 appendFileSync(join(out,'api.jsonl'),JSON.stringify({phase,id,kind,at,request:JSON.parse(String(init?.body))})+'\n');
 const response=await fetch(url,init),data=await response.clone().json().catch(()=>null);
 appendFileSync(join(out,'api.jsonl'),JSON.stringify({phase,id,kind,elapsedMs:Date.now()-at,status:response.status,response:data})+'\n');return response;
});
const source=JSON.parse(readFileSync(process.argv[4],'utf8')),plans=source.plans.filter((x:any)=>x.case.id==='oak_empty'&&x.execution.valid);
try{
 for(let repeat=0;repeat<2;repeat++)for(const scenario of ['normal','hunger','threat'] as Scenario[]){
  if(budget.exhausted)break;
  phase={repeat,scenario};const w=new SimWorld(cases[0],scenario),events:any[]=[],pending=new Set<Promise<any>>();
  const track=<T>(p:Promise<T>)=>{pending.add(p);void p.finally(()=>pending.delete(p)).catch(()=>{});return p;};
  let initial=true;
  const brain:Brain={parameterSelection:true,workflowMode:'procedural',choose:async()=>{throw Error('Continuous path only');},
   reviewGoals:async(_s,ctx)=>({goalUpdates:[{id:'fixture-boards',description:goalFor(cases[0]),reason:'Fixed experiment goal, not a generated long-term intention',status:'active',successCriteria:'Carry eight oak planks',evidenceIds:[ctx.goalReview!.observationId]}],activeGoalId:'fixture-boards'}),
   plan:async(s,h,signal,g,ctx)=>{if(initial){initial=false;return structuredClone(plans[repeat].plan);}return track(api.plan(s,h,signal,g,ctx));},
   supervise:async(s,input,signal)=>{
    if(!input.procedure&&!input.procedureAvailable)return {choice:'unresolved',confidence:1,review:'none',routes:{},reason:'Evaluation setup awaiting initial model-generated procedure'};
    appendFileSync(join(out,'events.jsonl'),JSON.stringify({phase,at:Date.now(),event:'supervisor_input',snapshot:s,input})+'\n');
    return track(api.supervise(s,input,signal));
   }
  };
  const runtime=new Runtime(w,brain,{workflowMode:'procedural',planMs:45000,longPlanMs:180000,selectorMs:1000,actionMs:10000,minConfidence:0,reflectionEnabled:false},(event,fields)=>{
   const row={at:Date.now(),...fields,...(fields?.event===undefined?{}:{eventDetail:fields.event}),event};events.push(row);appendFileSync(join(out,'events.jsonl'),JSON.stringify({phase,...row})+'\n');
  });
  runtime.setGoal(goalFor(cases[0]));const started=Date.now(),before={calls:budget.calls,usd:budget.usd};
  try{
   while(Date.now()-started<45000&&!budget.exhausted){
    await runtime.tick();
    const elapsed=w.firstStart?Date.now()-w.firstStart:0;
    if(elapsed>30000)break;
    if(carried(w.snapshot(),'oak_planks')>=8&&!runtime.executionStatus.actionPending&&(scenario==='normal'||events.some(e=>e.event==='procedure_resumed')))break;
    await delay(50);
   }
   const end=Date.now(),status=runtime.executionStatus,inventory=w.snapshot().inventory;
   runtime.close(true);await Promise.allSettled([...pending]);await delay(20);
   const selected=events.filter(e=>e.event==='supervisor_response'),resumes=events.filter(e=>e.event==='procedure_resumed');
   // A resume event can immediately complete an already-satisfied job without
   // doing any work. Count resumed execution separately from the control event.
   const resumesWithWork=resumes.filter(e=>{
    const after=events.slice(events.indexOf(e)+1),boundary=after.findIndex(x=>['procedure_suspended','procedure_completed','procedure_blocked','procedure_started','procedure_resumed'].includes(x.event));
    return after.slice(0,boundary<0?undefined:boundary).some(x=>x.event==='procedure_action'&&x.procedureId===e.procedure.id);
   });
   const failedActions=events.filter(e=>e.event==='action_record'&&e.record.outcome==='failed').map(e=>({action:e.record.decision?.action,result:e.record.result,source:e.record.source}));
   const result={...phase,durationMs:end-started,firstWorkAt:w.firstStart,responseDelayMs:w.responseAt&&w.disturbanceAt?w.responseAt-w.disturbanceAt:null,responseAction:w.responseAction,resumes:resumes.length,procedureStarts:events.filter(e=>e.event==='procedure_started').length,goalReached:carried(w.state,'oak_planks')>=8,inventory,status,actions:w.starts.map(e=>e.action),maxActive:w.maxActive,decisionCount:selected.length,errors:events.filter(e=>['decision_error','planner_error','execution_error'].includes(e.event)),calls:budget.calls-before.calls,usd:budget.usd-before.usd};
   const measured={...result,resumesWithWork:resumesWithWork.length,resumesWithoutWork:resumes.length-resumesWithWork.length,failedActions};
   report.arms.push(measured);console.log(JSON.stringify({...measured,status:undefined,inventory:undefined,errors:result.errors.length}));
  }catch(error){runtime.close(true);await Promise.allSettled([...pending]);report.errors.push({...phase,error:error instanceof Error?error.message:'error'});}
  save();
 }
}finally{save();}
