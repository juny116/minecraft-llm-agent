import {candidates,type Snapshot,type Plan,type Action} from './types.js';
import {supportsFeet} from './building.js';
import {intentSatisfied} from './work-intent.js';
export type Option={id:string;action:Action;plan:Plan};
export type Route='respond'|'clarify'|'observe'|'other'|'defer';
export type Supervision={selected?:Option;reason?:string;choice:string;confidence:number;review:'none'|'medium'|'long';routes:Record<string,Route>};
export type SupervisorInput={parameterSelection?:boolean;selectionFeedback?:string;blockedInteractions?:unknown;options:Option[];execution:{id:number;action:Action;plan:Plan;elapsedMs:number;motor?:import('./types.js').MotorProgress;observedChanges?:unknown;interruptionNote?:string}|null;inbox:import('./social.js').ChatEvent[];goal:string|null;plan?:Plan;progress?:unknown;recentOutcome?:unknown;recentResults?:unknown[];recovery?:unknown};
// These are executable, observed alternatives, not a hidden task curriculum.
export function executionOptions(s:Snapshot,p:Plan):Option[]{
 if(p.intent)return observedOptions(s,p);
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
 const parameters=action==='mine'?(p.mine?{...p.mine,maxMs:p.mine.maxMs??30000}:undefined):action==='move'?p.destination:action==='craft'?p.craft:action==='pickup'?p.pickup:['place_block','place_table'].includes(action)?p.build:action==='equip'?p.equip:action==='look'?p.look:action==='idle'?p.waitMs:action==='eat'?p.foodItem:action==='follow'?p.followPlayer:['attack','flee'].includes(action)?p.targetEntityId:['inspect_container','deposit','withdraw'].includes(action)?[p.container,p.transfer]:action==='give'?p.transfer:null;
 const stable=(v:any):any=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([,x])=>x!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,stable(x)])):v;
 return JSON.stringify(stable([action,parameters]));
}

// Defer ordinary switches only at a bounded completion boundary, never for the whole attempt.
export function completionBoundary(m?:import('./types.js').MotorProgress){
 if(!m||m.phaseElapsedMs<0)return false;
 if(m.phase==='collecting')return m.blockBroken&&m.phaseElapsedMs<2200;
 return m.phase==='digging'&&Number.isFinite(m.estimatedDigMs)&&m.estimatedDigMs!>0&&m.phaseElapsedMs>=Math.max(0,m.estimatedDigMs!-1500)&&m.phaseElapsedMs<m.estimatedDigMs!+500;
}

// Bounded diversity across block types and directions, independent of LLM coordinates.
// Observation is not a guarantee of harvestability or path execution.
export function observedOptions(s:Snapshot,p:Plan):Option[]{
 const out:Option[]=[],seen=new Set<string>();
 const add=(action:Action,parameters:Partial<Plan>={})=>{
  const plan:Plan={goal:p.goal,intent:p.intent,preferred:action,...parameters};
  if(!candidates(s,plan).includes(action))return;
  const key=executionIdentity(action,plan);if(seen.has(key))return;
  seen.add(key);out.push({id:'option_'+out.length,action,plan});
 };
 for(const a of ['eat','attack','flee','look'] as Action[])add(a);
 if(intentSatisfied(p.intent,s))return out;
 // Preserve specialized skills without asking the planner to choose mining/movement targets.
 for(const proposal of p.proposals??[])if(!['mine','move','idle','look'].includes(proposal.preferred))add(proposal.preferred,proposal);
 const kinds=new Map<string,NonNullable<Snapshot['vision']>['blocks']>();
 for(const b of [...s.vision?.blocks??[]].filter(b=>!supportsFeet(b.position,s.position)).sort((a,b)=>distance(a.position,s)-distance(b.position,s))){
  const group=kinds.get(b.name)??[];group.push(b);kinds.set(b.name,group);
 }
 // Round robin: a large tree or grass patch must not eliminate other observed kinds.
 const groups=[...kinds.values()].slice(0,12);
 for(let rank=0;rank<2;rank++)for(const group of groups){const b=group[rank];if(b)add('mine',{mine:{position:b.position,expected:b.name}});}
 const sectors=new Map<number,NonNullable<Snapshot['navigationTargets']>>();
 for(const pos of [...s.navigationTargets??[]].sort((a,b)=>distance(a,s)-distance(b,s))){
  const sector=Math.floor((Math.atan2(pos.z-s.position.z,pos.x-s.position.x)+Math.PI)/(Math.PI/4))%8;
  const group=sectors.get(sector)??[];group.push(pos);sectors.set(sector,group);
 }
 for(const group of sectors.values()){
  const pos=group.find(pos=>candidates(s,{goal:p.goal,preferred:'move',destination:pos}).includes('move'));
  if(pos)add('move',{destination:pos});
 }
 for(const item of (s.visibleItems??[]).slice(0,4))add('pickup',{pickup:{entityId:item.id,expected:item.name}});
 const desired=new Set(p.intent?.desiredInventory.map(i=>i.item));
 for(const item of [...s.craftable??[]].sort((a,b)=>Number(desired.has(b))-Number(desired.has(a))||a.localeCompare(b)).slice(0,8))add('craft',{craft:{item,count:1}});
 if(s.canPlaceTable&&!s.vision?.blocks.some(b=>b.name==='crafting_table'))add('place_table');
 return out.slice(0,56);
}
