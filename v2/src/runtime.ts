import {readPickupResult} from './pickup.js';
import {readMiningResult} from './mining.js';
import type {SocialMemory} from './social.js';
import type {ExperienceMemory} from './experience-memory.js';
import { candidates, type Action, type Brain, type Decision, type Log, type Plan, type Snapshot, type World } from './types.js';
import {Journal,compact,changes,classify,completed,type PlanningContext,type Outcome} from './planning.js';
export type RuntimeOptions = { planMs: number; actionMs: number; minConfidence: number; selectorKind?: string; memory?:ExperienceMemory; social?:SocialMemory; reflectionEnabled?:boolean };
export class Runtime {
 plan:Plan={goal:'Observe before acting',preferred:'idle'};
 history:string[]=[];
 private assignedGoal:string|null=null;
 private longGoal:string|null=null;
 private medium:PlanningContext['mediumTerm']={summary:'Observe before acting',steps:[],activeStep:0};
 private journal=new Journal();
 private reasons=new Set(['initial']);
 private failureStreak=0;
 private failureKey='';
 private epoch=0;
 private planVersion=0;
 private evidenceVersion=0;
 private socialPending=false;
 private lastSocial=-Infinity;
 private lastSocialKey='';
 private reflectionPending=false;
 private lastReflection=-Infinity;
 private planPending=false;
 private decisionPending=false;
 private actionPending=false;
 private activeAction?:Action;
 private lastPlan=-Infinity;
 private retryAfter=0;
 private lastMessages='';
 private lastReady=false;
 private lastEnemies='';
 private closed=false;
 private lastIdle?:{key:string;at:number};
 private lifetime=new AbortController();
 private actionController?:AbortController;
 constructor(readonly world:World,private brain:Brain,private options:RuntimeOptions,private log:Log){}
 private observation(){const s=this.world.snapshot();if(this.options.memory)s.memoryGuidance=this.options.memory.retrieve(s);if(this.options.social){this.options.social.ingest(s.chatEvents??[]);s.social=this.options.social.context();}return s;}
 private async converse(s:Snapshot,now:number){
  const social=this.options.social;if(!social||!this.brain.communicate||this.socialPending||this.closed||now-this.lastSocial<8000||s.enemies?.length||!s.ready)return;
  const context=s.social??social.context();
  if(!s.nearbyPlayers?.length&&!context.heard.some(e=>e.speaker!==context.self))return;
  const key=JSON.stringify({players:s.nearbyPlayers?.map(p=>p.name).sort(),heard:context.heard.filter(e=>e.speaker!==context.self).at(-1)?.id,result:context.recentActionEvidence.filter(e=>e.action!=='idle'&&e.action!=='look').at(-1)?.id,canMine:s.canMine,logs:s.logs});
  if(key===this.lastSocialKey||!social.canSpeak(now))return;
  this.socialPending=true;this.lastSocial=now;this.lastSocialKey=key;
  try{const speech=await this.brain.communicate(s,this.plan,this.lifetime.signal);
   if(!this.closed&&speech){const result=social.send(speech,t=>this.world.chat(t));this.log('social_speech',result);if(result.sent)this.requestPlan('own social commitment or proposal');}
   else if(!this.closed)this.log('social_silence');
  }catch{if(!this.closed)this.log('social_error');}finally{this.socialPending=false;}
 }
 async reflectMemory(force=false,urgent=false){
  const memory=this.options.memory;if(this.options.reflectionEnabled===false||this.closed||this.reflectionPending||!memory||!this.brain.reflect||!memory.pending())return;
  if(!force&&(Date.now()-this.lastReflection<30000||(!urgent&&memory.pending()<4)))return;
  this.reflectionPending=true;this.lastReflection=Date.now();
  try{const input=memory.reflection(),updates=await this.brain.reflect(input,this.lifetime.signal);
   if(!this.closed&&!this.lifetime.signal.aborted){memory.apply(input,updates,this.brain.reflectionModel);this.log('memory_reflected',{through:input.through});}
  }catch{this.log('memory_reflection_error');}finally{this.reflectionPending=false;}
 }
 get userGoal(){return this.assignedGoal;}
 get planning():PlanningContext {return structuredClone({longTermGoal:this.longGoal,mediumTerm:this.medium,replanReasons:[...this.reasons],recentActions:this.journal.recent,olderSummary:this.journal.older,failureStreak:this.failureStreak});}
 setGoal(goal:string|null){
  if(this.closed)return;const next=goal?.trim()||null;if(next===this.assignedGoal)return;
  this.assignedGoal=next;this.longGoal=next;this.medium={summary:'Observe and replan',steps:[],activeStep:0};
  this.plan={goal:'Observe and replan',preferred:'idle'};this.planVersion++;this.failureStreak=0;this.failureKey='';this.retryAfter=0;
  this.invalidate('user goal changed');this.log('user_goal',{userGoal:next});
 }
 note(result:string){this.history=[...this.history,result].slice(-20);this.log('result',{result});}
 private requestPlan(reason:string){this.reasons.add(reason);}
 invalidate(reason:string){this.epoch++;this.requestPlan(reason);this.actionController?.abort();this.world.stop();this.log('invalidate',{reason});}
 private activateStep(){
  const step=this.medium.steps[this.medium.activeStep];
  this.plan={...this.plan,activeStepId:step?.id,preferred:step?.action??'idle',destination:step?.destination,craft:step?.craft,look:step?.look,container:step?.container,transfer:step?.transfer,build:step?.build,mine:step?.mine,pickup:step?.pickup,equip:step?.equip};
 }
 private checkStep(s:Snapshot,successfulAction?:Action){
  const step=this.medium.steps[this.medium.activeStep];
  if(!step||!completed(step,s,successfulAction))return;
  this.log('step_completed',{id:step.id,completion:step.completion,evidence:compact(s)});
  this.medium.activeStep++;this.planVersion++;this.activateStep();
  this.requestPlan(this.medium.activeStep===this.medium.steps.length?'medium_plan_completed':'step_completed');
 }
 refreshPlan(now=Date.now()):Promise<void>|undefined {
  if(this.closed||this.planPending||this.actionPending||now<this.retryAfter||(!this.reasons.size&&now-this.lastPlan<this.options.planMs))return;
  const s=this.observation();if(!s.ready||s.health<=0)return;
  if(!this.reasons.size)this.reasons.add('periodic_review');
  const context=this.planning;const dispatched=[...this.reasons];this.reasons.clear();
  this.planPending=true;this.lastPlan=now;
  const epoch=this.epoch,evidence=this.evidenceVersion,version=this.planVersion;
  return this.brain.plan(s,[...this.history],this.lifetime.signal,this.userGoal,context).then(p=>{
   if(this.closed||epoch!==this.epoch||evidence!==this.evidenceVersion||version!==this.planVersion||this.actionPending){
    if(!this.closed)this.requestPlan('stale_plan_needs_fresh_evidence');this.log('plan_discarded');return;
   }
   const proposed=p.longTermGoal??this.longGoal??p.goal;
   if(this.assignedGoal!==null)this.longGoal=this.assignedGoal;
   else if(this.longGoal===null||proposed===this.longGoal||p.goalRevisionReason?.trim())this.longGoal=proposed;
   else this.log('long_goal_change_rejected',{reason:'missing revision justification'});
   this.plan={...p,longTermGoal:this.longGoal??undefined};this.planVersion++;this.failureStreak=0;this.failureKey='';
   this.medium={summary:p.goal,steps:structuredClone(p.steps??[]),activeStep:0};
   if(this.medium.steps.length)this.activateStep();
   this.log('plan',{plan:this.plan,planning:this.planning,reasons:dispatched});
   if(this.options.social&&!this.brain.communicate){
    const speech=p.speech??(p.say?{to:'all',kind:'chat' as const,text:p.say}:undefined);
    if(speech){try{this.log('social_speech',this.options.social.send(speech,t=>this.world.chat(t)));}catch{this.log('social_send_error');}}
   }else if(!this.options.social&&p.say&&!p.say.trimStart().startsWith('/'))this.world.chat(p.say);
  }).catch(error=>{
   if(!this.closed){this.requestPlan('planner_error');this.retryAfter=Date.now()+Math.max(1000,this.options.planMs);this.log('planner_error',{reason:error instanceof Error&&/^(Invalid |Missing |API |Cannot )/.test(error.message)?error.message.slice(0,160):'Planner request failed'});}
  }).finally(()=>{this.planPending=false;});
 }
 async tick(now=Date.now()){
  if(this.closed)return;const s=this.observation();
  if((this.activeAction==='flee'||this.activeAction==='attack')&&s.ready&&s.health>0)return;
  const messages=s.messages.join('\n');
  if(s.ready!==this.lastReady){this.lastReady=s.ready;this.invalidate('connection changed');}
  if(messages!==this.lastMessages){this.lastMessages=messages;this.epoch++;this.requestPlan('new conversation');}
  const enemyKey=(s.enemies??[]).map(e=>e.id).sort((a,b)=>a-b).join(',');
  if(enemyKey!==this.lastEnemies){this.lastEnemies=enemyKey;this.invalidate('visible threats changed');}
  if(!s.ready||s.health<=0||(s.health<=6&&!s.enemies?.length)){this.invalidate('not ready or low health');return;}
  void this.converse(s,now);
  if(!this.actionPending)this.checkStep(s);
  void this.refreshPlan(now);
  if(!s.enemies?.length&&s.food<14&&s.canEat){
   if(this.activeAction==='eat')return;
   if(this.actionPending){this.actionController?.abort();this.world.stop();return;}
   await this.run({action:'eat',confidence:1},['eat'],'local_safety');return;
  }
  if(this.actionPending||this.decisionPending)return;
  // Wait at a blocked/completed plan boundary, but never block threat decisions.
  if(this.options.social&&this.planPending&&!s.enemies?.length)return;
  if(this.planPending&&!s.enemies?.length&&(this.failureStreak>=2||(this.medium.steps.length>0&&this.medium.activeStep>=this.medium.steps.length)))return;
  const idleKey=JSON.stringify({epoch:this.epoch,version:this.planVersion,health:s.health,food:s.food,inventory:s.inventory,enemies:s.enemies,items:s.visibleItems,position:s.position,players:s.nearbyPlayers,messages:s.messages,view:s.vision?{yaw:s.vision.yaw,pitch:s.vision.pitch,blocks:s.vision.blocks.map(b=>({name:b.name,position:b.position}))}:null});
  if(!s.enemies?.length&&this.lastIdle?.key===idleKey&&now-this.lastIdle.at<5000)return;
  this.decisionPending=true;const epoch=this.epoch,version=this.planVersion;
  const options=candidates(s,this.plan),selectedContext=this.planning;
  try{
   const d=await this.brain.choose(s,this.plan,options,this.lifetime.signal);const fresh=this.world.snapshot();
   if(this.closed||epoch!==this.epoch||version!==this.planVersion||!fresh.ready||fresh.health<=0
    ||(fresh.enemies??[]).map(e=>e.id).sort((a,b)=>a-b).join(',')!==enemyKey
    ||(!fresh.enemies?.length&&fresh.food<14&&fresh.canEat)||this.actionPending||!candidates(fresh,this.plan).includes(d.action)){
    this.record(d,options,'selector',version,selectedContext,s,fresh,'skipped','stale decision not executed',Date.now());this.log('decision_discarded');return;
   }
   if(d.confidence<this.options.minConfidence)this.log('low_confidence_observed',{confidence:d.confidence,action:d.action});
   this.log('decision',{...d});await this.run(d,options,'selector',s);
   this.lastIdle=d.action==='idle'?{key:idleKey,at:Date.now()}:undefined;
  }catch{if(!this.closed)this.log('decision_error');}
  finally{this.decisionPending=false;}
 }
 private record(decision:Decision,options:Action[],source:'selector'|'local_safety',version:number,context:PlanningContext,before:Snapshot,after:Snapshot,outcome:Outcome,result:string,startedAt:number,decisionObserved:Snapshot=before){
  const a=compact(before),b=compact(after);
  const unlocked=after.recipeBook.unlocked.filter(id=>!before.recipeBook.unlocked.includes(id));
  const record=this.journal.add({...(decision.action==='pickup'&&readPickupResult(result)?{pickup:readPickupResult(result)}:{}),...(decision.action==='mine'&&readMiningResult(result)?{mining:readMiningResult(result)}:{}),decision,decisionObserved:compact(decisionObserved),selectorKind:source==='local_safety'?'local_rule':this.options.selectorKind??'unspecified_selector',options,source,planVersion:version,goal:context.longTermGoal,stepId:context.mediumTerm.steps[context.mediumTerm.activeStep]?.id??null,before:a,after:b,changes:{...changes(a,b),newlyUnlocked:unlocked.slice(0,128),newlyUnlockedCount:unlocked.length},outcome,result,startedAt,endedAt:Date.now()});
  if(outcome!=='skipped'&&(!(decision.action==='idle'||decision.action==='look')||JSON.stringify(a)!==JSON.stringify(b)))this.evidenceVersion++;
  try{this.options.memory?.add(record,(decisionObserved.memoryGuidance??[]).map(g=>({id:g.id,version:g.version})));}catch{this.log('memory_write_error');}
  try{this.options.social?.recordAction(record);}catch{this.log('social_memory_write_error');}
  this.log('action_record',{record});
  if(!this.closed)void this.reflectMemory(false,outcome==='failed'||(decision.action==='attack'&&outcome==='succeeded'));
 }
 private async run(decision:Decision,options:Action[],source:'selector'|'local_safety',observed?:Snapshot){
  if(this.actionPending||this.closed)return;
  const action=decision.action,before=this.world.snapshot(),context=this.planning,version=this.planVersion,plan=structuredClone(this.plan),startedAt=Date.now();
  this.actionPending=true;this.activeAction=action;
  const controller=new AbortController();this.actionController=controller;
  const signal=AbortSignal.any([controller.signal,this.lifetime.signal,AbortSignal.timeout(action==='mine'?(plan.mine?.maxMs??30000)+this.options.actionMs+2500:this.options.actionMs)]);
  let outcome:Outcome='failed',result='Action failed';
  try{result=await this.world.execute(action,signal,plan);outcome=signal.aborted?'cancelled':classify(action,result);}
  catch(e){outcome=signal.aborted&&signal.reason?.name!=='TimeoutError'?'cancelled':'failed';
   const known=e instanceof Error && /^(No |Log |Equipment |Deposit |Eating |Crafting |Missing |Insufficient |Destination |Player |Unknown item|Invalid crafting|Placement |Withdrawal |Transfer |Invalid transfer|Invalid block|Block )/.test(e.message)?e.message.slice(0,180):`Action ${action} ${signal.reason?.name==='TimeoutError'?'timed out':outcome}`;result=known;}
  finally{
   const after=this.world.snapshot();this.record(decision,options,source,version,context,before,after,outcome,result,startedAt,observed??before);this.note(result);
   if(version===this.planVersion&&!this.closed){
    const key=JSON.stringify({action,step:context.mediumTerm.steps[context.mediumTerm.activeStep]?.id,craft:plan.craft,destination:plan.destination,container:plan.container,transfer:plan.transfer,build:plan.build,mine:plan.mine,pickup:plan.pickup,equip:plan.equip});
    if(action==='give'&&outcome==='partial')this.requestPlan('delivery_receipt_unconfirmed_do_not_repeat');
    if(outcome==='failed'||outcome==='partial'){
     this.failureStreak=key===this.failureKey?this.failureStreak+1:1;this.failureKey=key;
     if(this.failureStreak>=2)this.requestPlan('repeated_failure_or_no_progress');
    }else if(outcome==='succeeded'){this.failureStreak=0;this.failureKey='';this.checkStep(after,action);}
   }
   this.actionPending=false;this.activeAction=undefined;this.actionController=undefined;
  }
 }
 close(){this.closed=true;this.epoch++;this.lifetime.abort();this.actionController?.abort();this.world.stop();this.world.close();}
}
