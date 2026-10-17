import {reachedCell} from './reach.js';
import {supportsFeet} from './building.js';
import {RetryPolicy} from './retry-policy.js';
import {GoalBook} from './goals.js';
import {readPickupResult} from './pickup.js';
import {readMiningResult} from './mining.js';
import type {SocialMemory} from './social.js';
import type {ExperienceMemory} from './experience-memory.js';
import { candidates, hasMiningTool, type Action, type Brain, type Decision, type Log, type Plan, type Snapshot, type World } from './types.js';
import {Journal,compact,changes,classify,completed,type PlanningContext,type Outcome} from './planning.js';
export type RuntimeOptions = { planMs: number; actionMs: number; minConfidence: number; selectorKind?: string; memory?:ExperienceMemory; social?:SocialMemory; reflectionEnabled?:boolean; goals?:GoalBook };
export class Runtime {
 plan:Plan={goal:'Observe before acting',preferred:'idle'};
 history:string[]=[];
 private assignedGoal:string|null=null;
 private longGoal:string|null=null;
 private medium:PlanningContext['mediumTerm']={summary:'Observe before acting',steps:[],activeStep:0};
 private journal=new Journal();
 private reasons=new Set(['initial']);
 private retries=new RetryPolicy();
 private observationStreak=0;
 private lastLookAt=0;
 private knownViews=new Set<string>();
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
 private plannerFeedback?:string;
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
  const evidence=this.evidenceVersion,version=this.planVersion,active=this.activeAction;
  try{const speech=await this.brain.communicate(s,this.plan,this.lifetime.signal,{activeAction:active??null,planPending:this.planPending});
   if(evidence!==this.evidenceVersion||version!==this.planVersion||active!==this.activeAction){this.log('social_discarded',{reason:'execution changed during speech generation'});this.lastSocialKey='';return;}
   if(!this.closed&&speech){const result=social.send(speech,t=>this.world.chat(t),Date.now(),JSON.stringify({inventory:s.inventory,health:s.health,food:s.food,position:Object.fromEntries(Object.entries(s.position).map(([k,v])=>[k,Math.floor(v)])),lastAction:context.recentActionEvidence.filter(e=>e.action!=='idle'&&e.action!=='look').at(-1)?.action,lastOutcome:context.recentActionEvidence.filter(e=>e.action!=='idle'&&e.action!=='look').at(-1)?.outcome}));this.log('social_speech',result);if(result.sent)this.requestPlan('own social commitment or proposal');}
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
 get planning():PlanningContext {return structuredClone({blockedInteractions:this.retries.context(),observationStreak:this.observationStreak,...(this.plannerFeedback?{plannerFeedback:this.plannerFeedback}:{}),userRequest:this.assignedGoal,...(this.options.goals?{goalState:this.options.goals.snapshot()}:{}),longTermGoal:this.longGoal,mediumTerm:this.medium,replanReasons:[...this.reasons],recentActions:this.journal.recent,olderSummary:this.journal.older,failureStreak:this.failureStreak});}
 setGoal(goal:string|null){
  if(this.closed)return;const next=goal?.trim()||null;if(next===this.assignedGoal)return;
  this.assignedGoal=next;this.options.goals?.pause('operator request changed; re-evaluate intention');this.longGoal=this.options.goals?null:next;this.medium={summary:'Observe and replan',steps:[],activeStep:0};
  this.plan={goal:'Observe and replan',preferred:'idle',userRequest:next};this.planVersion++;this.failureStreak=0;this.failureKey='';this.retryAfter=0;
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
  const context=this.planning;if(this.options.goals)context.goalReview=this.options.goals.review(s,this.userGoal);const dispatched=[...this.reasons];this.reasons.clear();
  this.planPending=true;this.lastPlan=now;
  const epoch=this.epoch,evidence=this.evidenceVersion,version=this.planVersion;
  return this.brain.plan(s,[...this.history],this.lifetime.signal,this.userGoal,context).then(p=>{
   if(this.closed||epoch!==this.epoch||evidence!==this.evidenceVersion||version!==this.planVersion||this.actionPending){
    if(!this.closed)this.requestPlan('stale_plan_needs_fresh_evidence');this.log('plan_discarded');return;
   }
   const first=p.steps?.[0],next={...p,...first,preferred:first?.action??p.preferred};let firstProblem:string|undefined;
   if(next.preferred!=='idle'&&!candidates(s,next).includes(next.preferred)){
    const why=next.preferred==='move'&&next.destination&&reachedCell(s.position,next.destination,2)?'destination already reached (block-cell radius 2); choose the next useful action':next.preferred==='mine'&&next.mine&&supportsFeet(next.mine.position,s.position)?'target supports own feet; reposition before mining':next.preferred==='mine'&&next.mine&&!hasMiningTool(s,next.mine)?'requested tool/slot is not carried; choose current inventory or omit the explicit tool':next.preferred==='mine'?'target is not in CURRENT vision.blocks; look/move before mining remembered targets':'required parameters or current observed preconditions are missing';
    firstProblem=`Invalid first action ${next.preferred}: ${why}`;
   }
   if(this.retries.blocked(next.preferred,next,s))firstProblem='Unchanged failed interaction: choose a different target, reposition or change the relevant conditions';
   if(this.options.goals){
    if(!context.goalReview||!Array.isArray(p.goalUpdates)||p.activeGoalId===undefined)throw Error('Missing goal review response');
    if(p.activeGoalId===null&&(p.preferred!=='idle'||p.steps?.length))throw Error('Invalid work without active goal');
    this.options.goals.apply(context.goalReview,p.goalUpdates,p.activeGoalId);
    this.longGoal=this.options.goals.snapshot().activeGoal?.description??null;
    this.log('goals_reviewed',{goals:this.options.goals.snapshot()});
   }else{
    const proposed=p.longTermGoal??this.longGoal??p.goal;
    if(this.assignedGoal!==null)this.longGoal=this.assignedGoal;
    else if(this.longGoal===null||proposed===this.longGoal||p.goalRevisionReason?.trim())this.longGoal=proposed;
    else this.log('long_goal_change_rejected',{reason:'missing revision justification'});
   }
   this.plannerFeedback=firstProblem;this.retryAfter=firstProblem?Date.now()+4000:0;this.plan={...p,userRequest:this.assignedGoal,longTermGoal:this.longGoal??undefined};this.planVersion++;this.failureStreak=0;this.failureKey='';
   this.medium={summary:p.goal,steps:structuredClone(p.steps??[]),activeStep:0};
   if(this.medium.steps.length)this.activateStep();
   if(firstProblem){this.requestPlan('blocked_first_action');this.log('plan_blocked',{reason:firstProblem});}
   this.log('plan',{plan:this.plan,planning:this.planning,reasons:dispatched});
   if(this.options.social&&!this.brain.communicate){
    const speech=p.speech??(p.say?{to:'all',kind:'chat' as const,text:p.say}:undefined);
    if(speech){try{this.log('social_speech',this.options.social.send(speech,t=>this.world.chat(t)));}catch{this.log('social_send_error');}}
   }else if(!this.options.social&&p.say&&!p.say.trimStart().startsWith('/'))this.world.chat(p.say);
  }).catch(error=>{
   if(!this.closed){const reason=error instanceof Error&&/^(Invalid |Missing |API |Cannot )/.test(error.message)?error.message.slice(0,160):'Planner request failed';this.plannerFeedback=reason;this.requestPlan('planner_error');this.retryAfter=Date.now()+(/^(Invalid |Missing )/.test(reason)?1000:Math.max(1000,this.options.planMs));this.log('planner_error',{reason});}
  }).finally(()=>{this.planPending=false;});
 }
 async tick(now=Date.now()){
  if(this.closed)return;const s=this.observation();
  if((this.activeAction==='flee'||this.activeAction==='attack')&&s.ready&&s.health>0)return;
  const messages=s.messages.join('\n');
  if(s.ready!==this.lastReady){
   this.lastReady=s.ready;
   if(this.options.goals){this.options.goals.pause('connection changed; inspect current state before resuming');this.longGoal=null;this.medium={summary:'Review intentions against current observations',steps:[],activeStep:0};this.plan={goal:'Review intentions before acting',preferred:'idle'};this.planVersion++;this.requestPlan('goal_review_after_connection');}
   this.invalidate('connection changed');
  }
  if(messages!==this.lastMessages){this.lastMessages=messages;this.epoch++;this.requestPlan('new conversation');}
  const enemyKey=(s.enemies??[]).map(e=>e.id).sort((a,b)=>a-b).join(',');
  if(enemyKey!==this.lastEnemies){this.lastEnemies=enemyKey;this.invalidate('visible threats changed');}
  if(!s.ready||s.health<=0||(s.health<=6&&!s.enemies?.length)){this.invalidate('not ready or low health');return;}
  void this.converse(s,now);
  if(!this.actionPending)this.checkStep(s);
  if(!this.actionPending&&this.plan.preferred!=='idle'&&!candidates(s,this.plan).includes(this.plan.preferred))this.requestPlan('planned_action_no_longer_available_in_current_observation');
  void this.refreshPlan(now);
  if(!s.enemies?.length&&s.food<14&&s.canEat){
   if(this.activeAction==='eat')return;
   if(this.actionPending){this.actionController?.abort();this.world.stop();return;}
   await this.run({action:'eat',confidence:1},['eat'],'local_safety');return;
  }
  if(this.actionPending||this.decisionPending)return;
  if(this.options.goals?.needsReview&&!s.enemies?.length)return;
  // Wait at a blocked/completed plan boundary, but never block threat decisions.
  if(this.options.social&&this.planPending&&!s.enemies?.length)return;
  if(this.failureStreak>=2&&!s.enemies?.length)return;
  if(this.planPending&&!s.enemies?.length&&((this.medium.steps.length>0&&this.medium.activeStep>=this.medium.steps.length)))return;
  const idleKey=JSON.stringify({epoch:this.epoch,version:this.planVersion,health:s.health,food:s.food,inventory:s.inventory,enemies:s.enemies,items:s.visibleItems,position:s.position,players:s.nearbyPlayers,messages:s.messages,view:s.vision?{yaw:s.vision.yaw,pitch:s.vision.pitch,blocks:s.vision.blocks.map(b=>({name:b.name,position:b.position}))}:null});
  if(!s.enemies?.length&&this.lastIdle?.key===idleKey&&now-this.lastIdle.at<5000)return;
  this.decisionPending=true;const epoch=this.epoch,version=this.planVersion;
  let options=this.options.goals&&!this.options.goals.snapshot().activeGoal&&!s.enemies?.length?['idle' as Action]:candidates(s,this.plan);
  options=options.filter(a=>!this.retries.blocked(a,this.plan,s)&&(a!=='look'||now-this.lastLookAt>=2000));
  if(!options.length)options=['idle'];
  if(this.retries.blocked(this.plan.preferred,this.plan,s))this.requestPlan('unchanged_failed_interaction_requires_alternative');
  const selectedContext=this.planning;
  try{
   const last=this.journal.recent.at(-1);
   const d=await this.brain.choose(s,{...this.plan,userRequest:this.assignedGoal,recentOutcome:last?{action:last.decision.action,outcome:last.outcome,result:last.result,changes:last.changes}:undefined},options,this.lifetime.signal);const fresh=this.world.snapshot();
   if(this.closed||epoch!==this.epoch||version!==this.planVersion||!fresh.ready||fresh.health<=0
    ||(fresh.enemies??[]).map(e=>e.id).sort((a,b)=>a-b).join(',')!==enemyKey
    ||(!fresh.enemies?.length&&fresh.food<14&&fresh.canEat)||this.actionPending||!options.includes(d.action)||this.retries.blocked(d.action,this.plan,fresh)||!candidates(fresh,this.plan).includes(d.action)){
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
  try{this.options.goals?.record(record);}catch{this.log('goal_evidence_write_error');}
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
   const after=this.world.snapshot();
   this.retries.record(action,plan,after,outcome==='failed'||outcome==='partial',result);
   if(action==='look'){this.lastLookAt=Date.now();let novel=0;for(const b of after.vision?.blocks??[]){const k=JSON.stringify([b.name,b.position]);if(!this.knownViews.has(k))novel++;this.knownViews.add(k);}
    this.observationStreak=novel?0:this.observationStreak+1;if(this.observationStreak>=4)this.requestPlan('repeated_observation_without_new_information_choose_meaningful_action');
    if(this.knownViews.size>4096)this.knownViews.clear();
   }else if(outcome==='succeeded'&&action!=='idle')this.observationStreak=0;
   this.record(decision,options,source,version,context,before,after,outcome,result,startedAt,observed??before);this.note(result);
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
 close(drainModels=false){this.closed=true;this.epoch++;if(!drainModels)this.lifetime.abort();this.actionController?.abort();this.world.stop();this.world.close();}
}
