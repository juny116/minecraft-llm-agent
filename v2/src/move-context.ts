import type {Snapshot} from './types.js';
import type {Question} from './parameter-supervisor.js';
import {MOVE_DESCRIPTION} from './action-contracts.js';
export const MOVE_SEMANTICS=MOVE_DESCRIPTION;
const key=(p:{x:number;y:number;z:number})=>`${p.x},${p.y},${p.z}`;
export function movementEvidence(s:Pick<Snapshot,'places'|'vision'|'navigationTargets'>){
 const blocks=new Map<string,any>();
 for(const b of s.places??[])blocks.set(key(b.position),{position:b.position,name:b.name,lastSeen:b.lastSeen,visibility:'historical'});
 for(const b of s.vision?.blocks??[])blocks.set(key(b.position),{position:b.position,name:b.name,lastSeen:b.lastSeen,visibility:'current'});
 const entries=[...blocks.values()],names=[...new Set(entries.map(b=>b.name))];
 const times=entries.map(b=>b.lastSeen).filter(Number.isFinite);
 const origin=entries[0]?.position??{x:0,y:0,z:0},timeBase=times.length?Math.min(...times):0;
 const rows=entries.map(b=>[b.position.x-origin.x,b.position.y-origin.y,b.position.z-origin.z,names.indexOf(b.name),Number.isFinite(b.lastSeen)?b.lastSeen-timeBase:null,b.visibility==='current'?1:0]);
 const runs:any[]=[];for(const row of rows){const shared=row.slice(3),last=runs.at(-1);if(last&&JSON.stringify(last[0])===JSON.stringify(shared))last[1].push(row.slice(0,3));else runs.push([shared,[row.slice(0,3)]]);}
 const observedBlocks={origin,timeBase,names,runs,encoding:'Exact ordered observations. Each run is [[nameIndex,timeDeltaMs,currentlyVisible], [[dx,dy,dz], ...]]. Expand runs in order. position=origin+[dx,dy,dz]; name=names[nameIndex]; lastSeen=timeBase+timeDeltaMs (null means unknown); currentlyVisible 1=current / 0=historical. Order is not a ranking.'};
 return {observedBlocks,navigationHints:s.navigationTargets??[],meaning:'Observed block identities and timestamps, not a recommended destination list. Navigation hints passed a bounded local route check when generated; they are not a guarantee at execution. Unlisted coordinates can still originate from important-place or recovery memory. No block identity is inferred for them.'};
}
export function moveContextRequest<T extends Record<string,any>>(questions:Record<string,Question>,context:T){
 const q=structuredClone(questions);if(q.action?.criteria.move)q.action.criteria.move=MOVE_SEMANTICS;
 return {questions:q,context:{...context,moveSemantics:MOVE_SEMANTICS}};
}

export function decodeMovementBlocks(e:{observedBlocks:any}){const b=e.observedBlocks,rows=b.rows??b.runs.flatMap((r:any)=>r[1].map((p:any)=>[...p,...r[0]]));return rows.map((r:any)=>({position:{x:b.origin.x+r[0],y:b.origin.y+r[1],z:b.origin.z+r[2]},name:b.names[r[3]],lastSeen:r[4]===null?undefined:b.timeBase+r[4],visibility:r[5]===1?'current':'historical'}));}
