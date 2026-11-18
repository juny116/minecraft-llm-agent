import {randomUUID} from 'node:crypto';
import type {WorkIntent} from './types.js';
import type {Snapshot} from './types.js';
import type {PlanningContext} from './planning.js';
export type TaskReview={taskId?:string;criteriaEvidence?:{criterionId:string;status:'satisfied'|'unresolved';evidenceIds:string[];explanation:string}[];status:'continue'|'completed'|'deferred'|'replaced';reason:string;evidenceIds:string[];remaining:string};
export type TaskReviewReceipt=TaskReview & {at:number;planVersion:number;description:string};
// These are references to supplied evidence, not automatic completion predicates.
export function taskReviewContract(c?:PlanningContext,s?:Pick<Snapshot,'containers'>,asOf?:number){
 return {required:!!c?.workIntent,taskId:c?.workIntent?.taskId,completionCriteria:c?.workIntent?.completionCriteria,actionProvenance:(c?.recentActions??[]).map(r=>({evidenceId:`action:${r.id}`,taskId:r.executionPlan?.intent?.taskId??null,outcome:r.outcome,meaning:'Task at execution start, not automatic proof of relevance or completion'})),evidenceTiming:{asOf,activeAction:c?.activeExecution?{action:c.activeExecution.action,status:'running_not_completed'}:null,containerObservations:(s?.containers??[]).map(x=>({position:x.position,contentsObservedAt:x.observedAt,...(asOf===undefined?{}:{ageMs:Math.max(0,asOf-x.observedAt)}),source:'cached_contents_from_last_container_interaction_not_refreshed_by_panorama'}))},allowedEvidenceIds:['current_observation',...(c?.recentActions??[]).map(r=>`action:${r.id}`),...(c?.placeMemoryReview?.recent??[]).map(r=>`annotation:${r.at}`)],meaning:'Review the previous workIntent, not the new intent. References identify supplied sources, not proof that their contents imply completion. current_observation is this request only; annotations prove bookkeeping, not physical work.'};
}
export function validateTaskReview(raw:unknown,c?:PlanningContext):TaskReview|undefined{
 const contract=taskReviewContract(c),v=raw as TaskReview|undefined;
 if(!v){if(contract.required)throw Error('Invalid taskReview: review the previous workIntent');return;}
 // With no previous task there is nothing to review; a volunteered review is dropped, not a planning failure (FREE3: 91 rejections).
 if(!contract.required)return;
 // Citations outside the supplied references are removed rather than failing the whole plan (FREE3: 87 rejections),
 // as message decisions already do; a review left with no supplied reference still fails.
 if(Array.isArray(v.evidenceIds)){const kept=v.evidenceIds.filter(id=>contract.allowedEvidenceIds.includes(id));if(kept.length<v.evidenceIds.length)(v as TaskReview&{ignoredEvidenceIds?:string[]}).ignoredEvidenceIds=v.evidenceIds.filter(id=>!kept.includes(id));v.evidenceIds=kept.slice(0,8);}
 if(!['continue','completed','deferred','replaced'].includes(v.status))throw Error('Invalid taskReview.status: use continue, completed, deferred or replaced');
 if(typeof v.reason!=='string'||!v.reason.trim()||v.reason.length>400)throw Error(`Invalid taskReview.reason: required text of at most 400 characters (received ${typeof v.reason==='string'?v.reason.length:0})`);
 if(typeof v.remaining!=='string'||v.remaining.length>400)throw Error('Invalid taskReview.remaining: text of at most 400 characters, empty only when completed');
 if(!Array.isArray(v.evidenceIds)||!v.evidenceIds.length)throw Error(`Invalid taskReview.evidenceIds: cite 1-8 of the supplied references: ${contract.allowedEvidenceIds.slice(0,12).join(', ')}`);
 if(v.status==='completed'&&v.remaining.trim())throw Error('Invalid taskReview: completed work cannot contain unfinished criteria; use continue or deferred');
 if(v.status==='deferred'&&!v.remaining.trim())throw Error('Invalid taskReview: deferred work must retain the unresolved condition');
 if(c?.workIntent?.taskId){
  if(v.taskId!==c.workIntent.taskId)throw Error('Invalid taskReview.taskId: copy the exact current taskReviewContract.taskId; historical tasks cannot complete current work');
  const expected=c.workIntent.completionCriteria??[],bindings=v.criteriaEvidence;
  if(!Array.isArray(bindings)||bindings.length!==expected.length||new Set(bindings.map(b=>b.criterionId)).size!==expected.length)throw Error('Invalid taskReview.criteriaEvidence: assess each supplied completion criterion exactly once');
  for(const b of bindings){
   if(!expected.some(e=>e.id===b.criterionId)||!['satisfied','unresolved'].includes(b.status)||typeof b.explanation!=='string'||!b.explanation.trim()||b.explanation.length>400||!Array.isArray(b.evidenceIds)||b.evidenceIds.length<1||b.evidenceIds.length>8||b.evidenceIds.some(id=>!contract.allowedEvidenceIds.includes(id)))throw Error('Invalid taskReview.criteriaEvidence: use supplied criterion/evidence IDs and explanation <=400 characters');
   if(v.status==='completed'&&b.status!=='satisfied')throw Error('Invalid taskReview: unresolved criterion cannot complete this task');
  }
 }
 return structuredClone(v);
}

// Continue keeps the task contract: completion criteria and desiredInventory are inherited,
// only the approach changes. Differing outcome fields are not applied and are reported back.
export function continuationDiscrepancy(next:WorkIntent,previous?:WorkIntent,review?:TaskReview){
 if(!previous?.taskId||review?.status!=='continue')return undefined;
 const declared=next.constraints.filter(s=>/^done\s*:/i.test(s)),expected=(previous.completionCriteria??[]).map(c=>c.text);
 const inventory=(i:WorkIntent)=>JSON.stringify([...i.desiredInventory].sort((a,b)=>a.item.localeCompare(b.item)));
 const doneDiffers=declared.length>0&&JSON.stringify(declared)!==JSON.stringify(expected),inventoryDiffers=inventory(next)!==inventory(previous);
 if(!doneDiffers&&!inventoryDiffers)return undefined;
 return {...(doneDiffers?{notAppliedDone:declared}:{}),...(inventoryDiffers?{notAppliedDesiredInventory:next.desiredInventory}:{}),meaning:'Continue inherited the existing completion criteria and desiredInventory. These differing outcome fields were not applied; choose replaced or deferred to change the outcome.'};
}

// Identity is bookkeeping. The model chooses continuation or a new task.
export function bindWorkIntent(next:WorkIntent,previous?:WorkIntent,review?:TaskReview):WorkIntent{
 if(previous?.taskId&&review?.status==='continue'){
  const note=continuationDiscrepancy(next,previous,review),criteria=structuredClone(previous.completionCriteria)??[];
  return {...next,taskId:previous.taskId,completionCriteria:criteria,desiredInventory:structuredClone(previous.desiredInventory),constraints:[...next.constraints.filter(s=>!/^done\s*:/i.test(s)),...criteria.map(c=>c.text)],...(note?{continuationNote:note}:{})};
 }
 const taskId='task_'+randomUUID();
 const declared=next.constraints.filter(s=>/^done\s*:/i.test(s));
 const {continuationNote:_,...fresh}=next;
 return {...fresh,taskId,completionCriteria:(declared.length?declared:[next.description]).map((text,i)=>({id:`${taskId}:criterion:${i+1}`,text}))};
}
