import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';
import type {Snapshot} from './types.js';
import type {SeenBlock} from './vision.js';
export type PlaceEvidence=SeenBlock & {id:string;dimension:string};
export type PlaceUpdate={evidenceId:string;label:string;reason:string;importance?:'active'|'archived'};
export type ImportantPlace={id:string;dimension:string;position:SeenBlock['position'];label:string;reason:string;importance:'active'|'archived';registeredBlock:string;lastObservedBlock:string;lastSeen:number;evidenceId:string;status:'historical'|'changed'};
const coordinateId=(dimension:string,p:SeenBlock['position'])=>'place_'+createHash('sha256').update(JSON.stringify([dimension,p.x,p.y,p.z])).digest('hex').slice(0,20);
export function placeEvidence(s:Snapshot):PlaceEvidence[]{
 if(!s.ready||!s.dimension)return [];
 const cells=new Map<string,SeenBlock>();
 for(const b of [...s.places??[],...s.vision?.blocks??[]]){const id=coordinateId(s.dimension,b.position),old=cells.get(id);if(!old||b.lastSeen>=old.lastSeen)cells.set(id,b);}
 const current=[...cells].map(([id,b])=>({...structuredClone(b),dimension:s.dimension!,id:id+'_'+createHash('sha256').update(JSON.stringify([b.name,b.lastSeen])).digest('hex').slice(0,12)}));
 const ids=new Set(current.map(b=>coordinateId(b.dimension,b.position)));
 for(const p of s.importantPlaces??[]){if(ids.has(p.id))continue;const b={name:p.lastObservedBlock,position:p.position,lastSeen:p.lastSeen};current.push({...b,dimension:p.dimension,id:p.id+'_'+createHash('sha256').update(JSON.stringify([b.name,b.lastSeen])).digest('hex').slice(0,12)});}
 return current;
}
export class ImportantPlaces {
 private data:{schema:1;profile:string;places:ImportantPlace[];history:{at:number;before?:ImportantPlace;after:ImportantPlace}[]};
 private dirty=false;private lastSave=0;
 constructor(private file?:string,profile='mock'){
  this.data=file&&existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{schema:1,profile,places:[],history:[]};
  if(this.data.schema!==1||this.data.profile!==profile||!Array.isArray(this.data.places)||!Array.isArray(this.data.history))throw Error('Invalid important place memory; preserve file');
 }
 snapshot(){return structuredClone(this.data.places);}
 observe(s:Snapshot){
  const seen=placeEvidence({...s,importantPlaces:[]});
  for(const b of seen){const item=this.data.places.find(p=>p.id===coordinateId(b.dimension,b.position));if(!item||b.lastSeen<=item.lastSeen)continue;
   const before=structuredClone(item);item.lastSeen=b.lastSeen;item.lastObservedBlock=b.name;item.status=b.name===item.registeredBlock?'historical':'changed';
   if(before.lastObservedBlock!==item.lastObservedBlock)this.data.history.push({at:Date.now(),before,after:structuredClone(item)});this.dirty=true;
  }
  this.flush();
 }
 apply(updates:unknown,evidence:PlaceEvidence[]){
  if(updates===undefined)return;
  if(!Array.isArray(updates)||updates.length>12)throw Error('Invalid place updates: at most 12 per review');
  // Validate the complete batch before mutating. Coordinates come only from supplied evidence.
  const patches=updates.map((u:any)=>{
   if(!u||typeof u.label!=='string'||!u.label.trim()||u.label.length>120||typeof u.reason!=='string'||!u.reason.trim()||u.reason.length>300||!['active','archived'].includes(u.importance??'active'))throw Error('Invalid place annotation');
   const source=evidence.find(b=>b.id===u.evidenceId);if(!source)throw Error('Invalid place evidence ID: cite supplied placeEvidence');
   return {u,source};
  });
  for(const {u,source:b} of patches){
   const id=coordinateId(b.dimension,b.position),old=this.data.places.find(p=>p.id===id);
   const next:ImportantPlace={id,dimension:b.dimension,position:{...b.position},label:u.label,reason:u.reason,importance:u.importance??'active',registeredBlock:old?.registeredBlock??b.name,lastObservedBlock:b.name,lastSeen:b.lastSeen,evidenceId:b.id,status:(old?.registeredBlock??b.name)===b.name?'historical':'changed'};
   // A delayed planner cannot roll back a newer directly observed change.
   if(old&&old.lastSeen>b.lastSeen){next.lastSeen=old.lastSeen;next.lastObservedBlock=old.lastObservedBlock;next.status=old.status;}
   if(old&&JSON.stringify(old)===JSON.stringify(next))continue;
   this.data.history.push({at:Date.now(),before:old?structuredClone(old):undefined,after:structuredClone(next)});
   if(old)this.data.places[this.data.places.indexOf(old)]=next;else this.data.places.push(next);this.dirty=true;
  }
  this.flush(true);
 }
 flush(force=false){if(!this.dirty||!this.file||!force&&Date.now()-this.lastSave<5000)return;mkdirSync(dirname(this.file),{recursive:true,mode:0o700});const tmp=this.file+'.tmp';writeFileSync(tmp,JSON.stringify(this.data),{mode:0o600});renameSync(tmp,this.file);this.lastSave=Date.now();this.dirty=false;}
}
export const PLACE_MEMORY_PROMPT=' You also curate important places for future planning, travel and cooperation. Return optional placeUpdates:[{evidenceId,label,reason,importance:"active"|"archived"}], at most 12 updates per review (the stored map itself is NOT capped). You decide importance, not block-type rules. Cite ONLY supplied placeEvidence IDs; coordinates and observed block facts are copied from that evidence, never invented. Reuse the same coordinate for the same place, explaining why it matters. The complete importantPlaces map is historical, not proof of current visibility, accessibility, safety or current existence. Changed records retain their history. Archiving marks relevance, not physical disappearance. Register useful discoveries and revise annotations when new evidence warrants it; do not register every block or generate entries to fill a quota. Player reports and plans alone are not direct observation. These are memory annotations, not commands to execute actions.';
