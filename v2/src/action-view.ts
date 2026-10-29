import type {ActionRecord} from './planning.js';

// What the LLM layers read about a finished action. Stored records stay complete; this drops what repeats:
// three full observation snapshots (changes already holds the deltas), the whole plan text repeated per record,
// and receipt boilerplate. In FREE1 recentActions alone was ~110K characters of each task and goal request.
const PARAMS=['destination','destinationTarget','craft','mine','build','pickup','transfer','container','targetEntityId','equip','foodItem','bed','followPlayer','look'] as const;
const DROP=new Set(['meaning','attribution','motorAtEnd','from','to','phaseMeaning','inventoryDelta','actionEvidence','target','observedAt']);
function receipt(text:unknown){
 if(typeof text!=='string')return text; // already a compact view
 let r:any;try{r=JSON.parse(text);}catch{return text.slice(0,300);}
 if(!r||typeof r!=='object')return text.slice(0,300);
 const failure=r.actionEvidence?.failureReason??r.failureReason;
 const kept=Object.fromEntries(Object.entries(r).filter(([k,v])=>!DROP.has(k)&&v!==null&&v!==undefined&&!(Array.isArray(v)&&!v.length)));
 const out=JSON.stringify({...kept,...(failure?{failureReason:failure}:{})});
 return out.length>600?out.slice(0,600)+'…':JSON.parse(out);
}
const vitals=(o:any)=>o?{position:o.position,health:o.health,food:o.food,...(o.time?.phase?{timePhase:o.time.phase}:{})}:undefined;
export function actionView(r:ActionRecord){
 if((r as any).enemiesAtDecision)return r as unknown as ReturnType<typeof compactView>; // already compact
 return compactView(r);
}
function compactView(r:ActionRecord){
 const p:any=r.executionPlan??{},o:any=r.decisionObserved??{},{view:_view,...changes}=(r.changes??{}) as any;
 return {id:r.id,startedAt:r.startedAt,endedAt:r.endedAt,source:r.source,selectorKind:r.selectorKind,decision:r.decision,outcome:r.outcome,
  goal:typeof r.goal==='string'?r.goal.slice(0,200):r.goal,stepId:r.stepId,...(r.interruption?{interruption:r.interruption}:{}),
  executionPlan:{preferred:p.preferred,...Object.fromEntries(PARAMS.filter(k=>p[k]!==undefined).map(k=>[k,p[k]])),...(p.intent?.taskId?{taskId:p.intent.taskId}:{})},
  enemiesAtDecision:(o.enemies??[]).slice(0,4).map((e:any)=>({id:e.id,kind:e.kind,distance:+Number(e.distance).toFixed(1)})),
  before:vitals(r.before),after:vitals(r.after),changes,result:receipt(r.result??'')};
}
