import type {Snapshot} from './types.js';
import type {PlanningContext} from './planning.js';
const inventory=(s:Snapshot)=>Object.fromEntries([...new Set(s.inventory?.map(i=>i.name)??[])].sort().map(n=>[n,(s.inventory??[]).filter(i=>i.name===n).reduce((v,i)=>v+i.count,0)]));
const execution=(e:PlanningContext['activeExecution'])=>e?{id:e.id,action:e.action}:null;
const procedure=(p:PlanningContext['procedure'])=>p?{id:p.id,status:p.status,completedSteps:[...p.completedSteps]}:null;
export function capturePlanBasis(s:Snapshot,c:PlanningContext,at:number){return {observedAt:at,inventory:inventory(s),execution:execution(c.activeExecution),procedure:procedure(c.procedure),lastActionId:c.recentActions.at(-1)?.id??0};}
export type PlanBasis=ReturnType<typeof capturePlanBasis>&{appliedAt?:number};
// Evidence chronology only: does not rewrite intentions, mark a task done or choose actions.
export function planFreshness(b:PlanBasis|undefined,s:Snapshot|undefined,c:Pick<PlanningContext,'activeExecution'|'procedure'|'recentActions'>,now=Date.now()){
 if(!b||!s)return undefined;
 const current=inventory(s),inventoryChanges=Object.keys({...b.inventory,...current}).sort().flatMap(item=>(b.inventory[item]??0)===(current[item]??0)?[]:[{item,atRequest:b.inventory[item]??0,now:current[item]??0}]);
 const results=c.recentActions.filter(r=>r.id>b.lastActionId).map(r=>({id:r.id,action:r.decision.action,outcome:r.outcome,endedAt:r.endedAt,inventory:r.changes.inventory,interruption:r.interruption}));
 const currentExecution=execution(c.activeExecution),currentProcedure=procedure(c.procedure);
 return {observedAt:b.observedAt,appliedAt:b.appliedAt,ageMs:Math.max(0,now-b.observedAt),executionAtRequest:b.execution,currentExecution,procedureAtRequest:b.procedure,currentProcedure,inventoryChanges,resultsSinceRequest:results,
  executionChanged:JSON.stringify(b.execution)!==JSON.stringify(currentExecution),procedureChanged:JSON.stringify(b.procedure)!==JSON.stringify(currentProcedure),
  meaning:'The plan was generated from the request-time snapshot. Its present-tense factual claims may be outdated; current observation/execution and newer receipts are current evidence. A completed procedure is not proof the broader task is complete. This chronology neither rejects the plan nor selects a replacement action.'};
}
