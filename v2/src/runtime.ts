import {StuckGuard} from './stuck-guard.js';
const GOAL_STALL_MS=5*60000,TASK_CONTINUE_LIMIT=4;
import {fleeFollowups,FLEE_FOLLOWUP_MEANING} from './combat-followup.js';
import {uncovered,threatBasis,basisChanges} from './threat-response.js';
import {capturePlanBasis,planFreshness,type PlanBasis} from './plan-freshness.js';
import {ProcedureRunner,parseProcedure,procedureIdentity,procedureBasis,inspectProcedureOffer,type ProcedureOfferStatus} from './procedure.js';
import {MAX_DIG_BUDGET_MS} from './mining.js';
import {NavigationFailure,executionEvidence,type NavigationEvidence} from './execution-evidence.js';
import {ImportantPlaces,placeEvidence} from './important-places.js';
import {viewChange} from './view-change.js';
import {ReviewLifecycle,safeDecisionError,type ReviewBasis,type ReviewReceipt} from './review-lifecycle.js';
import {bindWorkIntent,validateTaskReview} from './task-review.js';
import {intentSatisfied} from './work-intent.js';
import {ProgressTracker} from './progress.js';
import {completionBoundary,executionOptions,executionIdentity,type SupervisorInput} from './supervision.js';
import {RecoveryMemory} from './recovery.js';
import {moveReached} from './action-contracts.js';
import {supportsFeet} from './building.js';
import {RetryPolicy} from './retry-policy.js';
import {GoalBook} from './goals.js';
import {reviewFacts,STARTUP_ORIENTATION} from './goal-review.js';
import {DeliveryLog} from './deliveries.js';
const MESSAGE_DECISION_WAIT_MS=20000;
import {readPickupResult} from './pickup.js';
import {readMiningResult} from './mining.js';
import type {SocialMemory} from './social.js';
import type {ExperienceMemory} from './experience-memory.js';
import { actions,candidates, hasMiningTool, type Action, type Brain, type Decision, type Log, type Plan, type Snapshot, type World } from './types.js';
import {Journal,compact,changes,classify,completed,type PlanningContext,type Outcome} from './planning.js';
export type RuntimeOptions = { workflowMode?:'direct'|'procedural'; selectorMs?:number;longPlanMs?:number;reflectionMs?:number;socialMs?:number;decisionTtlMs?:number;recovery?:RecoveryMemory; planMs: number; actionMs: number; minConfidence: number; selectorKind?: string; memory?:ExperienceMemory; social?:SocialMemory; reflectionEnabled?:boolean; goals?:GoalBook };
export class Runtime {
 private procedureRunner?:ProcedureRunner;
 private acceptedPlanBasis?:PlanBasis;
 private latestSnapshot?:Snapshot;
 private abortBySupervisor(choice:string,requestId:number,executionId:number){
  const interruption={source:'supervisor' as const,choice,requestId,executionId,at:Date.now(),motor:this.world.executionProgress?.()};
  this.actionController?.abort(Object.assign(new Error(`Supervisor selected ${choice}`),{name:'AbortError',interruption}));
 }
 private activeExecutionView(){return this.actionPending&&this.activeAction&&this.executionPlan?{id:this.executionId,action:this.activeAction,plan:this.executionPlan,elapsedMs:Math.max(0,Date.now()-this.executionStarted),motor:this.world.executionProgress?.()}:null;}
 private currentPlanFreshness(s=this.latestSnapshot){return planFreshness(this.acceptedPlanBasis,s,{activeExecution:this.activeExecutionView(),procedure:this.procedureRunner?.view(),recentActions:this.journal.recent});}
 private failedProcedures=new Map<string,{basis:string;reason:string}>();
 private procedureOfferStatus?:ProcedureOfferStatus;
 private lastProcedureRejection='';
 private rememberProcedureFailure(runner:ProcedureRunner,s:Snapshot){
  const v=runner.view();if(v.status!=='blocked')return;
  this.failedProcedures.set(procedureIdentity(v.definition),{basis:procedureBasis(v.definition,s),reason:v.reason??'Procedure blocked'});
  while(this.failedProcedures.size>16)this.failedProcedures.delete(this.failedProcedures.keys().next().value!);
 }
 private inspectProcedure(s:Snapshot):ProcedureOfferStatus{
  const p=this.plan.procedure;if(this.options.workflowMode!=='procedural'||!p)return {available:false};
  const id=procedureIdentity(p),active=this.procedureRunner?.view();
  if(active&&procedureIdentity(active.definition)===id&&['running','suspended'].includes(active.status))return {available:false,reason:'Already accepted job; use continue or resume_procedure to retain progress and budgets'};
  const failed=this.failedProcedures.get(id);
  if(failed&&failed.basis===procedureBasis(p,s))return {available:false,reason:'Unchanged blocked procedure: '+failed.reason};
  return inspectProcedureOffer(this.plan,s,item=>this.world.recipes?.(item)??[]);
 }
 private importantPlaces:ImportantPlaces;
 private reviewLifecycle=new ReviewLifecycle();
 plan:Plan={goal:'Observe before acting',preferred:'idle'};
 history:string[]=[];
 private assignedGoal:string|null=null;
 private requestStatus?:import('./types.js').UserRequestStatus;
 // Goal-layer decisions on addressed messages, keyed by message ID; dialogue waits for them.
 readonly deliveries=new DeliveryLog();
 private messageDecisions=new Map<string,import('./types.js').MessageDecision&{at:number}>();
 // Every addressed message with its goal-layer status; pending ones are not work yet.
 private requestDecisionView(){return [...this.undecidedMessages().map(m=>({messageId:m.id,decision:'pending_goal_decision'})),...[...this.messageDecisions.values()].slice(-6).map(d=>({messageId:d.messageId,decision:d.decision,reason:d.reason}))];}
 // With a goal layer, it routes every new message from others; JEV no longer classifies chat.
 // Recent placement receipts with the observed result, so dialogue can say what was placed where.
 private recentPlacements(){return this.journal.recent.filter(r=>r.decision.action==='place_block').slice(-4).flatMap(r=>{try{const x=JSON.parse(r.result);return x.kind==='placement'?[{item:x.item,requested:{position:x.position,...(x.facing?{facing:x.facing}:{})},observedPlacement:x.observedPlacement??null,confirmed:x.confirmed,at:r.endedAt}]:[];}catch{return [];}});}
 private undecidedMessages(){const social=this.options.social;if(!social)return [];return (this.brain.reviewGoals?social.pendingRouting():social.addressed()).filter(m=>!this.messageDecisions.has(m.id));}
 private longGoal:string|null=null;
 private progress=new ProgressTracker();
 private reflectionFeedback?:string;
 private medium:PlanningContext['mediumTerm']={summary:'Observe before acting',steps:[],activeStep:0};
 private journal=new Journal();
 private reasons=new Set(['initial']);
 private retries=new RetryPolicy();
 private stuck=new StuckGuard();
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
 private taskReviews:import('./task-review.js').TaskReviewReceipt[]=[];
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
 constructor(readonly world:World,private brain:Brain,private options:RuntimeOptions,private log:Log){
  if(options.workflowMode&&brain.workflowMode&&options.workflowMode!==brain.workflowMode)throw Error('Workflow mode differs between planner and runtime');
  options.workflowMode??=brain.workflowMode??'direct';
  if(options.workflowMode==='procedural'&&(!brain.supervise||!brain.parameterSelection))throw Error('Procedural workflow requires continuous parameter selection');
  this.log('workflow_configuration',{mode:options.workflowMode,version:options.workflowMode==='procedural'?'v2.5':'v2'});
  this.importantPlaces=world.importantPlaces??new ImportantPlaces();if(brain.supervise){options.goals??=new GoalBook();options.recovery??=new RecoveryMemory();}
 }
 private observation(){const s=this.world.snapshot();s.stuck=this.stuck.view();this.importantPlaces.observe(s);s.importantPlaces=this.importantPlaces.snapshot();s.placeEvidence=placeEvidence(s);if(this.options.recovery)s.recovery=this.options.recovery.view();if(this.options.memory)s.memoryGuidance=this.options.memory.retrieve(s,[this.activeAction,this.plan.preferred,...(this.plan.intent?['mine','move','craft'] as Action[]:[])].filter((x):x is Action=>!!x));if(this.options.social){this.options.social.ingest(s.chatEvents??[]);s.social=this.options.social.context();}this.reviewLifecycle.observe(s);this.latestSnapshot=s;return s;}
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
   if(!this.closed&&!this.lifetime.signal.aborted){
    const guides=()=>JSON.stringify(memory.retrieve().map(g=>[g.id,g.version]).sort()),before=guides();
    memory.apply(input,updates,this.brain.reflectionModel);this.reflectionFeedback=undefined;
    // Changed guidance can change what is worth pursuing, so the goal layer reviews it.
    const changed=guides()!==before;if(changed&&this.brain.reviewGoals){this.longRequested=true;this.requestPlan('experience_guidance_changed');}
    this.log('memory_reflected',{through:input.through,guidanceChanged:changed});
   }
  }catch(error){this.reflectionFeedback=error instanceof Error&&/^(Invalid |Unseen |Cannot |Stale |Duplicate )/.test(error.message)?error.message.slice(0,240):'Memory review failed';this.log('memory_reflection_error',{reason:this.reflectionFeedback});}finally{this.reflectionPending=false;}
 }
 get userGoal(){return this.assignedGoal;}
 private allGuides(){try{return this.options.memory?.retrieve().map(g=>({id:g.id,version:g.version}))??[];}catch{return [];}}
 private threatPolicyView(){if(!this.plan.threatResponse)return {};const changed=basisChanges(this.threatPolicyBasis,threatBasis(this.latestSnapshot??this.world.snapshot(),this.allGuides()));return {threatPolicy:{current:this.plan.threatResponse,changedSinceSet:changed,meaning:'The policy in force. A returned threatResponse replaces it only when changedSinceSet is non-empty (gear, health band, day phase, guidance or life changed); otherwise omit threatResponse.'}};}
 private fleeFollowupView(){const entries=fleeFollowups(this.journal.recent);return entries.length?{fleeFollowups:{entries,meaning:FLEE_FOLLOWUP_MEANING}}:{};}
 get planning():PlanningContext {return structuredClone({...(this.stuck.view()?{stuck:this.stuck.view()}:{}),...this.fleeFollowupView(),...this.threatPolicyView(),planFreshness:this.currentPlanFreshness(),procedureOfferStatus:this.procedureOfferStatus,procedure:this.procedureRunner?.view(),taskReviews:this.taskReviews,placeMemoryReview:this.importantPlaces.review(),activeExecution:this.activeExecutionView(),planningState:this.reviewLifecycle.state(this.planVersion,[...this.reasons],Date.now()),selectorFeedbackStatus:this.reviewLifecycle.feedbackStatus(),selectorFeedback:this.selectionFeedback,...(this.plan.intent?{workIntent:this.plan.intent}:{}),progress:this.progress.context(Date.now()),...(this.longPlannerFeedback?{longPlannerFeedback:this.longPlannerFeedback}:{}),blockedInteractions:this.retries.context(),observationStreak:this.observationStreak,...(this.plannerFeedback?{plannerFeedback:this.plannerFeedback}:{}),userRequest:this.assignedGoal,...(this.requestStatus?{userRequestStatus:this.requestStatus}:{}),...(this.deliveries.view()?{deliveries:this.deliveries.view()}:{}),...(this.options.goals?{goalState:this.options.goals.snapshot()}:{}),longTermGoal:this.longGoal,mediumTerm:this.medium,replanReasons:[...this.reasons],recentActions:this.journal.recent,olderSummary:this.journal.older,failureStreak:this.failureStreak});}
 setGoal(goal:string|null){
  if(this.closed)return;const next=goal?.trim()||null;if(next===this.assignedGoal)return;
  this.acceptedPlanBasis=undefined;this.assignedGoal=next;this.requestStatus=undefined;this.longGeneration++;this.longValidationFailures=0;this.longPlannerFeedback=undefined;this.progress.reset();this.longRequested=true;this.longRetryAt=0;this.supervisorUrgent=true;this.options.goals?.requireReview('operator_request_changed','Operator request changed; decide how the current intention relates to it');if(!this.options.goals)this.longGoal=next;this.medium={summary:'Observe and replan',steps:[],activeStep:0};
  this.plan={goal:'Observe and replan',preferred:'idle',userRequest:next};this.planVersion++;this.failureStreak=0;this.failureKey='';this.retryAfter=0;
  this.invalidate('user goal changed');this.log('user_goal',{userGoal:next});
 }
 note(result:string){this.history=[...this.history,result].slice(-20);this.log('result',{result});}
 private requestPlan(reason:string){this.reasons.add(reason);}
 private threatPlanRequested='';private threatPlanRequestedAt=0;private threatPolicyBasis?:ReturnType<typeof threatBasis>;
 private requestSelectorReview(basis:ReviewBasis){
  if(this.reviewLifecycle.covers(basis)){this.log('plan_review_deduplicated',{basis});return;}
  this.requestPlan('selector requested review');
 }
 private rememberSelectionFeedback(feedback:string,basis:ReviewBasis){
  this.selectionFeedback=feedback;
  this.log('selector_feedback',{event:this.reviewLifecycle.noteFeedback(feedback,basis,Date.now())});
 }
 invalidate(reason:string){this.suspendProcedure(reason,false);this.epoch++;this.continuationEpoch++;this.requestPlan(reason);this.actionController?.abort();this.world.stop();this.log('invalidate',{reason});}
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
 private record(decision:Decision,options:Action[],source:'selector'|'local_safety'|'procedure',version:number,context:PlanningContext,before:Snapshot,after:Snapshot,outcome:Outcome,result:string,startedAt:number,decisionObserved:Snapshot=before,executionPlan?:Plan,navigation?:NavigationEvidence,interruption?:import('./planning.js').ActionRecord['interruption']){
  const a=compact(before),b=compact(after);
  const unlocked=after.recipeBook.unlocked.filter(id=>!before.recipeBook.unlocked.includes(id));
  const record=this.journal.add({...(interruption?{interruption}:{}),...(source==='procedure'?{procedureId:context.procedure?.id}:{}),...(navigation?{navigation}:{}),...(executionPlan?{executionPlan:structuredClone(executionPlan)}:{}),...(decision.action==='pickup'&&readPickupResult(result)?{pickup:readPickupResult(result)}:{}),...(decision.action==='mine'&&readMiningResult(result)?{mining:readMiningResult(result)}:{}),decision,decisionObserved:compact(decisionObserved),selectorKind:source==='procedure'?'local_procedure':source==='local_safety'?'local_rule':this.options.selectorKind??'unspecified_selector',options,source,planVersion:version,goal:context.longTermGoal,stepId:source==='procedure'?context.procedure?.definition.steps[context.procedure.stepIndex]?.id??null:context.mediumTerm.steps[context.mediumTerm.activeStep]?.id??null,before:a,after:b,changes:{...changes(a,b),view:viewChange(before,after),newlyUnlocked:unlocked.slice(0,128),newlyUnlockedCount:unlocked.length},outcome,result,startedAt,endedAt:Date.now()});
  if(outcome!=='skipped'&&(!(decision.action==='idle'||decision.action==='look')||JSON.stringify(a)!==JSON.stringify(b)))this.evidenceVersion++;
  try{this.options.goals?.record(record);}catch{this.log('goal_evidence_write_error');}
  try{this.options.memory?.add(record,(decisionObserved.memoryGuidance??[]).map(g=>({id:g.id,version:g.version})));}catch{this.log('memory_write_error');}
  try{this.options.social?.recordAction(record);}catch{this.log('social_memory_write_error');}
  this.log('action_record',{record});
  // Every fight or flight is reflected on promptly so the next threat policy can use what it showed.
  if(!this.closed)void this.reflectMemory(false,outcome==='failed'||['attack','flee'].includes(decision.action));
 }
 private async run(decision:Decision,options:Action[],source:'selector'|'local_safety'|'procedure',observed?:Snapshot,executionPlan?:Plan,remainingMs?:number){
  if(this.actionPending||this.closed)return;
  const action=decision.action,before=this.world.snapshot(),context=this.planning,version=this.planVersion,plan=structuredClone(executionPlan??this.plan),startedAt=Date.now();
  this.actionPending=true;this.activeAction=action;
  const controller=new AbortController();this.actionController=controller;
  const signal=AbortSignal.any([controller.signal,this.lifetime.signal,...(remainingMs?[AbortSignal.timeout(remainingMs)]:[]),AbortSignal.timeout(action==='mine'?MAX_DIG_BUDGET_MS+this.options.actionMs+5000:this.options.actionMs)]);
  let outcome:Outcome='failed',result='Action failed';let navigation:NavigationEvidence|undefined;
  try{result=await this.world.execute(action,signal,plan);outcome=signal.aborted?'cancelled':classify(action,result);if(action==='pickup'||action==='mine'){try{navigation=JSON.parse(result).navigation;}catch{}}}
  catch(e){if(e instanceof NavigationFailure)navigation=e.evidence;outcome=signal.aborted&&signal.reason?.name!=='TimeoutError'?'cancelled':'failed';
   const known=e instanceof Error && /^(No |Log |Equipment |Deposit |Eating |Crafting |Missing |Insufficient |Destination |Player |Unknown item|Invalid crafting|Placement |Withdrawal |Transfer |Invalid transfer|Invalid block|Block )/.test(e.message)?e.message.slice(0,180):`Action ${action} ${signal.reason?.name==='TimeoutError'?'timed out':outcome}`;result=known;}
  finally{
   const after=this.world.snapshot();this.latestSnapshot=after;
   const receipt=this.world.executionReceipt?.();if(receipt){let parsed:Record<string,unknown>={};try{const value=JSON.parse(result);if(value&&typeof value==='object')parsed=value;}catch{}result=JSON.stringify({...parsed,...receipt,executionOutcome:outcome,detail:(receipt.actionEvidence as any)?.failureReason??parsed.detail??result});}
   if(!['idle','look'].includes(action)&&outcome!=='succeeded')this.continuationEpoch++;
   this.retries.record(action,plan,after,outcome==='failed'||outcome==='partial',result);
   this.noteProgress(action,outcome,before,after);
   this.stuck.executed(action);this.stuck.recordResult(action,action==='mine'?plan.mine?.position:action==='place_block'?plan.build?.position:action==='move'?plan.destination:undefined,outcome);
   if(action==='look'){this.lastLookAt=Date.now();let novel=0;for(const b of after.vision?.blocks??[]){const k=JSON.stringify([b.name,b.position]);if(!this.knownViews.has(k))novel++;this.knownViews.add(k);}
    this.observationStreak=novel?0:this.observationStreak+1;if(this.observationStreak===4||this.observationStreak%20===0)this.requestPlan('repeated_observation_without_new_information_choose_meaningful_action');
    if(this.knownViews.size>4096)this.knownViews.clear();
   }else if(outcome==='succeeded'&&action!=='idle')this.observationStreak=0;
   this.record(decision,options,source,version,context,before,after,outcome,result,startedAt,observed??before,plan,navigation,signal.aborted&&signal.reason?.interruption?.source==='supervisor'?signal.reason.interruption:undefined);this.note(result);
   if(action==='give'&&plan.transfer?.recipient){try{const r=JSON.parse(result);if(r.outcome==='dropped_receipt_unconfirmed')this.deliveries.record(this.journal.recent.at(-1)?.id??0,r.recipient,r.item,r.count,before.position);}catch{}}
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
  return outcome;
 }
 private suspendProcedure(reason:string,resumable=true){
  const runner=this.procedureRunner;if(!runner)return;
  const running=runner.view().status==='running';runner.suspend(reason,resumable);
  if(running){this.requestPlan('procedure_suspended');this.log('procedure_suspended',{procedure:runner.view()});}
 }
 private pumpProcedure(){
  const runner=this.procedureRunner;if(!runner||runner.view().status!=='running'||this.closed||this.actionPending)return;
  const fresh=this.observation(),before=runner.view(),command=runner.next(fresh,item=>this.world.recipes?.(item)??[]);
  const after=runner.view();this.rememberProcedureFailure(runner,fresh);
  if(after.completedSteps.length!==before.completedSteps.length)this.log('procedure_steps_completed',{procedure:after,evidence:compact(fresh)});
  if(!command){this.log('procedure_'+after.status,{procedure:after,evidence:compact(fresh)});if(after.status==='blocked'||after.status==='completed'){this.requestPlan('procedure_'+after.status);this.supervisorUrgent=true;}return;}
  this.reviewLifecycle.actionStarted(Date.now());this.selectionFeedback=undefined;
  this.executionId++;this.executionIntention=this.longGoal;this.executionStarted=Date.now();this.executionPlan=structuredClone(command.plan);this.executionObserved=structuredClone(fresh);
  this.log('procedure_action',{procedureId:after.id,executionId:this.executionId,taskId:runner.owner.intent?.taskId,stepId:command.stepId,action:command.action,plan:command.plan,binding:command.binding,materials:after.materials});
  this.executionTask=this.run({action:command.action,confidence:1},[command.action],'procedure',fresh,command.plan,runner.remainingMs()).then(outcome=>{
   const previousStatus=runner.view().status;
   runner.finish(outcome??'skipped',this.world.snapshot());this.rememberProcedureFailure(runner,this.world.snapshot());
   // A cancellation/replacement can occur while the primitive is settling.
   if(this.procedureRunner!==runner||this.closed)return;
   if(runner.view().status==='running')this.pumpProcedure();
   else if(previousStatus==='running'){this.log('procedure_'+runner.view().status,{procedure:runner.view(),evidence:compact(this.world.snapshot())});this.requestPlan('procedure_'+runner.view().status);}
  }).catch(error=>{runner.block('Unexpected local procedure execution error');this.log('procedure_blocked',{procedure:runner.view()});this.requestPlan('procedure_error');});
 }
 private lastSelection:{action:Action|'continue';at:number}|null=null;
 get executionStatus(){return {procedure:this.procedureRunner?.view(),remainingPlanSteps:Math.max(0,this.medium.steps.length-this.medium.activeStep),goalValidationFailures:this.longValidationFailures,progress:this.progress.context(Date.now()),activeAction:this.activeAction??null,actionPending:this.actionPending,selectorPending:this.decisionPending,mediumPending:this.planPending,longPending:this.longPending,dialoguePending:this.socialPending,reflectionPending:this.reflectionPending,needsGoalReview:this.options.goals?.needsReview??false,hasLongGoal:!!this.longGoal,lastSelection:this.lastSelection?{...this.lastSelection}:null};}
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
  if(!s.ready&&this.lastReady&&!dead){this.invalidate('disconnected');this.acceptedPlanBasis=undefined;this.longGeneration++;this.longValidationFailures=0;this.longPlannerFeedback=undefined;this.progress.reset();this.options.goals?.requireReview('disconnected','Disconnected; time passed and the world may have changed while offline');this.longRequested=true;this.longRetryAt=0;}
  const death=s.lifecycle?.lastDeath;
  if(death&&death.id!==this.lastDeathId){this.lastDeathId=death.id;this.options.recovery!.acceptDeath(death);this.longRequested=true;this.log('death_memory',{deathId:death.id});}
  if(dead&&!this.previouslyDead){if(!death){const d=this.options.recovery!.death(this.lastAlive??s);this.lastDeathId=d.id;}this.invalidate('death');this.acceptedPlanBasis=undefined;this.longGeneration++;this.longValidationFailures=0;this.longPlannerFeedback=undefined;this.progress.reset();this.options.goals?.requireReview('death','Died; carried items and equipment were likely dropped at the death site and the current task is invalid');this.longRequested=true;this.longRetryAt=0;this.plan={goal:'Review survival after death',preferred:'idle'};this.medium={summary:'Await respawn observations',steps:[],activeStep:0};this.planVersion++;}
  if(s.ready&&!dead&&(this.previouslyDead||key!==this.lastLifeKey||!this.lastReady)){
   this.invalidate('spawn or reconnect');this.acceptedPlanBasis=undefined;this.longGeneration++;this.longValidationFailures=0;this.longPlannerFeedback=undefined;this.progress.reset();this.options.recovery!.respawn(s);if(this.lastLifeKey!==''||!this.options.goals?.needsReview)this.options.goals?.requireReview(this.previouslyDead?'respawn_after_death':'reconnect',this.previouslyDead?'Respawned after death; decide recovery of lost items and whether the intention is still feasible with current inventory':'Reconnected or new session; recheck position, inventory and surroundings before continuing');this.longRequested=true;this.longRetryAt=0;this.plan={goal:'Inspect current surroundings while reviewing intentions',preferred:'look'};this.medium={summary:'Review intentions',steps:[],activeStep:0};this.planVersion++;this.supervisorUrgent=true;
  }
  this.previouslyDead=dead;this.lastLifeKey=key;this.lastReady=s.ready;if(s.ready&&!dead)this.lastAlive=structuredClone(s);
 }
 private reconcileRecovery(s:Snapshot){
  if(this.options.recovery?.observe(s)){this.longRequested=true;this.requestPlan('recovery_outcome_changed');this.log('recovery_outcome',{recovery:this.options.recovery.context()});}
  s.recovery=this.options.recovery?.view();
 }
 private refreshLong(s:Snapshot,now:number){
  if(!this.brain.reviewGoals||this.longPending||!s.ready||s.health<=0||now<this.longRetryAt)return;
  // New addressed messages need a goal decision now, independent of the periodic review interval.
  const undecided=this.brain.communicate?this.undecidedMessages():[];if(undecided.length)this.longRequested=true;
  if(!this.longRequested&&now-this.longLast<(this.options.longPlanMs??180000))return;
  if(!this.options.goals?.needsReview&&!undecided.length&&now-this.longLast<30000)return;
  this.longPending=true;this.longRequested=false;this.longLast=now;
  const recoveryVersion=this.options.recovery!.outcomeVersion();
  const generation=this.longGeneration,context=this.planning;context.goalReview=this.options.goals!.review(s,this.userGoal);const facts=reviewFacts(this.options.goals!,this.options.recovery,s);if(facts)context.goalReview.reviewFacts=facts;if(undecided.length){context.goalReview.messagesToDecide=undecided.map(m=>({id:m.id,speaker:m.speaker,text:m.text,at:m.at}));context.goalReview.self=this.options.social?.self;}
  void this.brain.reviewGoals(s,context,this.lifetime.signal).then(p=>{
   if(this.closed||generation!==this.longGeneration||!this.world.snapshot().ready)return;
   this.reconcileRecovery(this.world.snapshot());if(recoveryVersion!==this.options.recovery!.outcomeVersion()){this.longRequested=true;this.log('plan_discarded',{reason:'recovery outcome changed'});return;}
   if(p.recoveryDecision){const d=p.recoveryDecision;if(!this.options.recovery!.context().deaths.some(x=>x.id===d.deathId)||!['recover','prepare','defer','abandon','resolved'].includes(d.strategy)||!d.reason?.trim()||d.reason.length>500)throw Error('Invalid recovery intention: use a supplied deathId and a reason of 1-500 characters; omit recoveryDecision if there are no deaths');const outcome=this.options.recovery!.context().deaths.find(x=>x.id===d.deathId)?.outcome;if((d.strategy==='resolved')!==(outcome?.status==='supplies_restored'))throw Error('Invalid recovery outcome intention');}
   if(this.stalledGoalId){const stalled=this.stalledGoalId,keeps=(p.activeGoalId===undefined?this.options.goals!.snapshot().activeGoal?.id:p.activeGoalId)===stalled&&!(p.goalUpdates??[]).some(g=>g.id===stalled&&g.status!=='active');
    if(keeps)throw Error(`Invalid goal review: goal ${stalled} stalled without progress; pause or abandon it and choose a different active goal`);}
   this.options.goals!.apply(context.goalReview!,p.goalUpdates,p.activeGoalId);
   if(this.stalledGoalId&&this.options.goals!.snapshot().activeGoal?.id!==this.stalledGoalId){this.log('stalled_goal_replaced',{stalled:this.stalledGoalId,next:this.options.goals!.snapshot().activeGoal?.id});this.stalledGoalId=undefined;}
   if(p.recoveryDecision){const d=p.recoveryDecision;this.options.recovery!.decide(d.deathId,d.strategy,d.reason);}
   for(const d of p.messageDecisions??[]){this.messageDecisions.set(d.messageId,{...d,at:Date.now()});try{this.options.social?.route(d.messageId,d.decision==='not_for_me'?'other':'respond');if(d.decision==='keep_advice')this.options.social?.keepAdvice(d.messageId,d.reason);}catch{}}
   for(const id of [...this.messageDecisions.keys()].slice(0,Math.max(0,this.messageDecisions.size-64)))this.messageDecisions.delete(id);
   if(p.userRequestStatus&&context.userRequest&&context.userRequest===this.assignedGoal)this.requestStatus={request:context.userRequest,...p.userRequestStatus,assessedAt:Date.now()};
   const next=this.options.goals!.snapshot().activeGoal?.description??null;
   if(next!==this.longGoal){
    this.longGoal=next;
    // An explicit-request startup plan is provisional work, not a long-goal decision.
    // Preserve it across the concurrent first review; ask the LLM to reconcile it.
    if(this.explicitStartupGeneration===generation&&context.userRequest===this.assignedGoal){this.plan={...this.plan,longTermGoal:next??undefined};this.log('medium_preserved_after_initial_goal_review');}
    else {this.acceptedPlanBasis=undefined;this.plan={goal:next?'No task plan yet: the task layer is planning steps for the new goal (see goal)':'No active goal; long-term review must choose one',preferred:'idle',threatResponse:this.plan.threatResponse};this.lastPlan=0;this.retryAfter=0;this.mediumChain++;this.medium={summary:'Create medium plan under revised intention',steps:[],activeStep:0};this.planVersion++;}
    this.supervisorUrgent=true;
   }
   this.explicitStartupGeneration=-1;
   this.longValidationFailures=0;this.longPlannerFeedback=undefined;this.requestPlan('long_goal_reviewed');this.log('goals_reviewed',{goals:this.options.goals!.snapshot(),userRequestStatus:this.requestStatus,messageDecisions:p.messageDecisions,recovery:p.recoveryDecision});
  }).catch(error=>{if(!this.closed&&generation===this.longGeneration){
   const reason=error instanceof Error&&/^(Invalid |Missing )/.test(error.message)?error.message.slice(0,240):'Long-term review failed';
   if(reason.startsWith('Invalid ')||reason.startsWith('Missing ')){this.longValidationFailures++;if(this.longValidationFailures>=3)this.log('goal_validation_stalled',{consecutive:this.longValidationFailures,reason});}
   this.longPlannerFeedback=reason;this.longRequested=true;this.longRetryAt=Date.now()+10000;this.log('long_planner_error',{reason});
  }}).finally(()=>{this.longPending=false;});
 }
 // A goal that stays active without progress is forced to change: in CONT1 both bots kept one goal for 40 min
 // (closing one shelter cell; waiting for a promised log) and crafted nothing. Progress = a successful craft or an
 // item type not carried in the current life before.
 private taskContinues={id:'' as string|undefined,count:0,since:0};
 private goalSince?:{id:string;at:number};private lastProgressAt=Date.now();private seenItems=new Set<string>();private stalledGoalId?:string;
 private noteProgress(action:string,outcome:string,before:Snapshot,after:Snapshot){
  const had=new Set((before.inventory??[]).map(i=>i.name));for(const i of before.inventory??[])this.seenItems.add(i.name);
  const gained=(after.inventory??[]).map(i=>i.name).filter(n=>!had.has(n)&&!this.seenItems.has(n));
  const placed=action==='place_block'&&outcome==='succeeded'&&!!this.lastPlacedCell(after);
  if(action==='craft'&&outcome==='succeeded'||gained.length||placed){this.lastProgressAt=Date.now();for(const n of gained)this.seenItems.add(n);}
 }
 // A placement counts once per cell; refilling the same cell is not progress.
 private placedCells=new Set<string>();
 private lastPlacedCell(after:Snapshot){const b=after.ownPlacedBlocks?.at(-1);if(!b)return undefined;const k=`${b.position.x},${b.position.y},${b.position.z}`;if(this.placedCells.has(k))return undefined;this.placedCells.add(k);return k;}
 private checkGoalStall(now:number){
  const goals=this.options.goals;if(!goals||goals.needsReview)return;
  const active=goals.snapshot().activeGoal;if(!active){this.goalSince=undefined;return;}
  if(this.goalSince?.id!==active.id){this.goalSince={id:active.id,at:now};return;}
  if(this.stalledGoalId===active.id||now-this.goalSince.at<GOAL_STALL_MS||now-this.lastProgressAt<GOAL_STALL_MS)return;
  const minutes=(ms:number)=>Math.round(ms/60000);
  this.stalledGoalId=active.id;
  goals.requireReview('stalled',`Goal ${active.id} has been active ${minutes(now-this.goalSince.at)} min with no successful craft, newly obtained item type or new placement for ${minutes(now-this.lastProgressAt)} min`);
  this.longRequested=true;this.log('goal_stalled',{goalId:active.id,activeMinutes:minutes(now-this.goalSince.at),minutesSinceProgress:minutes(now-this.lastProgressAt)});
 }
 private explicitStartupGeneration=-1;
 private refreshMedium(s:Snapshot,now:number){
  const trigger=this.options.goals?.reviewState.trigger,startup=!!this.assignedGoal&&!!this.options.goals?.needsReview&&(trigger==='startup'||trigger==='operator_request_changed')&&!this.plan.intent&&!this.medium.steps.length;
  if(this.planPending||!s.ready||s.health<=0||(!startup&&(!this.longGoal||this.options.goals?.needsReview))||now<this.retryAfter)return;
  const remaining=this.medium.steps.slice(this.medium.activeStep),tail=remaining.at(-1)?.id;
  const tailKey=`${this.mediumChain}:${tail}`;
  const append=remaining.length>0&&remaining.length<=2&&this.actionPending&&!['idle','look'].includes(this.activeAction!)&&[...this.reasons].every(reason=>reason==='selector requested review')&&this.prefetchAttemptedTail!==tailKey&&now-this.lastPrefetch>=5000;
  if(!append&&(now-this.lastPlan<5000||!this.reasons.size&&now-this.lastPlan<this.options.planMs))return;
  this.planPending=true;this.lastPlan=now;
  const reviewRequest=this.reviewLifecycle.begin(this.reviewLifecycle.basis(this.planVersion,this.reviewLifecycle.observe(s)),[...this.reasons],now);
  let reviewStatus:ReviewReceipt['status']='discarded';
  const recoveryVersion=this.options.recovery!.outcomeVersion(),generation=this.longGeneration,goal=this.longGoal,chain=this.mediumChain,epoch=this.continuationEpoch,context=this.planning;
  const basis=capturePlanBasis(s,context,now);context.observedAt=now;
  delete context.goalReview;this.reasons.clear();
  if(startup){this.explicitStartupGeneration=generation;context.mediumStartup={source:'explicit_user_request',goalReviewPending:true};this.log('medium_startup_parallel',{source:'explicit_user_request',generation});}
  if(append){this.lastPrefetch=now;this.prefetchAttemptedTail=tailKey;context.mediumRequest={mode:'append',remainingSteps:structuredClone(remaining),activeAction:this.activeAction??null};this.log('plan_prefetch_started',{chain,remaining:remaining.length});}
  void this.brain.plan(s,this.history.slice(-8),this.lifetime.signal,this.userGoal,context).then(p=>{
   if(this.closed||generation!==this.longGeneration||(!startup&&goal!==this.longGoal)||context.userRequest!==this.assignedGoal)return;
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
   if(context.workIntent?.taskId){
    if(this.plan.intent?.taskId!==context.workIntent.taskId){this.requestPlan('task_changed_during_review');this.log('plan_discarded',{reason:'task changed during review'});return;}
    validateTaskReview(p.taskReview,context);
    // Repeated 'continue' on one task with no progress since it started is rejected after a few reviews, so the task
    // changes within a minute or two instead of looping (CONT1: one wall cell for 30 minutes).
    if(p.taskReview?.status==='continue'){
     const id=context.workIntent.taskId;this.taskContinues=this.taskContinues.id===id?{...this.taskContinues,count:this.taskContinues.count+1}:{id,count:1,since:Date.now()};
     if(this.taskContinues.count>=TASK_CONTINUE_LIMIT&&this.lastProgressAt<this.taskContinues.since)throw Error(`Invalid taskReview.status: task ${id} was continued ${this.taskContinues.count} times with no progress (no craft, new item type or new placement since it started); choose replaced or deferred with different work`);
    }else this.taskContinues={id:'',count:0,since:0};
   }
   if(p.procedure){if(this.options.workflowMode!=='procedural')throw Error('Invalid procedure: direct mode');p.procedure=parseProcedure(p.procedure);}
   if(p.intent){p.intent=bindWorkIntent(p.intent,context.workIntent,p.taskReview);if(p.intent.continuationNote)this.log('task_continuation_not_applied',{taskId:p.intent.taskId,note:p.intent.continuationNote});}
   this.importantPlaces.observe(this.world.snapshot());
   const placeReceipt=this.importantPlaces.apply(p.placeUpdates,s.placeEvidence??[]);if(placeReceipt)this.log('place_memory_receipt',{receipt:placeReceipt});delete p.placeUpdates;
   if(p.taskReview&&context.workIntent){
    const receipt={...p.taskReview,at:Date.now(),planVersion:reviewRequest.planVersion,description:context.workIntent.description};
    this.taskReviews=[...this.taskReviews,receipt].slice(-8);this.log('task_review',{receipt});
   }
   // Only replace intentions. An ongoing executor retains its immutable plan until JEV changes it.
   this.mediumChain++;this.prefetchAttemptedTail=undefined;
   this.acceptedPlanBasis={...basis,appliedAt:Date.now()};
   // The threat policy stays in force until the task layer returns a new one.
   const basisNow=threatBasis(this.world.snapshot(),this.allGuides()),changed=basisChanges(this.threatPolicyBasis,basisNow);
   let threatResponse=this.plan.threatResponse;
   if(p.threatResponse&&(!threatResponse||changed.length)){threatResponse=p.threatResponse;this.threatPolicyBasis=basisNow;this.log('threat_policy_applied',{changed});}
   else if(p.threatResponse)this.log('threat_policy_kept',{reason:'gear, health band, day phase, guidance and life unchanged'});
   this.plan={...p,threatResponse,longTermGoal:this.longGoal??undefined};delete this.plan.goalUpdates;delete this.plan.activeGoalId;
   this.medium={summary:p.goal,steps:structuredClone(p.steps??[]),activeStep:0};this.planVersion++;if(this.medium.steps.length)this.activateStep();
   this.plannerFeedback=undefined;reviewStatus='applied';this.reviewLifecycle.finish(reviewRequest,reviewStatus,Date.now(),this.planVersion);this.supervisorUrgent=true;this.log('plan',{plan:this.plan,scope:'medium',review:this.reviewLifecycle.state(this.planVersion,[...this.reasons],Date.now())});
   this.latestSnapshot=this.world.snapshot();const freshness=this.currentPlanFreshness();
   if(freshness&&(freshness.inventoryChanges.length||freshness.procedureChanged)){this.requestPlan('execution_evidence_changed_during_plan');this.log('plan_evidence_changed',{freshness});}
  }).catch(error=>{reviewStatus='failed';if(!this.closed&&generation===this.longGeneration){const reason=error instanceof Error&&/^(Invalid |Missing )/.test(error.message)?error.message.slice(0,240):'Medium plan failed';this.plannerFeedback=reason;this.requestPlan('medium_plan_error');this.retryAfter=Date.now()+10000;this.log('planner_error',{reason});}}).finally(()=>{this.reviewLifecycle.finish(reviewRequest,reviewStatus,Date.now(),reviewStatus==='applied'?this.planVersion:undefined);this.planPending=false;});
 }
 private socialFeedback?:string;
 private socialRetryAt=0;
 private socialFailures=0;
 private async converseQueued(s:Snapshot,now:number){
  const social=this.options.social;if(!social||!this.brain.communicate||this.socialPending||!social.canSpeak(now)||now<this.socialRetryAt)return;
  // The goal layer routes and decides messages first; after a bounded wait, reply without committing.
  if(this.brain.reviewGoals){const pending=this.undecidedMessages();if(pending.some(m=>now-m.at<MESSAGE_DECISION_WAIT_MS))return;for(const m of pending)try{social.route(m.id,'respond');}catch{}}
  const inbox=social.addressed(),newWork=this.journal.recent.at(-1)?.id??0;
  if(this.brain.reviewGoals&&inbox.some(m=>!this.messageDecisions.has(m.id)&&now-m.at<MESSAGE_DECISION_WAIT_MS))return;
  const key=JSON.stringify([inbox.map(m=>m.id),newWork,s.nearbyPlayers?.map(p=>p.name)]);
  if(!inbox.length&&(now-this.lastSocial<(this.options.socialMs??30000)||key===this.lastSocialKey||(!s.nearbyPlayers?.length&&!s.onlinePlayers?.length&&!social.context().heard.some(m=>m.speaker!==social.context().self&&now-m.at<300000))))return;
  if(inbox.length&&now-this.lastSocial<1500)return;
  this.socialPending=true;this.lastSocial=now;this.lastSocialKey=key;
  const life=this.longGeneration,ids=inbox.map(m=>m.id),original=compact(s),action=this.activeAction;
  try{
   const speech=await this.brain.communicate({...s,social:social.context()},this.plan,this.lifetime.signal,{activeAction:action??null,planPending:this.planPending,feedback:this.socialFeedback,...(this.deliveries.view()?{deliveries:this.deliveries.view()}:{}),...(this.recentPlacements().length?{placements:this.recentPlacements()}:{}),...(inbox.length?{goalDecisions:inbox.map(m=>{const d=this.messageDecisions.get(m.id);return d?{messageId:m.id,decision:d.decision,reason:d.reason}:{messageId:m.id,decision:'undecided'};})}:{})});
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
   const decided=speech.replyTo?this.messageDecisions.get(speech.replyTo):undefined,committed=speech.kind==='accept'||speech.promise?.status==='accepted';
   if(speech.replyTo&&committed&&decided?.decision!=='accept'&&this.brain.reviewGoals||speech.kind==='decline'&&decided?.decision==='accept'){this.socialFeedback=`Invalid reply: goal layer decision for ${speech.replyTo} is ${decided?.decision??'undecided'}; the reply must follow it`;this.log('social_discarded',{reason:'reply contradicts goal decision',replyTo:speech.replyTo,decision:decided?.decision??'undecided',kind:speech.kind});return;}
   if(speech.aliases?.length)social.rememberAliases(speech.aliases);
   const result=social.send(speech,t=>this.world.chat(t),Date.now(),JSON.stringify([original.inventory,original.health,original.food]));
   if(result.sent){social.handled(speech.replyTo?[speech.replyTo]:[]);if(speech.promise||['accept','decline'].includes(speech.kind)){this.requestPlan('conversation commitment');if(!decided)this.longRequested=true;}}
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
  // A hostile within 24 blocks that the prepared threat response does not cover asks the task layer to prepare one;
  // JEV keeps deciding meanwhile.
  const near=(s.enemies??[]).filter(e=>e.distance<=24).map(e=>e.kind),missing=uncovered(this.plan.threatResponse,near).sort().join(',');
  if(missing&&now-this.threatPlanRequestedAt>30000&&(missing!==this.threatPlanRequested||now-this.threatPlanRequestedAt>60000)){this.threatPlanRequested=missing;this.threatPlanRequestedAt=now;this.requestPlan('hostile_without_prepared_response');this.log('threat_plan_requested',{uncovered:missing});}
  this.healthBefore=s.health;
  this.deliveries.observe(s,this.options.social?.context().heard??[]);
  this.checkGoalStall(now);
  this.refreshLong(s,now);this.refreshMedium(s,now);void this.reflectMemory();void this.converseQueued(s,now);
  if(!this.actionPending)this.checkStep(s);
  if(this.decisionPending||!this.supervisorUrgent&&now-this.supervisorAt<(this.options.selectorMs??1000))return;
  this.supervisorUrgent=false;this.supervisorAt=now;this.decisionPending=true;
  const life=this.longGeneration,execId=this.executionId,started=Date.now(),requestId=++this.supervisorSequence;
  const reviewBasis=this.reviewLifecycle.basis(this.planVersion,this.reviewLifecycle.observe(s));
  const options=this.brain.parameterSelection?[]:executionOptions(s,this.plan).filter(o=>!this.retries.blocked(o.action,o.plan,s)&&(o.action!=='look'||now-this.lastLookAt>=2000));
  const inbox=this.brain.reviewGoals?[]:this.options.social?.pendingRouting(now)??[];
  this.procedureOfferStatus=this.inspectProcedure(s);
  const rejectKey=JSON.stringify([this.plan.procedure,this.procedureOfferStatus]);
  if(this.plan.procedure&&!this.procedureOfferStatus.available&&this.procedureOfferStatus.reason?.startsWith('Already accepted')!==true&&rejectKey!==this.lastProcedureRejection){
    this.lastProcedureRejection=rejectKey;this.requestPlan('procedure_offer_requires_revision');
    this.log('procedure_offer_rejected',{...this.procedureOfferStatus,definition:this.plan.procedure});
  }
  const goalReview=this.options.goals?reviewFacts(this.options.goals,this.options.recovery,s):undefined;
  const input:SupervisorInput={planFreshness:this.currentPlanFreshness(s),userRequest:this.assignedGoal,...(goalReview?{goalReview}:{}),...(this.requestStatus?{userRequestStatus:this.requestStatus}:{}),...(this.deliveries.view()?{deliveries:this.deliveries.view()}:{}),requestDecisions:this.requestDecisionView(),includeDialogue:!this.brain.reviewGoals,procedureOfferStatus:this.procedureOfferStatus,procedure:this.procedureRunner?.view(),procedureAvailable:this.procedureOfferStatus.available,placeMemoryReview:this.importantPlaces.review(),executionEvidence:executionEvidence(this.journal.recent),planningState:this.reviewLifecycle.state(this.planVersion,[...this.reasons],now),selectionFeedbackStatus:this.reviewLifecycle.feedbackStatus(),parameterSelection:this.brain.parameterSelection,selectionFeedback:this.selectionFeedback,blockedInteractions:this.planning.blockedInteractions,options,execution:this.actionPending?{id:execId,action:this.activeAction!,plan:this.executionPlan!,elapsedMs:Date.now()-this.executionStarted,motor:structuredClone(this.world.executionProgress?.()),observedChanges:this.executionObserved?changes(compact(this.executionObserved),compact(s)):undefined,interruptionNote:this.activeAction==='mine'?'Interrupting mining can lose accumulated digging progress':['place_block','place_table'].includes(this.activeAction!)?'Cancellation stops remaining control but cannot undo a placement already applied by the server. Use motor phase and subsequent placement receipt to distinguish preparation, request, and confirmation.':'Switching cancels the current local execution'}:null,inbox,goal:this.longGoal??(goalReview?STARTUP_ORIENTATION:null),plan:this.plan,progress,recentOutcome:this.journal.recent.at(-1),recentLookResults:this.journal.recent.filter(r=>r.decision.action==='look').slice(-6).map(r=>({id:r.id,endedAt:r.endedAt,outcome:r.outcome,requested:r.executionPlan?.look,view:r.changes.view})),recentResults:this.journal.recent.filter(r=>!['idle','look'].includes(r.decision.action)).slice(-4).map(r=>({id:r.id,interruption:r.interruption,endedAt:r.endedAt,action:r.decision.action,outcome:r.outcome,target:r.executionPlan?.targetEntityId??r.executionPlan?.destination,navigation:r.navigation,result:r.result.slice(0,400),changes:r.changes})),recovery:s.recovery};
  this.log('supervisor_request',{requestId,executionId:execId,observedAt:started,executionRunning:!!input.execution});
  try{
   const d=await this.brain.supervise!(s,input,this.lifetime.signal);
   this.log('supervisor_response',{requestId,executionId:execId,elapsedMs:Date.now()-started,executionRunning:this.actionPending,choice:d.choice,review:d.review,selectionControl:d.selectionControl});
   if(this.closed||life!==this.longGeneration)return;
   // Routing belongs to message IDs, not movement state. Preserve new arrivals in the queue.
   for(const m of inbox)if(d.routes[m.id])this.options.social?.route(m.id,d.routes[m.id]);
   const fresh=this.world.snapshot();fresh.importantPlaces=this.importantPlaces.snapshot();
   if(!fresh.ready||fresh.health<=0||Date.now()-started>(this.options.decisionTtlMs??(this.brain.parameterSelection?30000:5000))||execId!==this.executionId){this.log('decision_discarded');return;}
   // A threat change makes ordinary decisions stale, but not a response to the threat itself: under attack health
   // falls during every ~1.5 s decision, and discarding attack/flee then left the bot unable to act at all.
   // Target presence is still checked by candidates() below.
   const chosen=d.selected?.action??options.find(o=>o.id===d.choice)?.action??(d.choice==='stop'?'stop':d.choice==='continue'?'continue':undefined);
   const threatResponse=['attack','flee','eat','equip','stop'].includes(chosen??'')||chosen==='continue'&&['attack','flee'].includes(this.activeAction??'');
   const enemyIds=(e?:{id:number}[])=>JSON.stringify((e??[]).map(x=>x.id).sort((a,b)=>a-b));
   if(!threatResponse&&(fresh.health<s.health||enemyIds(fresh.enemies)!==enemyIds(s.enemies))){this.supervisorUrgent=true;this.log('decision_discarded',{reason:'threat changed',selectedAction:chosen});return;}
   // Keep failures that occurred after an in-flight planner's evidence snapshot.
   if(d.choice==='unresolved'&&d.reason!=='Model requested planning'&&(d.attempt||!this.selectionFeedback))this.rememberSelectionFeedback(JSON.stringify({kind:'unexecuted_selector_decision',reason:d.reason,...(d.attempt?{attempt:d.attempt}:{}),at:Date.now(),note:'No action executed. This is a model selection outcome, not proof that the skill or target is physically impossible.'}),reviewBasis);
   if(d.review==='long')this.longRequested=true;else if(d.review==='medium'){this.requestSelectorReview({...reviewBasis,feedbackVersion:this.reviewLifecycle.basis(this.planVersion).feedbackVersion});if(!this.longGoal)this.longRequested=true;}
   if(d.choice==='resume_procedure'){
    const runner=this.procedureRunner;
    if(this.options.workflowMode!=='procedural'||!input.procedure?.resumeAvailable||!runner||runner.view().id!==input.procedure.id||!runner.view().resumeAvailable){this.log('decision_discarded',{reason:'procedure resume unavailable or changed'});return;}
    if(this.actionPending&&input.execution?.motor?.phase!==this.world.executionProgress?.()?.phase){this.supervisorUrgent=true;this.log('decision_discarded',{reason:'execution phase changed before procedure resume'});return;}
    this.abortBySupervisor(d.choice,requestId,execId);if(this.actionPending)this.world.stop();await this.executionTask;
    if(this.closed||life!==this.longGeneration||runner!==this.procedureRunner||!runner.resume(this.world.snapshot()))return;
    this.log('procedure_resumed',{source:'jev',confidence:d.confidence,procedure:runner.view()});this.pumpProcedure();return;
   }
   if(d.choice==='procedure'){
    if(!input.procedureAvailable||!input.plan?.procedure||this.plan!==input.plan||!this.inspectProcedure(fresh).available){this.log('decision_discarded',{reason:'procedure offer changed or unavailable'});return;}
    if(this.actionPending&&input.execution?.motor?.phase!==this.world.executionProgress?.()?.phase){this.supervisorUrgent=true;this.log('decision_discarded',{reason:'execution phase changed before procedure replacement'});return;}
    const accepted=structuredClone(input.plan);parseProcedure(accepted.procedure);
    this.suspendProcedure('JEV selected a replacement procedure');
    this.abortBySupervisor(d.choice,requestId,execId);if(this.actionPending)this.world.stop();await this.executionTask;
    if(this.closed||life!==this.longGeneration||this.plan!==input.plan||!this.world.snapshot().ready||this.world.snapshot().health<=0)return;
    this.procedureRunner=new ProcedureRunner(accepted,accepted.procedure!);
    this.log('procedure_started',{source:'jev',confidence:d.confidence,procedure:this.procedureRunner.view()});
    this.pumpProcedure();return;
   }
   if(d.choice==='continue'&&!this.actionPending&&this.procedureRunner?.view().status!=='running'){this.pendingSwitch=undefined;this.supervisorUrgent=true;this.log('decision_discarded',{requestId,executionId:execId,reason:'execution already finished'});return;}
   if(d.choice==='continue'){this.pendingSwitch=undefined;this.lastSelection={action:'continue',at:Date.now()};this.log('execution_continue',{executionId:execId});return;}
   if(d.choice==='unresolved'){this.log('parameter_selection_unresolved',{requestId,reason:d.reason,attempt:d.attempt});if(d.attempt?.action&&/withdrew/.test(d.reason??''))this.stuck.recordWithdrawal(d.attempt.action,d.attempt.offeredArguments);return;}
   if(d.choice==='stop'){
    if(!this.actionPending&&this.procedureRunner?.view().status==='running'){this.suspendProcedure('JEV stopped procedure');return;}
    if(!input.execution||!this.actionPending){this.supervisorUrgent=true;this.log('decision_discarded',{requestId,reason:'execution already finished'});return;}
    const phase=this.world.executionProgress?.()?.phase;
    if(input.execution.motor?.phase!==phase){this.supervisorUrgent=true;this.log('decision_discarded',{requestId,reason:'execution phase changed',requestedPhase:input.execution.motor?.phase,currentPhase:phase});return;}
    this.suspendProcedure('JEV stopped procedure');this.pendingSwitch=undefined;this.log('execution_stop',{requestId,executionId:execId});this.abortBySupervisor('stop',requestId,execId);this.world.stop();await this.executionTask;this.supervisorUrgent=true;return;
   }
   const selected=d.selected??options.find(o=>o.id===d.choice);
   if(d.choice==='wait'||selected?.action==='idle'){this.supervisorUrgent=true;this.log('decision_discarded',{requestId,reason:'intentional idle is not a selectable action'});return;}
   if(!selected||!candidates(fresh,selected.plan).includes(selected.action)){const reason=selected?.action==='move'&&selected.plan.destination&&moveReached(fresh.position,selected.plan.destination)?'Selected destination is already within arrival radius 2; no movement would occur':'Selected arguments do not pass current physical/observation validation';this.rememberSelectionFeedback(JSON.stringify({kind:'unexecuted_selector_decision',reason,selected: selected?{action:selected.action,plan:selected.plan}:null,currentPosition:fresh.position,at:Date.now()}),reviewBasis);this.log('decision_discarded',{requestId,reason:'selected arguments no longer executable',detail:reason,selectedAction:selected?.action});this.supervisorUrgent=true;return;}
   if(this.actionPending&&this.activeAction===selected.action&&executionIdentity(this.activeAction!,this.executionPlan!)===executionIdentity(selected.action,selected.plan)){this.suspendProcedure('JEV selected an individual action instead of the procedure');this.pendingSwitch=undefined;return;}
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
   this.suspendProcedure('JEV selected a different action');this.pendingSwitch=undefined;
   if(this.actionPending){this.log('execution_switch',{from:this.activeAction,to:selected.action,choice:d.choice,elapsedMs:Date.now()-this.executionStarted,fromIdentity:executionIdentity(this.activeAction!,this.executionPlan!),toIdentity:executionIdentity(selected.action,selected.plan)});this.abortBySupervisor(selected.action,requestId,execId);this.world.stop();await this.executionTask;}
   if(this.closed||life!==this.longGeneration||!candidates(this.world.snapshot(),selected.plan).includes(selected.action))return;
   this.reviewLifecycle.actionStarted(Date.now());this.selectionFeedback=undefined;this.lastSelection={action:selected.action,at:Date.now()};this.log('decision',{action:selected.action,confidence:d.confidence,control:'start_or_switch'});
   this.executionId++;this.executionIntention=this.longGoal;this.executionStarted=Date.now();this.executionPlan=structuredClone(selected.plan);this.executionObserved=structuredClone(fresh);
   this.executionTask=this.run({action:selected.action,confidence:d.confidence},this.brain.parameterSelection?actions:options.map(o=>o.action),'selector',s,selected.plan).then(()=>{});
   void this.executionTask.catch(()=>this.log('execution_error'));
  }catch(error){if(!this.closed)this.log('decision_error',{requestId,executionId:execId,elapsedMs:Date.now()-started,...safeDecisionError(error)});}finally{this.decisionPending=false;}
 }
 close(drainModels=false){this.suspendProcedure('Runtime closed',false);this.importantPlaces.flush(true);this.closed=true;this.epoch++;if(!drainModels)this.lifetime.abort();this.actionController?.abort();this.world.stop();this.world.close();}
}
