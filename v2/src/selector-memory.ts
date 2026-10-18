import type {Snapshot,Plan} from './types.js';
import {key} from './vision.js';
// Retrieval only: historical observations never grant visibility or execution permission.
export function rememberedPlaces(s:Snapshot,p?:Plan){
 const visible=new Set((s.vision?.blocks??[]).map(b=>key(b.position)));
 const terms=new Set((JSON.stringify({goal:p?.goal,intent:p?.intent,craft:p?.craft})??'').toLowerCase().match(/[a-z_]+/g)??[]);
 const workstations=new Set(['crafting_table','furnace','blast_furnace','smoker','chest','barrel']);
 const unique=new Map<string,NonNullable<Snapshot['places']>[number]>();
 for(const b of s.places??[]){const k=key(b.position),old=unique.get(k);if(!old||old.lastSeen<b.lastSeen)unique.set(k,b);}
 const relevance=(name:string)=>Number(terms.has(name))*2+Number(workstations.has(name));
 const distance=(b:NonNullable<Snapshot['places']>[number])=>Math.hypot(b.position.x-s.position.x,b.position.y-s.position.y,b.position.z-s.position.z);
 return [...unique.values()].filter(b=>!visible.has(key(b.position))&&!['air','cave_air','void_air'].includes(b.name))
 .sort((a,b)=>relevance(b.name)-relevance(a.name)||distance(a)-distance(b)||b.lastSeen-a.lastSeen||key(a.position).localeCompare(key(b.position)))
 .slice(0,8).map(b=>({...b,status:'historical_not_currently_visible' as const}));
}
