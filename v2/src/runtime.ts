import {MAX_DIG_BUDGET_MS} from './mining.js';
import {NavigationFailure,executionEvidence,type NavigationEvidence} from './execution-evidence.js';
import {ImportantPlaces,placeEvidence} from './important-places.js';
import {viewChange} from './view-change.js';
import {ReviewLifecycle,safeDecisionError,type ReviewBasis,type ReviewReceipt} from './review-lifecycle.js';
import {intentSatisfied} from './work-intent.js';
import {ProgressTracker} from './progress.js';
import {completionBoundary,executionOptions,executionIdentity,type SupervisorInput} from './supervision.js';
import {RecoveryMemory} from './recovery.js';
import {moveReached} from './action-contracts.js';
import {supportsFeet} from './building.js';
import {RetryPolicy} from './retry-policy.js';
import {GoalBook} from './goals.js';
import {readPickupResult} from './pickup.js';
import {readMiningResult} from './mining.js';
import type {SocialMemory} from './social.js';
import type {ExperienceMemory} from './experience-memory.js';
import { actions,candidates, hasMiningTool, type Action, type Brain, type Decision, type Log, type Plan, type Snapshot, type World } from './types.js';
import {Journal,compact,changes,classify,completed,type PlanningContext,type Outcome} from './planning.js';
export type RuntimeOptions = { selectorMs?:number;longPlanMs?:number;reflectionMs?:number;socialMs?:number;decisionTtlMs?:number;recovery?:RecoveryMemory; planMs: number; actionMs: number; minConfidence: number; selectorKind?: string; memory?:ExperienceMemory; social?:SocialMemory; reflectionEnabled?:boolean; goals?:GoalBook };
export class Runtime {
 private importantPlaces:ImportantPlaces;
 private reviewLifecycle=new ReviewLifecycle();
 plan:Plan={goal:'Observe before acting',preferred:'idle'};
 history:string[]=[];
 private assignedGoal:string|null=null;
 private longGoal:string|null=null;
 private progress=new ProgressTracker();
 private reflectionFeedback?:string;
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
 private mediumChain=0;
 private continuationEpoch=0;
 private prefetchAttemptedTail?:string;
 private lastPrefetch=-Infinity;
 private plannerFeedback?:string;
 private longPlannerFeedback?:string;
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
 constructor(readonly world:World,private brain:Brain,private options:RuntimeOptions,private log:Log){this.importantPlaces=world.importantPlaces??new ImportantPlaces();if(brain.supervise){options.goals??=new GoalBook();options.recovery??=new RecoveryMemory();}}
 private observation(){const s=this.world.snapshot();this.importantPlaces.observe(s);s.importantPlaces=this.importantPlaces.snapshot();s.placeEvidence=placeEvidence(s);if(this.options.recovery)s.recovery=this.options.recovery.context();if(this.options.memory)s.memoryGuidance=this.options.memory.retrieve(s,[this.activeAction,this.plan.preferred,...(this.plan.intent?['mine','move','craft'] as Action[]:[])].filter((x):x is Action=>!!x));if(this.options.social){this.options.social.ingest(s.chatEvents??[]);s.social=this.options.social.context();}this.reviewLifecycle.observe(s);return s;}
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
  const memory=this.options.memory;if(this.options.reflectionEnabled===false||this.closed||this.reflectionPending||!memory||!this.brain.reflect||(!memory.pending()&&!memory.needsMaintenance()))return;
  if(!force&&(Date.now()-this.lastReflection<(this.options.reflectionMs??60000)||(!urgent&&memory.pending()<4&&!memory.needsMaintenance())))return;
  this.reflectionPending=true;this.lastReflection=Date.now();
  try{const input={...memory.reflection(),feedback:this.reflectionFeedback},updates=await this.brain.reflect(input,this.lifetime.signal);
   if(!this.closed&&!this.lifetime.signal.aborted){memory.apply(input,updates,this.brain.reflectionModel);this.reflectionFeedback=undefined;this.log('memory_reflected',{through:input.through});}
  }catch(error){this.reflectionFeedback=error instanceof Error&&/^(Invalid |Unseen |Cannot |Stale |Duplicate )/.test(error.message)?error.message.slice(0,240):'Memory review failed';this.log('memory_reflection_error',{reason:this.reflectionFeedback});}finally{this.reflectionPending=false;}
 }
 get userGoal(){return this.assignedGoal;}
 get planning():PlanningContext {return structuredClone({placeMemoryReview:this.importantPlaces.review(),activeExecution:this.actionPending&&this.activeAction&&this.executionPlan?{action:this.activeAction,plan:this.executionPlan,elapsedMs:Math.max(0,Date.now()-this.executionStarted)}:null,planningState:this.reviewLifecycle.state(this.planVersion,[...this.reasons],Date.now()),selectorFeedbackStatus:this.reviewLifecycle.feedbackStatus(),selectorFeedback:this.selectionFeedback,...(this.plan.intent?{workIntent:this.plan.intent}:{}),progress:this.progress.context(Date.now()),...(this.longPlannerFeedback?{longPlannerFeedback:this.longPlannerFeedback}:{}),blockedInteractions:this.retries.context(),observationStreak:this.observationStreak,...(this.plannerFeedback?{plannerFeedback:this.plannerFeedback}:{}),userRequest:this.assignedGoal,...(this.options.goals?{goalState:this.options.goals.snapshot()}:{}),longTermGoal:this.longGoal,mediumTerm:this.medium,replanReasons:[...this.reasons],recentActions:this.journal.recent,olderSummary:this.journal.older,failureStreak:this.failureStreak});}
 setGoal(goal:string|null){
  if(this.closed)return;const next=goal?.trim()||null;if(next===this.assignedGoal)return;
  this.assignedGoal=next;this.longGeneration++;this.longValidationFailures=0;this.longPlannerFeedback=undefined;this.progress.reset();this.longRequested=true;this.longRetryAt=0;this.supervisorUrgent=true;this.options.goals?.pause('operator request changed; re-evaluate intention');this.longGoal=this.options.goals?null:next;this.medium={summary:'Observe and replan',steps:[],activeStep:0};
  this.plan={goal:'Observe and replan',preferred:'idle',userRequest:next};this.planVersion++;this.failureStreak=0;this.failureKey='';this.retryAfter=0;
  this.invalidate('user goal changed');this.log('user_goal',{userGoal:next});
 }
 note(result:string){this.history=[...this.history,result].slice(-20);this.log('result',{result});}
 private requestPlan(reason:string){this.reasons.add(reason);}
 private requestSelectorReview(basis:ReviewBasis){
  if(this.reviewLifecycle.covers(basis)){this.log('plan_review_deduplicated',{basis});return;}
  this.requestPlan('selector requested review');
 }
 private rememberSelectionFeedback(feedback:string,basis:ReviewBasis){
  this.selectionFeedback=feedback;
  this.log('selector_feedback',{event:this.reviewLifecycle.noteFeedback(feedback,basis,Date.now())});
 }
 invalidate(reason:string){this.epoch++;this.continuationEpoch++;this.requestPlan(reason);this.actionController?.abort();this.world.stop();this.log('invalidate',{reason});}
 private activateStep(){
  const step=this.medium.steps[this.medium.activeStep];
  this.plan={...this.plan,activeStepId:step?.id,preferred:step?.action??'idle',destination:step?.destination,craft:step?.craft,look:step?.look,container:step?.container,transfer:step?.transfer,build:step?.build,mine:step?.mine,pickup:step?.pickup,equip:step?.equip};
 }
 private completedIntentVersion=-1;
 private checkStep(s:Snapshot,successfulAction?:Action){
  if(this.plan.intent&&intentSatisfied(this.plan.intent,s)&&this.completedIntentVersion!==this.planVersion){this.completedIntentVersion=this.planVersion;this.requestPlan('intent_inventory_satisfied_review_next_work');this.longRequested=true;this.log('intent_satisfied',{intent:this.plan.intent,evidence:compact(s)});}

  const step=this.medium.steps[this.medium.activeStep];
  if(!step||!completed(step,s,successfulAction))return;
  this.log('step_completed',{id:step.id,completion:step.completion,evidence:compact(s)});
  this.medium.activeStep++;this.planVersion++;this.activateStep();
  if(!this.brain.supervise||this.medium.activeStep===this.medium.steps.length)this.requestPlan(this.medium.activeStep===this.medium.steps.length?'medium_plan_completed':'step_completed');
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
    const why=next.preferred==='move'&&next.destination&&moveReached(s.position,next.destination)?'destination already reached (block-cell radius 2); choose the next useful action':next.preferred==='mine'&&next.mine&&supportsFeet(next.mine.position,s.position)?'target supports own feet; reposition before mining':next.preferred==='mine'&&next.mine&&!hasMiningTool(s,next.mine)?'requested tool/slot is not carried; choose current inventory or omit the explicit tool':next.preferred==='mine'?'target is not in CURRENT vision.blocks; look/move before mining remembered targets':'required parameters or current observed preconditions are missing';
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
  if(this.closed)return;if(this.brain.supervise)return this.tickContinuous(now);const s=this.observation();
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
 private record(decision:Decision,options:Action[],source:'selector'|'local_safety',version:number,context:PlanningContext,before:Snapshot,after:Snapshot,outcome:Outcome,result:string,startedAt:number,decisionObserved:Snapshot=before,executionPlan?:Plan,navigation?:NavigationEvidence){
  const a=compact(before),b=compact(after);
  const unlocked=after.recipeBook.unlocked.filter(id=>!before.recipeBook.unlocked.includes(id));
  const record=this.journal.add({...(navigation?{navigation}:{}),...(executionPlan?{executionPlan:structuredClone(executionPlan)}:{}),...(decision.action==='pickup'&&readPickupResult(result)?{pickup:readPickupResult(result)}:{}),...(decision.action==='mine'&&readMiningResult(result)?{mining:readMiningResult(result)}:{}),decision,decisionObserved:compact(decisionObserved),selectorKind:source==='local_safety'?'local_rule':this.options.selectorKind??'unspecified_selector',options,source,planVersion:version,goal:context.longTermGoal,stepId:context.mediumTerm.steps[context.mediumTerm.activeStep]?.id??null,before:a,after:b,changes:{...changes(a,b),view:viewChange(before,after),newlyUnlocked:unlocked.slice(0,128),newlyUnlockedCount:unlocked.length},outcome,result,startedAt,endedAt:Date.now()});
  if(outcome!=='skipped'&&(!(decision.action==='idle'||decision.action==='look')||JSON.stringify(a)!==JSON.stringify(b)))this.evidenceVersion++;
  try{this.options.goals?.record(record);}catch{this.log('goal_evidence_write_error');}
  try{this.options.memory?.add(record,(decisionObserved.memoryGuidance??[]).map(g=>({id:g.id,version:g.version})));}catch{this.log('memory_write_error');}
  try{this.options.social?.recordAction(record);}catch{this.log('social_memory_write_error');}
  this.log('action_record',{record});
  if(!this.closed)void this.reflectMemory(false,outcome==='failed'||(decision.action==='attack'&&outcome==='succeeded'));
 }
 private async run(decision:Decision,options:Action[],source:'selector'|'local_safety',observed?:Snapshot,executionPlan?:Plan){
  if(this.actionPending||this.closed)return;
  const action=decision.action,before=this.world.snapshot(),context=this.planning,version=this.planVersion,plan=structuredClone(executionPlan??this.plan),startedAt=Date.now();
  this.actionPending=true;this.activeAction=action;
  const controller=new AbortController();this.actionController=controller;
  const signal=AbortSignal.any([controller.signal,this.lifetime.signal,AbortSignal.timeout(action==='mine'?MAX_DIG_BUDGET_MS+this.options.actionMs+5000:this.options.actionMs)]);
  let outcome:Outcome='failed',result='Action failed';let navigation:NavigationEvidence|undefined;
  try{result=await this.world.execute(action,signal,plan);outcome=signal.aborted?'cancelled':classify(action,result);}
  catch(e){if(e instanceof NavigationFailure)navigation=e.evidence;outcome=signal.aborted&&signal.reason?.name!=='TimeoutError'?'cancelled':'failed';
   const known=e instanceof Error && /^(No |Log |Equipment |Deposit |Eating |Crafting |Missing |Insufficient |Destination |Player |Unknown item|Invalid crafting|Placement |Withdrawal |Transfer |Invalid transfer|Invalid block|Block )/.test(e.message)?e.message.slice(0,180):`Action ${action} ${signal.reason?.name==='TimeoutError'?'timed out':outcome}`;result=known;}
  finally{
   const after=this.world.snapshot();
   if(!['idle','look'].includes(action)&&outcome!=='succeeded')this.continuationEpoch++;
   this.retries.record(action,plan,after,outcome==='failed'||outcome==='partial',result);
   if(action==='look'){this.lastLookAt=Date.now();let novel=0;for(const b of after.vision?.blocks??[]){const k=JSON.stringify([b.name,b.position]);if(!this.knownViews.has(k))novel++;this.knownViews.add(k);}
    this.observationStreak=novel?0:this.observationStreak+1;if(this.observationStreak===4||this.observationStreak%20===0)this.requestPlan('repeated_observation_without_new_information_choose_meaningful_action');
    if(this.knownViews.size>4096)this.knownViews.clear();
   }else if(outcome==='succeeded'&&action!=='idle')this.observationStreak=0;
   this.record(decision,options,source,version,context,before,after,outcome,result,startedAt,observed??before,plan,navigation);this.note(result);
   if(version===this.planVersion&&!this.closed&&(!executionPlan||!!this.plan.intent&&JSON.stringify(executionPlan.intent)===JSON.stringify(this.plan.intent)||JSON.stringify(executionPlan)===JSON.stringify(this.plan))){
    const key=JSON.stringify({action,step:context.mediumTerm.steps[context.mediumTerm.activeStep]?.id,craft:plan.craft,destination:plan.destination,container:plan.container,transfer:plan.transfer,build:plan.build,mine:plan.mine,pickup:plan.pickup,equip:plan.equip});
    if(action==='give'&&outcome==='partial')this.requestPlan('delivery_receipt_unconfirmed_do_not_repeat');
    if(outcome==='failed'||outcome==='partial'){
     this.failureStreak=key===this.failureKey?this.failureStreak+1:1;this.failureKey=key;
     if(this.failureStreak>=2)this.requestPlan('repeated_failure_or_no_progress');
    }else if(outcome==='succeeded'){this.failureStreak=0;this.failureKey='';this.checkStep(after,action);}
   }
   this.actionPending=false;this.activeAction=undefined;this.actionController=undefined;this.supervisorUrgent=true;
  }
 }
 private lastSelection:{action:Action|'continue';at:number}|null=null;
 get executionStatus(){return {remainingPlanSteps:Math.max(0,this.medium.steps.length-this.medium.activeStep),goalValidationFailures:this.longValidationFailures,progress:this.progress.context(Date.now()),activeAction:this.activeAction??null,actionPending:this.actionPending,selectorPending:this.decisionPending,mediumPending:this.planPending,longPending:this.longPending,dialoguePending:this.socialPending,reflectionPending:this.reflectionPending,needsGoalReview:this.options.goals?.needsReview??false,hasLongGoal:!!this.longGoal,lastSelection:this.lastSelection?{...this.lastSelection}:null};}
 private supervisorAt=-Infinity;
 private supervisorSequence=0;
 private selectionFeedback?:string;
 private supervisorUrgent=true;
 private longPending=false;
 private longLast=-Infinity;
 private longRequested=true;
 private longRetryAt=0;
 private longGeneration=0;
 private pendingSwitch?:{executionId:number;key:string;count:number};
 private executionIntention:string|null=null;
 private longValidationFailures=0;
 private executionId=0;
 private executionStarted=0;
 private executionPlan?:Plan;
 private executionObserved?:Snapshot;
 private executionTask?:Promise<void>;
 private lastLifeKey='';
 private lastDeathId='';
 private previouslyDead=false;
 private lastAlive?:Snapshot;
 private healthBefore=20;
 private newLife(s:Snapshot){
  const dead=s.lifecycle?s.lifecycle.phase==='dead':s.health<=0&&(s.ready||!!this.lastAlive),key=s.lifecycle?String(s.lifecycle.generation):String(s.ready);
  if(!s.ready&&this.lastReady&&!dead){this.invalidate('disconnected');this.longGeneration++;this.longValidationFailures=0;this.longPlannerFeedback=undefined;this.progress.reset();this.options.goals?.pause('Disconnected; review after reconnect');this.longRequested=true;this.longRetryAt=0;}
  const death=s.lifecycle?.lastDeath;
  if(death&&death.id!==this.lastDeathId){this.lastDeathId=death.id;this.options.recovery!.acceptDeath(death);this.longRequested=true;this.log('death_memory',{deathId:death.id});}
  if(dead&&!this.previouslyDead){if(!death){const d=this.options.recovery!.death(this.lastAlive??s);this.lastDeathId=d.id;}this.invalidate('death');this.longGeneration++;this.longValidationFailures=0;this.longPlannerFeedback=undefined;this.progress.reset();this.options.goals?.pause('Death; inspect respawn inventory and reconsider recovery');this.longGoal=null;this.longRequested=true;this.longRetryAt=0;this.plan={goal:'Review survival after death',preferred:'idle'};this.medium={summary:'Await respawn observations',steps:[],activeStep:0};this.planVersion++;}
  if(s.ready&&!dead&&(this.previouslyDead||key!==this.lastLifeKey||!this.lastReady)){
   this.invalidate('spawn or reconnect');this.longGeneration++;this.longValidationFailures=0;this.longPlannerFeedback=undefined;this.progress.reset();this.options.recovery!.respawn(s);this.options.goals?.pause('New life or reconnect: review current inventory and historical death uncertainty');this.longGoal=null;this.longRequested=true;this.longRetryAt=0;this.plan={goal:'Inspect current surroundings while reviewing intentions',preferred:'look'};this.medium={summary:'Review intentions',steps:[],activeStep:0};this.planVersion++;this.supervisorUrgent=true;
  }
  this.previouslyDead=dead;this.lastLifeKey=key;this.lastReady=s.ready;if(s.ready&&!dead)this.lastAlive=structuredClone(s);
 }
 private reconcileRecovery(s:Snapshot){
  if(this.options.recovery?.observe(s)){this.longRequested=true;this.requestPlan('recovery_outcome_changed');this.log('recovery_outcome',{recovery:this.options.recovery.context()});}
  s.recovery=this.options.recovery?.context();
 }
 private refreshLong(s:Snapshot,now:number){
  if(!this.brain.reviewGoals||this.longPending||!s.ready||s.health<=0||now<this.longRetryAt)return;
  if(!this.longRequested&&now-this.longLast<(this.options.longPlanMs??180000))return;
  if(!this.options.goals?.needsReview&&now-this.longLast<30000)return;
  this.longPending=true;this.longRequested=false;this.longLast=now;
  const recoveryVersion=this.options.recovery!.outcomeVersion();
  const generation=this.longGeneration,context=this.planning;context.goalReview=this.options.goals!.review(s,this.userGoal);
  void this.brain.reviewGoals(s,context,this.lifetime.signal).then(p=>{
   if(this.closed||generation!==this.longGeneration||!this.world.snapshot().ready)return;
   this.reconcileRecovery(this.world.snapshot());if(recoveryVersion!==this.options.recovery!.outcomeVersion()){this.longRequested=true;this.log('plan_discarded',{reason:'recovery outcome changed'});return;}
   if(p.recoveryDecision){const d=p.recoveryDecision;if(!this.options.recovery!.context().deaths.some(x=>x.id===d.deathId)||!['recover','prepare','defer','abandon','resolved'].includes(d.strategy)||!d.reason?.trim()||d.reason.length>500)throw Error('Invalid recovery intention: use a supplied deathId and a reason of 1-500 characters; omit recoveryDecision if there are no deaths');const outcome=this.options.recovery!.context().deaths.find(x=>x.id===d.deathId)?.outcome;if((d.strategy==='resolved')!==(outcome?.status==='supplies_restored'))throw Error('Invalid recovery outcome intention');}
   this.options.goals!.apply(context.goalReview!,p.goalUpdates,p.activeGoalId);
   if(p.recoveryDecision){const d=p.recoveryDecision;this.options.recovery!.decide(d.deathId,d.strategy,d.reason);}
   const next=this.options.goals!.snapshot().activeGoal?.description??null;
   if(next!==this.longGoal){this.longGoal=next;this.plan={goal:next??'Observe or wait',preferred:'idle'};this.mediumChain++;this.medium={summary:'Create medium plan under revised intention',steps:[],activeStep:0};this.planVersion++;this.supervisorUrgent=true;}
   this.longValidationFailures=0;this.longPlannerFeedback=undefined;this.requestPlan('long_goal_reviewed');this.log('goals_reviewed',{goals:this.options.goals!.snapshot(),recovery:p.recoveryDecision});
  }).catch(error=>{if(!this.closed&&generation===this.longGeneration){
   const reason=error instanceof Error&&/^(Invalid |Missing )/.test(error.message)?error.message.slice(0,240):'Long-term review failed';
   if(reason.startsWith('Invalid ')||reason.startsWith('Missing ')){this.longValidationFailures++;if(this.longValidationFailures>=3)this.log('goal_validation_stalled',{consecutive:this.longValidationFailures,reason});}
   this.longPlannerFeedback=reason;this.longRequested=true;this.longRetryAt=Date.now()+10000;this.log('long_planner_error',{reason});
  }}).finally(()=>{this.longPending=false;});
 }
 private refreshMedium(s:Snapshot,now:number){
  if(this.planPending||!s.ready||s.health<=0||!this.longGoal||this.options.goals?.needsReview||now<this.retryAfter)return;
  const remaining=this.medium.steps.slice(this.medium.activeStep),tail=remaining.at(-1)?.id;
  const tailKey=`${this.mediumChain}:${tail}`;
  const append=remaining.length>0&&remaining.length<=2&&this.actionPending&&!['idle','look'].includes(this.activeAction!)&&[...this.reasons].every(reason=>reason==='selector requested review')&&this.prefetchAttemptedTail!==tailKey&&now-this.lastPrefetch>=5000;
  if(!append&&(now-this.lastPlan<5000||!this.reasons.size&&now-this.lastPlan<this.options.planMs))return;
  this.planPending=true;this.lastPlan=now;
  const reviewRequest=this.reviewLifecycle.begin(this.reviewLifecycle.basis(this.planVersion,this.reviewLifecycle.observe(s)),[...this.reasons],now);
  let reviewStatus:ReviewReceipt['status']='discarded';
  const recoveryVersion=this.options.recovery!.outcomeVersion(),generation=this.longGeneration,goal=this.longGoal,chain=this.mediumChain,epoch=this.continuationEpoch,context=this.planning;
  delete context.goalReview;this.reasons.clear();
  if(append){this.lastPrefetch=now;this.prefetchAttemptedTail=tailKey;context.mediumRequest={mode:'append',remainingSteps:structuredClone(remaining),activeAction:this.activeAction??null};this.log('plan_prefetch_started',{chain,remaining:remaining.length});}
  void this.brain.plan(s,this.history.slice(-8),this.lifetime.signal,this.userGoal,context).then(p=>{
   if(this.closed||generation!==this.longGeneration||goal!==this.longGoal)return;
   this.reconcileRecovery(this.world.snapshot());if(recoveryVersion!==this.options.recovery!.outcomeVersion()){this.requestPlan('recovery_outcome_changed');return;}
   if(append){
    if(chain!==this.mediumChain||epoch!==this.continuationEpoch){this.log('plan_prefetch_discarded',{reason:'chain or execution outcome changed'});return;}
    const additions=p.steps??[];
    if(!additions.length){this.log('plan_prefetch_empty');return;}
    if(additions.some(step=>remaining.some(old=>old.id===step.id)))throw Error('Invalid continuation: return only NEW steps after remainingSteps, with new IDs');
    // Preserve the active plan and executor; only extend its ordered tail.
    const unfinished=this.medium.steps.slice(this.medium.activeStep),exhausted=!unfinished.length;
    this.medium.steps=[...unfinished,...structuredClone(additions)];this.medium.activeStep=0;
    if(exhausted){this.planVersion++;this.activateStep();this.supervisorUrgent=true;this.reasons.delete('medium_plan_completed');}
    this.plannerFeedback=undefined;reviewStatus='applied';this.reviewLifecycle.finish(reviewRequest,reviewStatus,Date.now(),this.planVersion);this.log('plan_prefetched',{added:additions.length,remaining:this.medium.steps.length,exhausted});return;
   }
   this.importantPlaces.observe(this.world.snapshot());
   const placeReceipt=this.importantPlaces.apply(p.placeUpdates,s.placeEvidence??[]);if(placeReceipt)this.log('place_memory_receipt',{receipt:placeReceipt});delete p.placeUpdates;
   // Only replace intentions. An ongoing executor retains its immutable plan until JEV changes it.
   this.mediumChain++;this.prefetchAttemptedTail=undefined;
   this.plan={...p,longTermGoal:this.longGoal??undefined};delete this.plan.goalUpdates;delete this.plan.activeGoalId;
   this.medium={summary:p.goal,steps:structuredClone(p.steps??[]),activeStep:0};this.planVersion++;if(this.medium.steps.length)this.activateStep();
   this.plannerFeedback=undefined;reviewStatus='applied';this.reviewLifecycle.finish(reviewRequest,reviewStatus,Date.now(),this.planVersion);this.supervisorUrgent=true;this.log('plan',{plan:this.plan,scope:'medium',review:this.reviewLifecycle.state(this.planVersion,[...this.reasons],Date.now())});
  }).catch(error=>{reviewStatus='failed';if(!this.closed&&generation===this.longGeneration){const reason=error instanceof Error&&/^(Invalid |Missing )/.test(error.message)?error.message.slice(0,240):'Medium plan failed';this.plannerFeedback=reason;this.requestPlan('medium_plan_error');this.retryAfter=Date.now()+10000;this.log('planner_error',{reason});}}).finally(()=>{this.reviewLifecycle.finish(reviewRequest,reviewStatus,Date.now(),reviewStatus==='applied'?this.planVersion:undefined);this.planPending=false;});
 }
 private socialFeedback?:string;
 private socialRetryAt=0;
 private socialFailures=0;
 private async converseQueued(s:Snapshot,now:number){
  const social=this.options.social;if(!social||!this.brain.communicate||this.socialPending||!social.canSpeak(now)||now<this.socialRetryAt)return;
  const inbox=social.addressed(),newWork=this.journal.recent.at(-1)?.id??0;
  const key=JSON.stringify([inbox.map(m=>m.id),newWork,s.nearbyPlayers?.map(p=>p.name)]);
  if(!inbox.length&&(now-this.lastSocial<(this.options.socialMs??30000)||key===this.lastSocialKey||(!s.nearbyPlayers?.length&&!social.context().heard.some(m=>m.speaker!==social.context().self&&now-m.at<300000))))return;
  if(inbox.length&&now-this.lastSocial<1500)return;
  this.socialPending=true;this.lastSocial=now;this.lastSocialKey=key;
  const life=this.longGeneration,ids=inbox.map(m=>m.id),original=compact(s),action=this.activeAction;
  try{
   const speech=await this.brain.communicate({...s,social:social.context()},this.plan,this.lifetime.signal,{activeAction:action??null,planPending:this.planPending,feedback:this.socialFeedback});
   if(this.closed||life!==this.longGeneration)return;
   this.socialFailures=0;this.socialRetryAt=0;this.socialFeedback=undefined;
   if(!speech){social.handled(ids);this.log('social_silence');return;}
   const fresh=this.world.snapshot();fresh.importantPlaces=this.importantPlaces.snapshot();
   if(!fresh.ready)return;
   // Questions/replies can survive unrelated actions. Factual progress reports must still match.
   if(speech.kind==='report'||speech.promise?.status==='completed'){
    const current=compact(fresh);if(JSON.stringify([current.inventory,current.health,current.food,current.position])!==JSON.stringify([original.inventory,original.health,original.food,original.position])){this.log('social_discarded',{reason:'reported facts changed'});return;}
   }
   if(ids.length&&(!speech.replyTo||!ids.includes(speech.replyTo))){this.log('social_discarded',{reason:'reply must identify pending message'});return;}
   if(speech.aliases?.length)social.rememberAliases(speech.aliases);
   const result=social.send(speech,t=>this.world.chat(t),Date.now(),JSON.stringify([original.inventory,original.health,original.food]));
   if(result.sent){social.handled(speech.replyTo?[speech.replyTo]:[]);if(speech.promise||['accept','decline'].includes(speech.kind)){this.requestPlan('conversation commitment');this.longRequested=true;}}
   this.log('social_speech',result);
  }catch(error){if(!this.closed){this.socialFeedback=error instanceof Error&&/^Invalid /.test(error.message)?error.message.slice(0,240):'Conversation request failed';this.socialRetryAt=Date.now()+Math.min(60000,10000*2**Math.min(3,this.socialFailures++));this.log('social_error',{reason:this.socialFeedback,retryAfterMs:this.socialRetryAt-Date.now()});}}finally{this.socialPending=false;}
 }
 private async tickContinuous(now:number){
  const s=this.observation();this.newLife(s);this.reconcileRecovery(s);
  if(!s.ready||s.health<=0)return;
  const progress=this.progress.observe(s,now),review=this.progress.review(now);
  if(review){this.requestPlan('no_observed_progress_reconsider_current_approach');if(review==='long')this.longRequested=true;this.log('progress_review',{...progress,scope:review});}
  const enemyKey=JSON.stringify(s.enemies?.map(e=>e.id)??[]);
  if(enemyKey!==this.lastEnemies||s.health<this.healthBefore){this.supervisorUrgent=true;this.lastEnemies=enemyKey;}
  this.healthBefore=s.health;
  this.refreshLong(s,now);this.refreshMedium(s,now);void this.reflectMemory();void this.converseQueued(s,now);
  if(!this.actionPending)this.checkStep(s);
  if(this.decisionPending||!this.supervisorUrgent&&now-this.supervisorAt<(this.options.selectorMs??1000))return;
  this.supervisorUrgent=false;this.supervisorAt=now;this.decisionPending=true;
  const life=this.longGeneration,execId=this.executionId,started=Date.now(),requestId=++this.supervisorSequence;
  const reviewBasis=this.reviewLifecycle.basis(this.planVersion,this.reviewLifecycle.observe(s));
  const options=this.brain.parameterSelection?[]:executionOptions(s,this.plan).filter(o=>!this.retries.blocked(o.action,o.plan,s)&&(o.action!=='look'||now-this.lastLookAt>=2000));
  const inbox=this.options.social?.pendingRouting(now)??[];
  const input:SupervisorInput={placeMemoryReview:this.importantPlaces.review(),executionEvidence:executionEvidence(this.journal.recent),planningState:this.reviewLifecycle.state(this.planVersion,[...this.reasons],now),selectionFeedbackStatus:this.reviewLifecycle.feedbackStatus(),parameterSelection:this.brain.parameterSelection,selectionFeedback:this.selectionFeedback,blockedInteractions:this.planning.blockedInteractions,options,execution:this.actionPending?{id:execId,action:this.activeAction!,plan:this.executionPlan!,elapsedMs:Date.now()-this.executionStarted,motor:structuredClone(this.world.executionProgress?.()),observedChanges:this.executionObserved?changes(compact(this.executionObserved),compact(s)):undefined,interruptionNote:this.activeAction==='mine'?'Interrupting mining can lose accumulated digging progress':'Switching cancels the current local execution'}:null,inbox,goal:this.longGoal,plan:this.plan,progress,recentOutcome:this.journal.recent.at(-1),recentLookResults:this.journal.recent.filter(r=>r.decision.action==='look').slice(-6).map(r=>({id:r.id,endedAt:r.endedAt,outcome:r.outcome,requested:r.executionPlan?.look,view:r.changes.view})),recentResults:this.journal.recent.filter(r=>!['idle','look'].includes(r.decision.action)).slice(-4).map(r=>({id:r.id,endedAt:r.endedAt,action:r.decision.action,outcome:r.outcome,target:r.executionPlan?.destination,navigation:r.navigation,result:r.result.slice(0,400),changes:r.changes})),recovery:s.recovery};
  this.log('supervisor_request',{requestId,executionId:execId,observedAt:started,executionRunning:!!input.execution});
  try{
   const d=await this.brain.supervise!(s,input,this.lifetime.signal);
   this.log('supervisor_response',{requestId,executionId:execId,elapsedMs:Date.now()-started,executionRunning:this.actionPending,choice:d.choice,review:d.review,selectionControl:d.selectionControl});
   if(this.closed||life!==this.longGeneration)return;
   // Routing belongs to message IDs, not movement state. Preserve new arrivals in the queue.
   for(const m of inbox)if(d.routes[m.id])this.options.social?.route(m.id,d.routes[m.id]);
   const fresh=this.world.snapshot();fresh.importantPlaces=this.importantPlaces.snapshot();
   if(!fresh.ready||fresh.health<=0||Date.now()-started>(this.options.decisionTtlMs??(this.brain.parameterSelection?30000:5000))||execId!==this.executionId){this.log('decision_discarded');return;}
   if(fresh.health<s.health||JSON.stringify(fresh.enemies?.map(e=>e.id)??[])!==enemyKey){this.supervisorUrgent=true;this.log('decision_discarded',{reason:'threat changed'});return;}
   // Keep failures that occurred after an in-flight planner's evidence snapshot.
   if(d.choice==='unresolved'&&d.reason!=='Model requested planning'&&(d.attempt||!this.selectionFeedback))this.rememberSelectionFeedback(JSON.stringify({kind:'unexecuted_selector_decision',reason:d.reason,...(d.attempt?{attempt:d.attempt}:{}),at:Date.now(),note:'No action executed. This is a model selection outcome, not proof that the skill or target is physically impossible.'}),reviewBasis);
   if(d.review==='long')this.longRequested=true;else if(d.review==='medium'){this.requestSelectorReview({...reviewBasis,feedbackVersion:this.reviewLifecycle.basis(this.planVersion).feedbackVersion});if(!this.longGoal)this.longRequested=true;}
   if(d.choice==='continue'&&!this.actionPending){this.pendingSwitch=undefined;this.supervisorUrgent=true;this.log('decision_discarded',{requestId,executionId:execId,reason:'execution already finished'});return;}
   if(d.choice==='continue'){this.pendingSwitch=undefined;this.lastSelection={action:'continue',at:Date.now()};this.log('execution_continue',{executionId:execId});return;}
   if(d.choice==='unresolved'){this.log('parameter_selection_unresolved',{requestId,reason:d.reason,attempt:d.attempt});return;}
   if(d.choice==='stop'){
    if(!input.execution||!this.actionPending){this.supervisorUrgent=true;this.log('decision_discarded',{requestId,reason:'execution already finished'});return;}
    const phase=this.world.executionProgress?.()?.phase;
    if(input.execution.motor?.phase!==phase){this.supervisorUrgent=true;this.log('decision_discarded',{requestId,reason:'execution phase changed',requestedPhase:input.execution.motor?.phase,currentPhase:phase});return;}
    this.pendingSwitch=undefined;this.log('execution_stop',{requestId,executionId:execId});this.actionController?.abort();this.world.stop();await this.executionTask;this.supervisorUrgent=true;return;
   }
   const selected=d.selected??options.find(o=>o.id===d.choice);
   if(d.choice==='wait'||selected?.action==='idle'){this.supervisorUrgent=true;this.log('decision_discarded',{requestId,reason:'intentional idle is not a selectable action'});return;}
   if(!selected||!candidates(fresh,selected.plan).includes(selected.action)){const reason=selected?.action==='move'&&selected.plan.destination&&moveReached(fresh.position,selected.plan.destination)?'Selected destination is already within arrival radius 2; no movement would occur':'Selected arguments do not pass current physical/observation validation';this.rememberSelectionFeedback(JSON.stringify({kind:'unexecuted_selector_decision',reason,selected: selected?{action:selected.action,plan:selected.plan}:null,currentPosition:fresh.position,at:Date.now()}),reviewBasis);this.log('decision_discarded',{requestId,reason:'selected arguments no longer executable',detail:reason,selectedAction:selected?.action});this.supervisorUrgent=true;return;}
   if(this.actionPending&&this.activeAction===selected.action&&executionIdentity(this.activeAction!,this.executionPlan!)===executionIdentity(selected.action,selected.plan)){this.pendingSwitch=undefined;return;}
   // A switch based on a superseded motor phase needs a fresh model decision.
   // This is not a preference for continuation: a fresh stop is still applied.
   const currentMotor=this.world.executionProgress?.();
   if(this.actionPending&&input.execution&&input.execution.motor?.phase!==currentMotor?.phase){
    this.pendingSwitch=undefined;this.supervisorUrgent=true;
    this.log('decision_discarded',{requestId,executionId:execId,reason:'execution phase changed',requestedPhase:input.execution.motor?.phase,currentPhase:currentMotor?.phase,selectedAction:selected.action});return;
   }
   if(!this.brain.parameterSelection&&this.actionPending&&!['idle','look'].includes(this.activeAction!)){
    const urgent=!!fresh.enemies?.length||fresh.health<(this.executionObserved?.health??fresh.health)||selected.action==='eat'&&fresh.food<14&&fresh.canEat;
    if(!urgent&&this.longGoal===this.executionIntention&&completionBoundary(this.world.executionProgress?.())){this.pendingSwitch=undefined;this.log('switch_deferred_completion',{from:this.activeAction,to:selected.action,motor:this.world.executionProgress?.()});return;}
    const key=executionIdentity(selected.action,selected.plan),old=this.pendingSwitch;
    const count=old?.executionId===execId&&old.key===key?old.count+1:1;
    this.pendingSwitch={executionId:execId,key,count};
    if(!urgent&&count<3){this.log('switch_confirmation_pending',{from:this.activeAction,to:selected.action,count,executionId:execId});return;}
   }
   this.pendingSwitch=undefined;
   if(this.actionPending){this.log('execution_switch',{from:this.activeAction,to:selected.action,choice:d.choice,elapsedMs:Date.now()-this.executionStarted,fromIdentity:executionIdentity(this.activeAction!,this.executionPlan!),toIdentity:executionIdentity(selected.action,selected.plan)});this.actionController?.abort();this.world.stop();await this.executionTask;}
   if(this.closed||life!==this.longGeneration||!candidates(this.world.snapshot(),selected.plan).includes(selected.action))return;
   this.reviewLifecycle.actionStarted(Date.now());this.selectionFeedback=undefined;this.lastSelection={action:selected.action,at:Date.now()};this.log('decision',{action:selected.action,confidence:d.confidence,control:'start_or_switch'});
   this.executionId++;this.executionIntention=this.longGoal;this.executionStarted=Date.now();this.executionPlan=structuredClone(selected.plan);this.executionObserved=structuredClone(fresh);
   this.executionTask=this.run({action:selected.action,confidence:d.confidence},this.brain.parameterSelection?actions:options.map(o=>o.action),'selector',s,selected.plan);
   void this.executionTask.catch(()=>this.log('execution_error'));
  }catch(error){if(!this.closed)this.log('decision_error',{requestId,executionId:execId,elapsedMs:Date.now()-started,...safeDecisionError(error)});}finally{this.decisionPending=false;}
 }
 close(drainModels=false){this.importantPlaces.flush(true);this.closed=true;this.epoch++;if(!drainModels)this.lifetime.abort();this.actionController?.abort();this.world.stop();this.world.close();}
}
