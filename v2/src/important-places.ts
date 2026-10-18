import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';
import type {Snapshot} from './types.js';
import type {SeenBlock} from './vision.js';
export type PlaceEvidence=SeenBlock & {id:string;dimension:string};
export type PlaceUpdate={evidenceId:string;label:string;reason:string;importance?:'active'|'archived'};
export type PlaceReceipt={at:number;status:'applied'|'unchanged'|'rejected';updates:{placeId:string;evidenceId:string;label:string;changed:boolean}[];reason?:string};
export type ImportantPlace={id:string;dimension:string;position:SeenBlock['position'];label:string;reason:string;importance:'active'|'archived';registeredBlock:string;lastObservedBlock:string;lastSeen:number;evidenceId:string;status:'historical'|'changed'};
const coordinateId=(dimension:string,p:SeenBlock['position'])=>'place_'+createHash('sha256').update(JSON.stringify([dimension,p.x,p.y,p.z])).digest('hex').slice(0,20);
export function placeEvidence(s:Snapshot):PlaceEvidence[]{
 if(!s.ready||!s.dimension)return [];
 const cells=new Map<string,SeenBlock>();
 for(const b of [...s.vision?.blocks??[]]){const id=coordinateId(s.dimension,b.position),old=cells.get(id);if(!old||b.lastSeen>=old.lastSeen)cells.set(id,b);}
 const current=[...cells].map(([id,b])=>({...structuredClone(b),dimension:s.dimension!,id:id+'_'+createHash('sha256').update(JSON.stringify([b.name,b.lastSeen])).digest('hex').slice(0,12)}));
 const ids=new Set(current.map(b=>coordinateId(b.dimension,b.position)));
 for(const p of s.importantPlaces??[]){if(ids.has(p.id))continue;const b={name:p.lastObservedBlock,position:p.position,lastSeen:p.lastSeen};current.push({...b,dimension:p.dimension,id:p.id+'_'+createHash('sha256').update(JSON.stringify([b.name,b.lastSeen])).digest('hex').slice(0,12)});}
 return current;
}
export class ImportantPlaces {
 private data:{receipts?:PlaceReceipt[];schema:1;profile:string;places:ImportantPlace[];history:{at:number;before?:ImportantPlace;after:ImportantPlace}[]};
 private dirty=false;private lastSave=0;
 constructor(private file?:string,profile='mock'){
  this.data=file&&existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{schema:1,profile,places:[],history:[]};
  if(this.data.schema!==1||this.data.profile!==profile||!Array.isArray(this.data.places)||!Array.isArray(this.data.history))throw Error('Invalid important place memory; preserve file');
 }
 snapshot(){return structuredClone(this.data.places);}
 review(){return {recent:(this.data.receipts??[]).map(r=>({at:r.at,status:r.status,updates:r.updates.map(u=>({placeId:u.placeId,changed:u.changed})),...(r.reason?{reason:r.reason}:{})})),meaning:'Receipts confirm memory annotations only, not physical actions or automatic task/goal completion. The full map remains authoritative; no new receipt does not erase a prior annotation.'};}
 private receipt(receipt:PlaceReceipt){this.data.receipts=[...(this.data.receipts??[]),receipt].slice(-8);this.dirty=true;this.flush(true);return receipt;}
 apply(updates:unknown,evidence:PlaceEvidence[]){
  if(updates===undefined||Array.isArray(updates)&&updates.length===0)return;
  try{return this.applyBatch(updates,evidence);}catch(error){
   const reason=error instanceof Error&&error.message.startsWith('Invalid place')?error.message:undefined;
   if(reason)this.receipt({at:Date.now(),status:'rejected',updates:[],reason});
   throw error;
  }
 }
 observe(s:Snapshot){
  const seen=placeEvidence({...s,importantPlaces:[]});
  for(const b of seen){const item=this.data.places.find(p=>p.id===coordinateId(b.dimension,b.position));if(!item||b.lastSeen<=item.lastSeen)continue;
   const before=structuredClone(item);item.lastSeen=b.lastSeen;item.lastObservedBlock=b.name;item.status=b.name===item.registeredBlock?'historical':'changed';
   if(before.lastObservedBlock!==item.lastObservedBlock)this.data.history.push({at:Date.now(),before,after:structuredClone(item)});this.dirty=true;
  }
  this.flush();
 }
 private applyBatch(updates:unknown,evidence:PlaceEvidence[]){
  if(!Array.isArray(updates)||updates.length>12)throw Error('Invalid place updates: at most 12 per review');
  // Validate the complete batch before mutating. Coordinates come only from supplied evidence.
  const patches=updates.map((u:any,index:number)=>{
   if(!u||typeof u.label!=='string'||!u.label.trim()||u.label.length>120||typeof u.reason!=='string'||!u.reason.trim()||u.reason.length>300||!['active','archived'].includes(u.importance??'active'))throw Error('Invalid place annotation');
   const source=evidence.find(b=>b.id===u.evidenceId);if(!source)throw Error('Invalid place evidence ID at update '+(index+1)+': copy an exact placeCitationContract.allowedEvidenceIds value, not an existing place record ID');
   return {u,source};
  });
  const applied:PlaceReceipt["updates"]=[];
  for(const {u,source:b} of patches){
   const id=coordinateId(b.dimension,b.position),old=this.data.places.find(p=>p.id===id);
   const next:ImportantPlace={id,dimension:b.dimension,position:{...b.position},label:u.label,reason:u.reason,importance:u.importance??'active',registeredBlock:old?.registeredBlock??b.name,lastObservedBlock:b.name,lastSeen:b.lastSeen,evidenceId:b.id,status:(old?.registeredBlock??b.name)===b.name?'historical':'changed'};
   // A delayed planner cannot roll back a newer directly observed change.
   if(old&&old.lastSeen>b.lastSeen){next.lastSeen=old.lastSeen;next.lastObservedBlock=old.lastObservedBlock;next.status=old.status;}
   const changed=!old||old.label!==next.label||old.reason!==next.reason||old.importance!==next.importance;
   applied.push({placeId:id,evidenceId:b.id,label:next.label,changed});
   if(old&&JSON.stringify(old)===JSON.stringify(next))continue;
   this.data.history.push({at:Date.now(),before:old?structuredClone(old):undefined,after:structuredClone(next)});
   if(old)this.data.places[this.data.places.indexOf(old)]=next;else this.data.places.push(next);this.dirty=true;
  }
  return this.receipt({at:Date.now(),status:applied.some(x=>x.changed)?'applied':'unchanged',updates:applied});
 }
 flush(force=false){if(!this.dirty||!this.file||!force&&Date.now()-this.lastSave<5000)return;mkdirSync(dirname(this.file),{recursive:true,mode:0o700});const tmp=this.file+'.tmp';writeFileSync(tmp,JSON.stringify(this.data),{mode:0o600});renameSync(tmp,this.file);this.lastSave=Date.now();this.dirty=false;}
}
export const PLACE_MEMORY_PROMPT=' You also curate important places for future planning, travel and cooperation. Return optional placeUpdates:[{evidenceId,label,reason,importance:"active"|"archived"}], at most 12 updates per review (the stored map itself is NOT capped). You decide importance, not block-type rules. Cite ONLY supplied placeEvidence IDs; coordinates and observed block facts are copied from that evidence, never invented. Reuse the same coordinate for the same place, explaining why it matters. The complete importantPlaces map is historical, not proof of current visibility, accessibility, safety or current existence. Changed records retain their history. Archiving marks relevance, not physical disappearance. Register useful discoveries and revise annotations when new evidence warrants it; do not register every block or generate entries to fill a quota. Player reports and plans alone are not direct observation. These are memory annotations, not commands to execute actions. If recording is needed, emit placeUpdates in THIS response; do not assign a future record-memory action to JEV. If importantPlaces already contains the intended annotation and placeMemoryReview confirms it, assess that bookkeeping as done and choose the next meaningful task or explicitly explain what remains unobserved. An annotation does not prove accessibility or complete a broader goal. Use placeCitationContract.allowedEvidenceIds exactly; place IDs identify existing records and are NOT evidence IDs. A rejected receipt means no annotations from that batch were applied; correct the citation without inventing evidence.';
