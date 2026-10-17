import {candidates,type Snapshot,type Plan,type Action} from './types.js';
import {supportsFeet} from './building.js';
export type Option={id:string;action:Action;plan:Plan};
export type Route='respond'|'clarify'|'observe'|'other'|'defer';
export type Supervision={choice:string;confidence:number;review:'none'|'medium'|'long';routes:Record<string,Route>};
export type SupervisorInput={options:Option[];execution:{id:number;action:Action;plan:Plan;elapsedMs:number;observedChanges?:unknown;interruptionNote?:string}|null;inbox:import('./social.js').ChatEvent[];goal:string|null;recovery?:unknown};
// These are executable, observed alternatives, not a hidden task curriculum.
export function executionOptions(s:Snapshot,p:Plan):Option[]{
 const out:Option[]=[],seen=new Set<string>();
 const add=(plan:Plan,only?:Action)=>{for(const action of candidates(s,plan)){if(action==='idle'||only&&action!==only)continue;const candidate={...plan,preferred:action};const key=JSON.stringify([action,candidate.mine,candidate.destination,candidate.craft,candidate.pickup,candidate.transfer,candidate.container,candidate.build,candidate.equip]);if(seen.has(key))continue;seen.add(key);out.push({id:'option_'+out.length,action,plan:candidate});}};
 add(p);
 for(const b of (s.vision?.blocks??[]).filter(b=>b.name!=='air'&&!supportsFeet(b.position,s.position)).sort((a,b)=>distance(a.position,s)-distance(b.position,s)).slice(0,6))add({goal:p.goal,preferred:'mine',mine:{position:b.position,expected:b.name}},'mine');
 for(const i of (s.visibleItems??[]).slice(0,4))add({goal:p.goal,preferred:'pickup',pickup:{entityId:i.id,expected:i.name}},'pickup');
 for(const item of (s.craftable??[]).slice(0,6))add({goal:p.goal,preferred:'craft',craft:{item,count:1}},'craft');
 // Navigation candidates remain actual observations or remembered places.
 for(const b of (s.places??[]).filter(b=>distance(b.position,s)>3).slice(0,4))add({goal:p.goal,preferred:'move',destination:b.position},'move');
 return out.slice(0,32);
}
function distance(p:Snapshot['position'],s:Snapshot){return Math.hypot(p.x-s.position.x,p.y-s.position.y,p.z-s.position.z);}

export function executionIdentity(action:Action,p:Plan){return JSON.stringify([action,p.mine,p.destination,p.craft,p.pickup,p.transfer,p.container,p.build,p.equip,p.look]);}
