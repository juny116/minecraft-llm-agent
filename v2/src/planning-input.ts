import {actionView} from './action-view.js';
import {candidateFacts} from './selection-facts.js';
import {executionEvidence} from './execution-evidence.js';
import type {PlanningContext} from './planning.js';
// Persisted evidence remains intact. Only duplicate prompt representations are
// compacted; the current observation is already supplied separately as state.
export function planningInput(context?:PlanningContext){
 if(!context)return context;
 const out=structuredClone(context);
 const compactFeedback=(text:string)=>{try{const f=JSON.parse(text);for(const offer of f.attempt?.offeredArguments??[])if(Array.isArray(offer.values)){offer.candidates=candidateFacts(offer.values);delete offer.values;}return JSON.stringify(f);}catch{return text;}};
 if(out.selectorFeedback)out.selectorFeedback=compactFeedback(out.selectorFeedback);
 for(const e of [...out.selectorFeedbackStatus?.history??[],...(out.selectorFeedbackStatus?.current?[out.selectorFeedbackStatus.current]:[])])e.feedback=compactFeedback(e.feedback);
 if(out.goalReview)out.goalReview.evidence=out.goalReview.evidence.map(e=>{
  const d=e.data as any;
  if(e.kind==='observation'&&d){
   // Recovery and own placements are current-state facts supplied once; historical observations would repeat them.
   const {vision,chatEvents,nearbyPlayers,recovery:_recovery,ownPlacedBlocks:_own,...facts}=d;
   const counts:Record<string,number>={};for(const b of vision?.blocks??[])counts[b.name]=(counts[b.name]??0)+1;
   return {...e,data:{...facts,...(e.id===out.goalReview!.observationId?{viewReference:'Current state.spatial (panorama) or state.vision, and state.nearbyPlayers'}:{historicalVisibleBlockCounts:counts,historicalViewIsNotCurrent:true})}};
  }
  if(e.kind==='action'&&d)return {...e,data:actionView(d as any)};
  return e;
 });
 // Evidence is derived from the full records; the model then reads the compact view.
 return {...out,executionEvidence:executionEvidence(out.recentActions??[]),...(out.recentActions?{recentActions:out.recentActions.map(actionView) as any}:{})};
}
