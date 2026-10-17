import {candidates,type Snapshot,type Plan,type Action} from './types.js';
import {supportsFeet} from './building.js';
export type Option={id:string;action:Action;plan:Plan};
export type Route='respond'|'clarify'|'observe'|'other'|'defer';
export type Supervision={choice:string;confidence:number;review:'none'|'medium'|'long';routes:Record<string,Route>};
export type SupervisorInput={options:Option[];execution:{id:number;action:Action;plan:Plan;elapsedMs:number;observedChanges?:unknown;interruptionNote?:string}|null;inbox:import('./social.js').ChatEvent[];goal:string|null;plan?:Plan;progress?:unknown;recentOutcome?:unknown;recovery?:unknown};
// These are executable, observed alternatives, not a hidden task curriculum.
export function executionOptions(s:Snapshot,p:Plan):Option[]{
 const out:Option[]=[],seen=new Set<string>();
 const add=(plan:Plan,only?:Action)=>{for(const action of candidates(s,plan)){if(action==='idle'||only&&action!==only)continue;const candidate={...plan,preferred:action};if(action==='place_table'&&plan.preferred!=='place_table')continue;const key=executionIdentity(action,candidate);if(seen.has(key))continue;seen.add(key);out.push({id:'option_'+out.length,action,plan:candidate});}};
 add(p);
 for(const b of (s.vision?.blocks??[]).filter(b=>!!p.mine&&b.name===p.mine.expected&&!supportsFeet(b.position,s.position)).sort((a,b)=>distance(a.position,s)-distance(b.position,s)).slice(0,6))add({goal:p.goal,preferred:'mine',mine:{position:b.position,expected:b.name}},'mine');
 for(const i of (s.visibleItems??[]).slice(0,4))add({goal:p.goal,preferred:'pickup',pickup:{entityId:i.id,expected:i.name}},'pickup');
 // Crafting spends resources: only offer parameterized planner proposals, not every feasible recipe.
 // Moving to arbitrary remembered blocks can chase treetops unrelated to the plan.
 // Only the planner-proposed destination is offered; the executor handles local waypoints.
 return out.slice(0,32);
}
function distance(p:Snapshot['position'],s:Snapshot){return Math.hypot(p.x-s.position.x,p.y-s.position.y,p.z-s.position.z);}

export function executionIdentity(action:Action,p:Plan){
 const parameters=action==='mine'?(p.mine?{...p.mine,maxMs:p.mine.maxMs??30000}:undefined):action==='move'?p.destination:action==='craft'?p.craft:action==='pickup'?p.pickup:action==='place_block'?p.build:action==='equip'?p.equip:action==='look'?p.look:['inspect_container','deposit','withdraw'].includes(action)?[p.container,p.transfer]:action==='give'?p.transfer:null;
 const stable=(v:any):any=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([,x])=>x!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,stable(x)])):v;
 return JSON.stringify(stable([action,parameters]));
}
