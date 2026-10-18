import {MOVE_RADIUS} from './action-contracts.js';
import type {ActionRecord} from './planning.js';
import type {Position,SeenBlock} from './vision.js';
export function navigationEvidence(reason:string,position:Position,target:Position,radius:number,path:any,visible:SeenBlock[],scan:boolean){
 const near=visible.filter(b=>Math.hypot(b.position.x-position.x,b.position.y-position.y,b.position.z-position.z)<=4);
 return {reason,position:{...position},target:{...target},arrivalRadius:radius,heightDifference:target.y-position.y,
  search:{status:path?.status??'unknown',budgetMs:200,nodeCount:path?.path?.length??0,endpoint:path?.path?.at(-1)?{x:path.path.at(-1).x,y:path.path.at(-1).y,z:path.path.at(-1).z}:null,localScanPerformed:scan},
  nearbyObservedBlocks:near.map(b=>({name:b.name,position:{...b.position},lastSeen:b.lastSeen})),
  limits:{observedSupportsOnly:true,automaticDigging:false,automaticPlacement:false,parkour:false},
  interpretation:'A failed bounded route attempt, not proof the destination is permanently unreachable. Height difference alone does not identify the cause. Unobserved clearance is unknown; nearby blocks are observations, not a certified blocking set.'};
}
export type NavigationEvidence=ReturnType<typeof navigationEvidence>;
export class NavigationFailure extends Error{constructor(readonly evidence:NavigationEvidence){super('Destination not reached: '+evidence.reason);}}
export function executionEvidence(records:ActionRecord[]){
 let lookCount=0;const ids:number[]=[];let requested:unknown;
 for(const r of [...records].reverse()){
  const v=r.changes?.view;if(r.decision.action!=='look'||r.outcome!=='succeeded'||!v||Math.abs(v.camera.yawDeltaDegrees)>1||Math.abs(v.camera.pitchDeltaDegrees)>1||v.visibleBlocks.enteredCount||v.visibleBlocks.leftCount)break;
  const key=JSON.stringify(r.executionPlan?.look);if(lookCount&&key!==requested)break;requested=key;lookCount++;ids.unshift(r.id);
 }
 const groups=new Map<string,any>();
 for(const r of records){if(r.decision.action!=='move'||r.outcome!=='failed'||!r.executionPlan?.destination)continue;
  const key=JSON.stringify(r.executionPlan.destination),g=groups.get(key)??{target:r.executionPlan.destination,count:0,ids:[]};g.count++;g.ids.push(r.id);g.lastAt=r.endedAt;g.lastResult=r.result;g.navigation=r.navigation;g.lastPosition=r.after.position;groups.set(key,g);}
 return {look:lookCount?{completedConsecutiveSameView:lookCount,recordIds:ids,lastRequested:records.at(-1)?.executionPlan?.look,summary:`Completed ${lookCount} consecutive looks at the same requested orientation; camera changed at most one degree and no blocks entered or left the view.`}:null,
  completedMoves:records.filter(r=>r.decision.action==='move'&&r.outcome==='succeeded'&&r.executionPlan?.destination&&r.before?.position&&r.after?.position).slice(-6).map(r=>({recordId:r.id,endedAt:r.endedAt,target:r.executionPlan!.destination,arrivalRadius:MOVE_RADIUS,from:r.before.position,arrivedAt:r.after.position,healthDelta:r.after.health-r.before.health})),
  movementMeaning:'Completed moves establish arrival within the stated radius from the recorded start at that time. They do not establish exact target occupancy, mining reach, an entire safe route, a return path, or absence of transient damage. Failed and cancelled attempts do not erase completed approaches. Health delta is net change, not proof of no damage.',
  failedMoves:[...groups.values()],scope:'Retained action journal only; counts are not lifetime totals. Repeated observations may still be intentional monitoring. Check whether there is an expected event or changed condition; otherwise consider a different approach. Facts do not prohibit any action.'};
}
