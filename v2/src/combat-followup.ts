import type {ActionRecord} from './planning.js';

export const FLEE_FOLLOWUP_MS=120000,REAPPROACH_DISTANCE=8;
// Descriptive evidence after each flee: whether the same enemy came back close, later health loss and death.
// A flee that ends with distance_increased only measured its own interval; in DUO5 the zombies kept following
// and the bots died, while every flee record still read "succeeded".
export function fleeFollowups(records:ActionRecord[],now=Date.now()){
 const ordered=[...records].sort((a,b)=>a.startedAt-b.startedAt);
 return ordered.filter(r=>r.decision.action==='flee'&&r.outcome!=='skipped').slice(-8).map(r=>{
  const target=r.executionPlan?.targetEntityId,life=r.after?.lifeGeneration??r.before?.lifeGeneration;
  const later=ordered.filter(n=>n!==r&&n.startedAt>=r.endedAt&&n.startedAt-r.endedAt<=FLEE_FOLLOWUP_MS);
  const sameLife=later.filter(n=>life===undefined||n.before?.lifeGeneration===life);
  const back=sameLife.find(n=>(n.before?.enemies??[]).some(e=>e.id===target&&e.distance<=REAPPROACH_DISTANCE));
  const backEnemy=back?.before?.enemies?.find(e=>e.id===target);
  const died=later.find(n=>life!==undefined&&n.before?.lifeGeneration!==undefined&&n.before.lifeGeneration!==life);
  const healthLoss=+sameLife.reduce((sum,n)=>sum+Math.max(0,-(n.changes?.health??0)),0).toFixed(1);
  const window=Math.min(FLEE_FOLLOWUP_MS,Math.max(0,(later.at(-1)?.endedAt??now)-r.endedAt));
  return {actionId:r.id,targetId:target??null,targetKind:r.before?.enemies?.find(e=>e.id===target)?.kind??null,fleeOutcome:r.outcome,
   sameEnemyBackWithin8Blocks:back?{afterSeconds:Math.round((back.startedAt-r.endedAt)/1000),distance:+(backEnemy?.distance??0).toFixed(1),actionId:back.id}:null,
   laterHealthLoss:healthLoss,diedAfterSeconds:died?Math.round((died.startedAt-r.endedAt)/1000):null,observedSeconds:Math.round(window/1000),
   status:later.length?'observed':'no_later_actions'};
 });
}
export const FLEE_FOLLOWUP_MEANING=`For each recent flee, what followed in the next ${FLEE_FOLLOWUP_MS/1000} s: whether the same enemy was again within ${REAPPROACH_DISTANCE} blocks, health lost later and death. A flee outcome of distance_increased covers only the flee itself, not whether the chase ended. Descriptive evidence, not a rule.`;
