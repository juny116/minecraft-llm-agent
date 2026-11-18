import {RESPAWN_SET_RESULT} from './beds.js';
import {reachedCell} from './reach.js';
import {readPickupResult,type PickupResult} from './pickup.js';
import {readMiningResult,type MiningResult} from './mining.js';
import type { Action, Decision, Plan, Snapshot } from './types.js';
export type Completion = {kind:'action_success'} | {kind:'inventory_at_least';item:string;count:number} | {kind:'food_at_least';value:number} | {kind:'near';position:{x:number;y:number;z:number};radius:number};
export type Step = import('./types.js').Interaction & {id:string;description:string;action:Action;completion:Completion;destination?:Plan['destination'];craft?:Plan['craft'];look?:Plan['look']};
export type Outcome = 'succeeded'|'partial'|'failed'|'cancelled'|'skipped';
export type Observation = ReturnType<typeof compact>;
export type ActionRecord = {interruption?:{source:'supervisor';choice:string;requestId:number;executionId:number;at:number;motor?:import('./types.js').MotorProgress};procedureId?:string;navigation?:import('./execution-evidence.js').NavigationEvidence;executionPlan?:Plan;pickup?:PickupResult;mining?:MiningResult;id:number;startedAt:number;endedAt:number;source:'selector'|'local_safety'|'procedure';selectorKind:string;decision:Decision;decisionObserved:Observation;options:Action[];planVersion:number;goal:string|null;stepId:string|null;before:Observation;after:Observation;changes:ReturnType<typeof changes>&{view?:ReturnType<typeof import('./view-change.js').viewChange>};outcome:Outcome;result:string};
export type PlanningContext = {stuck?:ReturnType<import('./stuck-guard.js').StuckGuard['view']>;threatPolicy?:{current:import('./threat-response.js').ThreatResponse;changedSinceSet:string[];meaning:string};fleeFollowups?:{entries:ReturnType<typeof import('./combat-followup.js').fleeFollowups>;meaning:string};observedAt?:number;planFreshness?:ReturnType<typeof import('./plan-freshness.js').planFreshness>;mediumStartup?:{source:'explicit_user_request';goalReviewPending:boolean};procedureOfferStatus?:import("./procedure.js").ProcedureOfferStatus;procedure?:import("./procedure.js").ProcedureView;taskReviews?:import('./task-review.js').TaskReviewReceipt[];placeMemoryReview?:ReturnType<import("./important-places.js").ImportantPlaces["review"]>;activeExecution?:{id?:number;action:Action;plan:Plan;elapsedMs:number;motor?:import('./types.js').MotorProgress}|null;planningState?:import('./review-lifecycle.js').PlanningState;selectorFeedbackStatus?:import('./review-lifecycle.js').SelectionFeedbackStatus;selectorFeedback?:string;workIntent?:Plan["intent"];mediumRequest?:{mode:"append";remainingSteps:Step[];activeAction:Action|null};progress?:{noProgressMs:number};blockedInteractions?:ReturnType<import('./retry-policy.js').RetryPolicy['context']>;observationStreak?:number;plannerFeedback?:string;longPlannerFeedback?:string;goalReview?:import('./goals.js').GoalReview;goalState?:ReturnType<import('./goals.js').GoalBook['snapshot']>;userRequest?:string|null;userRequestStatus?:import('./types.js').UserRequestStatus;deliveries?:ReturnType<import('./deliveries.js').DeliveryLog['view']>;longTermGoal:string|null;mediumTerm:{summary:string;steps:Step[];activeStep:number};replanReasons:string[];recentActions:ActionRecord[];olderSummary:{count:number;byAction:Partial<Record<Action,{count:number;failed:number;cancelled:number;partial:number;skipped:number}>>;inventoryNet:Record<string,number>;healthNet:number};failureStreak:number};
export function compact(s:Snapshot){
 const inventory:Record<string,number>={};
 for(const i of s.inventory??[])inventory[i.name]=(inventory[i.name]??0)+i.count;
 return {...(s.ownPlacedBlocks?.length?{ownPlacedBlocks:s.ownPlacedBlocks}:{}),sleeping:s.sleeping,timeOfDay:s.timeOfDay,...(s.time?{time:s.time}:{}),animals:structuredClone(s.animals??[]),...(s.lifecycle?{lifeGeneration:s.lifecycle.generation}:{}),...(s.foodAvailable!==undefined?{foodAvailable:s.foodAvailable}:{}),visibleItems:structuredClone(s.visibleItems??[]),rememberedItems:structuredClone(s.rememberedItems??[]),containers:structuredClone(s.containers??[]),incomingDamage:structuredClone(s.incomingDamage??[]),ready:s.ready,health:s.health,food:s.food,logs:s.logs,inventory,position:{...s.position},equipment:structuredClone(s.equipment??[]),enemies:structuredClone(s.enemies??[]),unlockedRecipeCount:s.recipeBook.unlocked.length};
}
export function changes(before:Observation,after:Observation){
 const inventory:Record<string,number>={};
 for(const name of before.ready&&after.ready?new Set([...Object.keys(before.inventory),...Object.keys(after.inventory)]):[]){
  const delta=(after.inventory[name]??0)-(before.inventory[name]??0);if(delta)inventory[name]=delta;
 }
 return {health:after.health-before.health,food:after.food-before.food,logs:before.ready&&after.ready?after.logs-before.logs:0,inventory,position:{from:before.position,to:after.position},newlyUnlocked:[] as string[],newlyUnlockedCount:0,enemiesEntered:after.enemies.filter(e=>!before.enemies.some(old=>old.id===e.id)),enemiesLeft:before.enemies.filter(e=>!after.enemies.some(now=>now.id===e.id))};
}
export function completed(step:Step,s:Snapshot,successfulAction?:Action){
 const c=step.completion;
 if(c.kind==='action_success')return successfulAction===step.action;
 if(c.kind==='food_at_least')return s.food>=c.value;
 if(c.kind==='near')return reachedCell(s.position,c.position,c.radius);
 return (s.inventory??[]).filter(i=>i.name===c.item).reduce((n,i)=>n+i.count,0)>=c.count;
}
export function classify(action:Action,result:string):Outcome {
 if(action==='pickup'){const r=readPickupResult(result);return r?.status==='cancelled'?'cancelled':r?.inventoryGained.some(i=>i.name===r.target?.expected&&i.count>0)?'succeeded':'failed';}
 // A break the held tool cannot harvest yields nothing by game data: not a completed collection.
 if(action==='mine'){const r=readMiningResult(result);return r?.status==='cancelled'?'cancelled':r?.blockBroken?(r.harvest?.heldToolDropsItem===false?'partial':'succeeded'):r?.status==='time_limit'?'partial':'failed';}
 if(action==='sleep'&&result===RESPAWN_SET_RESULT)return 'partial'; // Respawn point set by day, no sleep.
 if(action==='give')return 'partial'; // Dropping near a player alone never proves delivery.
 if(action!=='attack'&&action!=='flee')return 'succeeded';
 try{
  const record=JSON.parse(result),outcome=record.outcome;
  if(outcome==='target_defeated'&&record.ownKillConfirmed===true&&record.targetDeathObserved===true)return 'succeeded';
  if(outcome==='distance_increased')return 'succeeded';
  if(outcome==='no_known_retreat_path'||outcome==='failed'||outcome==='dead')return 'failed';
  if(outcome==='cancelled')return 'cancelled';
  return 'partial'; // A time-limited attack or lost target is never a confirmed kill.
 }catch{return 'partial';}
}
export class Journal {
 private serial=0;
 recent:ActionRecord[]=[];
 older:PlanningContext['olderSummary']={count:0,byAction:{},inventoryNet:{},healthNet:0};
 add(record:Omit<ActionRecord,'id'>){
  const full=structuredClone({...record,id:++this.serial});this.recent.push(full);
  if(this.recent.length>12){
   const old=this.recent.shift()!;this.older.count++;
   const a=this.older.byAction[old.decision.action]??={count:0,failed:0,cancelled:0,partial:0,skipped:0};a.count++;
   if(old.outcome!=='succeeded')a[old.outcome]++;
   for(const [name,delta] of Object.entries(old.changes.inventory))this.older.inventoryNet[name]=(this.older.inventoryNet[name]??0)+delta;
   this.older.healthNet+=old.changes.health;
  }
  return structuredClone(full);
 }
}
