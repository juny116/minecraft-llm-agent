import {executionEvidence} from './execution-evidence.js';
import type {PlanningContext} from './planning.js';
// Persisted evidence remains intact. Only duplicate prompt representations are
// compacted; the current observation is already supplied separately as state.
export function planningInput(context?:PlanningContext){
 if(!context)return context;
 const out=structuredClone(context);
 if(out.goalReview)out.goalReview.evidence=out.goalReview.evidence.map(e=>{
  const d=e.data as any;
  if(e.kind==='observation'&&d){
   const {vision,chatEvents,nearbyPlayers,...facts}=d;
   const counts:Record<string,number>={};for(const b of vision?.blocks??[])counts[b.name]=(counts[b.name]??0)+1;
   return {...e,data:{...facts,...(e.id===out.goalReview!.observationId?{viewReference:'Current state.vision and state.nearbyPlayers'}:{historicalVisibleBlockCounts:counts,historicalViewIsNotCurrent:true})}};
  }
  if(e.kind==='action'&&d){const {before,after,...facts}=d;return {...e,data:facts};}
  return e;
 });
 return {...out,executionEvidence:executionEvidence(out.recentActions??[])};
}
