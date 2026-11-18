import {createHash} from 'node:crypto';
import {actionDomains} from './action-domains.js';
import {equipmentChoices} from './equipment.js';
import type {Snapshot} from './types.js';
export type ArgumentOffer={name:string;values:unknown[]};
const key=(p:Snapshot['position'])=>[p.x,p.y,p.z].join(',');
const clean=(v:any):any=>Array.isArray(v)?v.map(clean):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>!['lastSeen','observedAt','ageMs','at'].includes(k)).map(k=>[k,clean(v[k])])):v;
const signature=(xs:unknown[])=>createHash('sha256').update(JSON.stringify(xs.map(v=>JSON.stringify(clean(v))).sort())).digest('hex');
/** Geometry/category counts describe ALL supplied members; no goal ranking. */
export function candidateFacts(values:any[]){
 if(values.length<=12||values.every(v=>typeof v!=='object'||v===null))return {count:values.length,values};
 const groups=new Map<string,{name:string;count:number;bounds?:{min:number[];max:number[]}}>();
 for(const v of values){const name=v.name??v.kind??v.supportBlock??'coordinate',p=v.position??(Number.isFinite(v.x)?v:undefined),g: {name:string;count:number;bounds?:{min:number[];max:number[]}}=groups.get(name)??{name,count:0};g.count++;
  if(p){const xyz=[p.x,p.y,p.z];g.bounds=g.bounds?{min:g.bounds.min.map((n,i)=>Math.min(n,xyz[i])),max:g.bounds.max.map((n,i)=>Math.max(n,xyz[i]))}:{min:xyz,max:[...xyz]};}groups.set(name,g);
 }
 return {count:values.length,groups:[...groups.values()].sort((a,b)=>a.name.localeCompare(b.name)),meaning:'Counts cover all offered members. Bounds are envelopes, not filled terrain or route guarantees. Exact values remain in argument selection and raw receipts.'};
}
export function actionAvailability(s:Snapshot){
 const d=actionDomains(s),visible=new Set((s.vision?.blocks??[]).map(b=>key(b.position)));
 const spatial=(name:keyof typeof d)=>{const x=d[name];return {scope:x.scope,selectable:candidateFacts(x.values),knownOutsideScope:candidateFacts(x.outside),meaning:'Selectable does not guarantee reach, drops, or success. Outside entries are known observations/memories, not hidden current truth; use map timestamps. Individual actions include approach only inside this scope.'};};
 const mine=spatial('mine');
 return {
  meaning:'Current individual-action argument domains, not recommended choices. All listed options remain available. Procedure delegates use their own LLM-declared areas; they do not expand individual JEV domains.',
  move:spatial('move'),mine:{...mine,targetType:'Block cells only; never animals or a desired item without a matching block. Existing dropped items are pickup targets.',currentVisibleCount:d.mine.values.filter(b=>visible.has(key(b.position))).length},place_block:{...spatial('place_block'),items:s.placeableItems??[]},
  craft:{recipeOutputs:[...new Set(s.craftable??[])],executionLimits:(s.craftable??[]).map(item=>({item,maxExecutions:s.crafting?.recipes.find(r=>r.item===item)?.maxExecutions??1})),workstation:spatial('workstation'),meaning:'recipeOutputs is the complete next recipeOutput question. Other unlocked recipes and their deficits remain in crafting; they are not current output choices. No automatic prerequisite gathering.'},
  pickup:spatial('pickup'),sleep:spatial('bed'),inspect_container:spatial('container'),
  deposit:{containerScope:'inspect_container',carriedItems:[...new Set((s.inventory??[]).filter(i=>i.slot>=9&&i.slot<=44).map(i=>i.name))]},
  withdraw:{containerScope:'inspect_container',contents:'Only previously observed container contents; unknown contents require inspection. Counts are revalidated on opening.'},
  attack:{targets:[...s.enemies??[],...s.animals??[]].map(e=>({id:e.id,kind:e.kind})),meaning:'Visible targets only; attack uses current held equipment. Shearing is not implemented.'},
  flee:{targets:(s.enemies??[]).map(e=>({id:e.id,kind:e.kind}))},eat:{items:s.edibleItems??[],canEat:s.canEat},equip:{changes:equipmentChoices(s.inventory,s.equipment)},
  follow:{players:(s.nearbyPlayers??[]).map(p=>p.name)},give:{players:(s.nearbyPlayers??[]).map(p=>p.name),items:[...new Set((s.inventory??[]).filter(i=>i.slot>=9&&i.slot<=44).map(i=>i.name))]}
 };
}
function currentValues(name:string,s:Snapshot):unknown[]|undefined{
 switch(name){
  case 'recipeOutput':return [...new Set(s.craftable??[])];
  case 'block':return actionDomains(s).mine.values;
  case 'destination':return actionDomains(s).move.values;
  case 'placementSite':return actionDomains(s).place_block.values;
  case 'workstation':return actionDomains(s).workstation.values;
  case 'drop':return actionDomains(s).pickup.values;
  case 'bed':return actionDomains(s).bed.values;
  case 'container':return actionDomains(s).container.values;
  case 'blockItem':return s.placeableItems??[];
  case 'foodItem':return s.edibleItems??[];
  case 'equipmentChange':return equipmentChoices(s.inventory,s.equipment);
 }
}
export function offeredArgumentView(offer:ArgumentOffer,s?:Snapshot){
 const now=s?currentValues(offer.name,s):undefined;
 return {name:offer.name,offered:candidateFacts(offer.values),...(now?{sameCandidatesNow:signature(now)===signature(offer.values)}:{}),meaning:'Candidates offered to a withdrawn/unresolved proposal. No inferred model reason; no action executed. Same candidates does not imply all context is unchanged.'};
}

/** Join an existing execution ID to observed identity; never infer hidden state. */
export function executionTargetObservation(s:Snapshot,execution:{action:string;plan:{targetEntityId?:number}}|null|undefined){
 if(!execution||!['attack','flee'].includes(execution.action)||execution.plan.targetEntityId===undefined)return undefined;
 const entityId=execution.plan.targetEntityId,animal=s.animals?.find(e=>e.id===entityId),enemy=s.enemies?.find(e=>e.id===entityId),entity=animal??enemy;
 return {entityId,source:animal?'visible_animal':enemy?'visible_enemy':'not_currently_visible',...(entity?{kind:entity.kind,position:{...entity.position},distance:entity.distance}:{}),meaning:'Identity join to current observation, not a target recommendation. Opponent health is not known. An empty enemy list does not remove a visible animal from attack targets.'};
}
