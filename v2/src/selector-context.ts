import {spatialContext} from './spatial-context.js';
import type {Snapshot} from './types.js';
import type {SupervisorInput} from './supervision.js';
import {guidebookView} from './experience-memory.js';

// Observation is current; old ordinary terrain belongs to the motor's local map.
export function currentModelState(s:Snapshot):Snapshot {
 if(s.perception){
  const spatial=s.spatial??spatialContext(s),near=new Set(spatial.near.rows.map(r=>[r[0]+spatial.near.origin.x,r[1]+spatial.near.origin.y,r[2]+spatial.near.origin.z].join(',')));
  return {...s,spatial,places:[],observedDestinationKeys:undefined,navigationTargets:[],vision:s.vision?{...s.vision,blocks:[]}:undefined,placeEvidence:s.placeEvidence?.filter(e=>near.has(`${e.position.x},${e.position.y},${e.position.z}`)||s.importantPlaces?.some(p=>p.position.x===e.position.x&&p.position.y===e.position.y&&p.position.z===e.position.z))};
 }
 const visible=new Set((s.vision?.blocks??[]).map(b=>`${b.position.x},${b.position.y},${b.position.z}`));
 return {...s,places:[],observedDestinationKeys:undefined,navigationTargets:(s.navigationTargets??[]).filter(p=>visible.has(`${p.x},${p.y},${p.z}`))};
}
export function outcomeView(r:any){
 if(!r)return undefined;
 return {id:r.id,action:r.decision?.action??r.action,outcome:r.outcome,result:r.result,endedAt:r.endedAt,
  target:r.executionPlan?{destination:r.executionPlan.destination,mine:r.executionPlan.mine,build:r.executionPlan.build,craft:r.executionPlan.craft}:undefined,
  navigation:r.navigation,changes:r.changes,mining:r.mining,pickup:r.pickup};
}
// These are factual execution receipts, never locally inferred experience rules.
export function feedbackView(status:any,fallback?:string){
 const groups=new Map<string,any>();
 const events=[...(status?.history??[]),...(status?.current?[status.current]:[])];
 if(!events.length&&fallback)events.push({feedback:fallback,status:'unreviewed'});
 for(const e of events){
  let f:any;try{f=JSON.parse(e.feedback);}catch{f={reason:e.feedback};}
  const sentence=f.reason??f.note??String(e.feedback),action=f.selected?.action??f.attempt?.action;
  const plan=f.selected?.plan,target=plan?{destination:plan.destination,mine:plan.mine,build:plan.build}:undefined;
  const key=JSON.stringify([sentence,action,target,e.status]);const old=groups.get(key);
  if(old){old.count++;old.lastAt=e.at;old.ids.push(e.id);}
  else groups.set(key,{sentence,action,target,status:e.status,count:1,lastAt:e.at,ids:[e.id],reviewedByPlanVersion:e.reviewedByPlanVersion});
 }
 return {currentId:status?.current?.id,entries:[...groups.values()],total:status?.total??events.length,omittedHistoryCount:status?.omittedHistoryCount??0,meaning:'Factual receipts, not rules; reviewed/action_started does not mean a problem was physically resolved.'};
}
function dialogueView(social:any,inbox:any[]){
 if(!social)return undefined;
 const messages=new Map<string,any>();
 for(const m of [...social.heard??[],...social.evidenceMessages??[],...social.inbox??[],...inbox])messages.set(m.id,{...messages.get(m.id),...m});
 return {self:social.self,messages:[...messages.values()],inboxIds:inbox.map(m=>m.id),promises:social.promises,aliases:social.aliases};
}
export function selectorContext(s:Snapshot,input:SupervisorInput,selection:Record<string,unknown>){
 const {recipeBook,places,placeEvidence,importantPlaces,messages,social,observedDestinationKeys,chatEvents,memoryGuidance,...observation}=currentModelState(s);
 return {observation,rememberedPlaces:importantPlaces??[],guidance:guidebookView(memoryGuidance??[]),
  placeMemoryReview:input.placeMemoryReview,executionEvidence:input.executionEvidence,execution:input.execution,plan:input.plan?.intent?{goal:input.plan.goal,intent:input.plan.intent}:input.plan,goal:input.goal,
  recentResults:input.recentResults?.filter((r:any)=>r.id!==(input.recentOutcome as any)?.id),recentOutcome:outcomeView(input.recentOutcome),recentLookResults:input.recentLookResults,
  progress:input.progress,selectionFeedbackStatus:feedbackView(input.selectionFeedbackStatus,input.selectionFeedback),planningState:input.planningState,
  blockedInteractions:input.blockedInteractions,dialogue:dialogueView(social,input.inbox),...selection};
}
