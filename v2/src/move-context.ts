import type {Snapshot} from './types.js';
import type {Question} from './parameter-supervisor.js';
export const MOVE_SEMANTICS='move approaches an observed or remembered reference coordinate until the floored body cell is within Euclidean radius 2. It does not require standing inside that exact block. A solid block can be a reference point. Selecting a reference requests a bounded path attempt, not a claim that the route is known or guaranteed. Route search and current observation checks occur locally at execution. Already within radius means no move will start. Historical observations may have changed; current visibility and past observation are different. Choose or withdraw based on the intention and evidence; no destination is preferred.';
const key=(p:{x:number;y:number;z:number})=>`${p.x},${p.y},${p.z}`;
export function movementEvidence(s:Pick<Snapshot,'places'|'vision'|'navigationTargets'>){
 const blocks=new Map<string,any>();
 for(const b of s.places??[])blocks.set(key(b.position),{position:b.position,name:b.name,lastSeen:b.lastSeen,visibility:'historical'});
 for(const b of s.vision?.blocks??[])blocks.set(key(b.position),{position:b.position,name:b.name,lastSeen:b.lastSeen,visibility:'current'});
 const entries=[...blocks.values()],names=[...new Set(entries.map(b=>b.name))];
 const times=entries.map(b=>b.lastSeen).filter(Number.isFinite);
 const origin=entries[0]?.position??{x:0,y:0,z:0},timeBase=times.length?Math.min(...times):0;
 const observedBlocks={columns:['dx','dy','dz','nameIndex','timeDeltaMs','currentlyVisible'],origin,timeBase,names,rows:entries.map(b=>[b.position.x-origin.x,b.position.y-origin.y,b.position.z-origin.z,names.indexOf(b.name),Number.isFinite(b.lastSeen)?b.lastSeen-timeBase:null,b.visibility==='current'?1:0]),encoding:'Exact observations: position=origin+[dx,dy,dz], block name=names[nameIndex], lastSeen=timeBase+timeDeltaMs (null means unknown), currentlyVisible 1=current / 0=historical. Row order is not a ranking.'};
 return {observedBlocks,navigationHints:s.navigationTargets??[],meaning:'Observed block identities and timestamps, not a recommended destination list. Navigation hints passed a bounded local route check when generated; they are not a guarantee at execution. Unlisted coordinates can still originate from important-place or recovery memory. No block identity is inferred for them.'};
}
export function moveContextRequest<T extends Record<string,any>>(questions:Record<string,Question>,context:T){
 const q=structuredClone(questions);if(q.action?.criteria.move)q.action.criteria.move=MOVE_SEMANTICS;
 return {questions:q,context:{...context,moveSemantics:MOVE_SEMANTICS}};
}

export function decodeMovementBlocks(e:ReturnType<typeof movementEvidence>){const b=e.observedBlocks;return b.rows.map(r=>({position:{x:b.origin.x+r[0]!,y:b.origin.y+r[1]!,z:b.origin.z+r[2]!},name:b.names[r[3]!],lastSeen:r[4]===null?undefined:b.timeBase+r[4]!,visibility:r[5]===1?'current':'historical'}));}
