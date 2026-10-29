import {snapshotCombatFacts} from './combat-facts.js';
import {threatView} from './threat-response.js';
import {combatExecutionContract} from './combat.js';
import {procedureSituation,hasOngoingProcedure} from './procedure-supervision.js';
import {actionAvailability,offeredArgumentView,executionTargetObservation} from './selection-facts.js';
import {actionScopes} from './action-domains.js';
import {spatialContext,boundedSpatialContext} from './spatial-context.js';
import type {Snapshot} from './types.js';
import type {SupervisorInput} from './supervision.js';
import {guidebookView} from './experience-memory.js';

// Observation is current; old ordinary terrain belongs to the motor's local map.
// lifecycle.lastDeath is the full latest record, which state.recovery already carries; models get its id only.
const lifecycleView=(l:Snapshot['lifecycle'])=>l&&{...l,lastDeath:l.lastDeath?({id:l.lastDeath.id,at:l.lastDeath.at,detail:'state.recovery'} as any):undefined};
export function currentModelState(s:Snapshot):Snapshot {
 if(s.perception){
  const spatial=s.spatial?boundedSpatialContext(s.spatial):spatialContext(s);
  return {...s,lifecycle:lifecycleView(s.lifecycle),spatial,actionAvailability:s.actionAvailability??actionAvailability(s),actionScopes:s.actionScopes??actionScopes(s),placementSites:undefined,places:[],observedDestinationKeys:undefined,navigationTargets:[],vision:s.vision?{...s.vision,blocks:[]}:undefined,placeEvidence:s.placeEvidence?.filter(e=>Math.hypot(e.position.x-s.position.x,e.position.y-s.position.y,e.position.z-s.position.z)<=12||s.importantPlaces?.some(p=>p.position.x===e.position.x&&p.position.y===e.position.y&&p.position.z===e.position.z))};
 }
 const visible=new Set((s.vision?.blocks??[]).map(b=>`${b.position.x},${b.position.y},${b.position.z}`));
 return {...s,lifecycle:lifecycleView(s.lifecycle),places:[],observedDestinationKeys:undefined,navigationTargets:(s.navigationTargets??[]).filter(p=>visible.has(`${p.x},${p.y},${p.z}`))};
}
export function outcomeView(r:any){
 if(!r)return undefined;
 return {id:r.id,interruption:r.interruption,action:r.decision?.action??r.action,outcome:r.outcome,result:r.result,endedAt:r.endedAt,
  target:r.executionPlan?{entityId:r.executionPlan.targetEntityId,destination:r.executionPlan.destination,mine:r.executionPlan.mine,build:r.executionPlan.build,craft:r.executionPlan.craft}:undefined,
  // mining/pickup are parsed copies of result; send them only when result is absent.
  navigation:r.navigation,changes:r.changes,...(typeof r.result==='string'&&r.result?{}:{mining:r.mining,pickup:r.pickup})};
}
// These are factual execution receipts, never locally inferred experience rules.
export function feedbackView(status:any,fallback?:string,s?:Snapshot){
 const groups=new Map<string,any>();
 const events=[...(status?.history??[]),...(status?.current?[status.current]:[])];
 if(!events.length&&fallback)events.push({feedback:fallback,status:'unreviewed'});
 for(const e of events){
  let f:any;try{f=JSON.parse(e.feedback);}catch{f={reason:e.feedback};}
  const sentence=f.reason??f.note??String(e.feedback),action=f.selected?.action??f.attempt?.action;
  const plan=f.selected?.plan,target=plan?{destination:plan.destination,mine:plan.mine,build:plan.build}:undefined;
  const offeredArguments=f.attempt?.offeredArguments?.map((o:any)=>offeredArgumentView(o,s));
  const boundArguments=f.attempt?.boundArguments;
  // Repeats differ only by moving candidates; keep one entry with the latest offer and a count.
  const key=JSON.stringify([sentence,action,target,e.status,offeredArguments?.map((o:any)=>o.name),boundArguments]);const old=groups.get(key);
  const offerKey=JSON.stringify(offeredArguments);
  if(old){old.count++;old.lastAt=e.at;old.ids.push(e.id);if(old.offerKey!==offerKey){old.distinctOffers++;old.offerKey=offerKey;}old.offeredArguments=offeredArguments;}
  else groups.set(key,{sentence,action,target,offeredArguments,boundArguments,status:e.status,count:1,distinctOffers:1,offerKey,lastAt:e.at,ids:[e.id],reviewedByPlanVersion:e.reviewedByPlanVersion});
 }
 return {currentId:status?.current?.id,entries:[...groups.values()].map(({offerKey:_,...e})=>({...e,offerMeaning:e.distinctOffers>1?`Repeated ${e.count} times over ${e.distinctOffers} different candidate sets; offeredArguments shows only the latest set. Raw receipts keep every set.`:undefined})),total:status?.total??events.length,omittedHistoryCount:status?.omittedHistoryCount??0,meaning:'Factual receipts, not rules; reviewed/action_started does not mean a problem was physically resolved.'};
}
function dialogueView(social:any,inbox:any[]){
 if(!social)return undefined;
 const messages=new Map<string,any>();
 for(const m of [...social.heard??[],...social.evidenceMessages??[],...social.inbox??[],...inbox])messages.set(m.id,{...messages.get(m.id),...m});
 return {self:social.self,messages:[...messages.values()],inboxIds:inbox.map(m=>m.id),promises:social.promises,aliases:social.aliases};
}
export function selectorContext(s:Snapshot,input:SupervisorInput,selection:Record<string,unknown>){
 // Recipe reasoning belongs to the planning layers; JEV gets craftable outputs and planned-output status.
 const {recipeBook,places,placeEvidence,importantPlaces,messages,social,observedDestinationKeys,chatEvents,memoryGuidance,crafting:_crafting,...observation}=currentModelState(s);
 return {observation,planFreshness:input.planFreshness,userRequest:input.userRequest,...(input.userRequestStatus?{userRequestStatus:input.userRequestStatus}:{}),...(input.goalReview?{goalReview:input.goalReview}:{}),...(input.deliveries?{deliveries:input.deliveries}:{}),procedureOfferStatus:input.procedureOfferStatus,procedureSituation:procedureSituation(s,input),procedure:hasOngoingProcedure(input)?input.procedure:undefined,lastProcedure:!hasOngoingProcedure(input)?input.procedure:undefined,procedureOffer:input.procedureAvailable?input.plan?.procedure:undefined,rememberedPlaces:importantPlaces??[],guidance:guidebookView(memoryGuidance??[]),
  placeMemoryReview:input.placeMemoryReview,executionEvidence:input.executionEvidence,execution:input.execution?{...input.execution,combatContract:combatExecutionContract(s,input.execution),targetObservation:executionTargetObservation(s,input.execution)}:input.execution,plan:input.plan?.intent?{goal:input.plan.goal,intent:input.plan.intent}:input.plan?{...input.plan,threatResponse:undefined}:input.plan,threatPlan:threatView(input.plan?.threatResponse,[...new Set((s.enemies??[]).map(e=>e.kind))]),combatFacts:snapshotCombatFacts(s),goal:input.goal,
  recentResults:input.recentResults?.filter((r:any)=>r.id!==(input.recentOutcome as any)?.id),recentOutcome:outcomeView(input.recentOutcome),recentLookResults:input.recentLookResults,
  progress:input.progress,selectionFeedbackStatus:feedbackView(input.selectionFeedbackStatus,input.selectionFeedback,s),planningState:input.planningState,
  blockedInteractions:input.blockedInteractions,dialogue:!social||input.includeDialogue===false?undefined:{...dialogueView(social,input.inbox)!,requestDecisions:input.requestDecisions??[],requestMeaning:'A request in chat becomes work only after the goal layer accepts it; accepted work then appears in goal and plan. pending_goal_decision, decline, defer, no_request and keep_advice are not tasks.'},...selection};
}
