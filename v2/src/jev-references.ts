import {isSeenCell} from './jev-table-codec.js';
import {jevLosslessRequest,decodeJevState,decodeJevQuestions} from './jev-state.js';
const object=(v:any)=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const position=(v:any)=>object(v)&&Object.keys(v).length===3&&['x','y','z'].every(k=>Number.isFinite(v[k]));
const canonical=(v:any):string=>JSON.stringify(v,(_k,x)=>object(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
// Request-local exact references. No candidates are ranked, shortened or replaced.
export function referenceRequest(context:Record<string,any>,questions:Record<string,any>){
 const candidates=new Set<string>();
 for(const q of Object.values(questions))for(const v of Object.values(q.criteria??{}) as any[]){
  if(object(v)&&object(v.value)&&!position(v.value))candidates.add(canonical(v.value));
  if(object(v)&&Array.isArray(v.values))for(const x of v.values)if(object(x)&&!position(x))candidates.add(canonical(x));
 }
 // Repeated execution/navigation receipts can dominate a panoramic request.
 // Share exact repeated objects, not summaries: decoding retains every field.
 const occurrences=new Map<string,number>();
 const count=(v:any)=>{if(Array.isArray(v)){for(const x of v)count(x);return;}if(!object(v)&&typeof v!=='string')return;const k=canonical(v);if(k.length>=96)occurrences.set(k,(occurrences.get(k)??0)+1);if(object(v))for(const x of Object.values(v))count(x);};
 count(context);count(questions);for(const [k,n]of occurrences)if(n>1)candidates.add(k);
 const entities:Record<string,any>={},originals=new Map<string,string>();
 const walk=(v:any,root=false,strings=true):any=>{
  if(Array.isArray(v))return v.map(x=>walk(x,false,strings));
  if(!object(v)&&!(strings&&typeof v==='string'&&candidates.has(canonical(v))))return v;
  const key=canonical(v);
  if(!root&&candidates.has(key)){
   let id=originals.get(key);
   if(id===undefined){id='e'+originals.size;originals.set(key,id);entities[id]=position(v)||typeof v==='string'?v:walk(v,true,strings);}
   return {$entity:id};
  }
  if(isSeenCell(v))return v; // Keep cells together for exact delta/table encoding.
  return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,walk(x,false,strings)]));
 };
 const state=walk(context),q=Object.fromEntries(Object.entries(questions).map(([name,question])=>[name,{...question,criteria:Object.fromEntries(Object.entries(question.criteria).map(([id,v])=>[id,walk(v,false,false)]))}]));
 const choiceTables:Record<string,any>={};
 for(const [name,question] of Object.entries(q)){
  const entries=Object.entries(question.criteria) as [string,any][];
  if(entries.length<32||!entries.every(([,v])=>object(v)&&Object.keys(v).length===2&&typeof v.description==='string'&&Object.hasOwn(v,'value')))continue;
  const descriptions=[...new Set(entries.map(([,v])=>v.description))];
  choiceTables[name]={ids:entries.map(([id])=>id),descriptions,descriptionIndices:entries.map(([,v])=>descriptions.indexOf(v.description)),values:entries.map(([,v])=>v.value)};
  question.criteria=Object.fromEntries(entries.map(([id],i)=>{
   const original=questions[name].criteria[id]?.value,p=original?.position??original;
   // Keep the exact table for metadata, but put action-relevant identity beside
   // the choice ID. Reference-only labels caused order-sensitive selections.
   const label=position(p)?`${typeof original.name==='string'?original.name:name} at (${p.x},${p.y},${p.z})`:`Choice table ${name}, row ${i}`;
   return [id,label];
  }));
 }
 const blockEntries=Object.entries(entities).filter(([,v])=>isSeenCell(v));
 const entityBlocks={ids:blockEntries.map(([id])=>id),values:blockEntries.map(([,v])=>v)};
 for(const [id]of blockEntries)delete entities[id];
 return jevLosslessRequest({...state,choiceTables,entityBlocks,entityTable:entities,referenceContract:'choiceTables stores exact question options: ids and values use the same row index; descriptionIndices indexes descriptions. Choose the original option ID, not the row number. entityBlocks pairs ids with values by row. Every {$entity:id} refers to the exact value (object or text) in entityTable, shared by observation and question arguments. Resolve references before choosing. IDs are not rankings. Only supplied choices can be returned.'},q);
}
export function decodeReferenceRequest(state:any,questions:any){
 const decoded=decodeJevState(state),{entityTable,entityBlocks,choiceTables,referenceContract,...context}=decoded;
 if(!entityTable)return {context:decoded,questions:decodeJevQuestions(questions)};
 if(entityBlocks)entityBlocks.ids.forEach((id:string,i:number)=>{entityTable[id]=entityBlocks.values[i];});
 const restored=decodeJevQuestions(questions);
 for(const [name,t] of Object.entries(choiceTables??{}) as [string,any][]) {
  for(let i=0;i<t.ids.length;i++)restored[name].criteria[t.ids[i]]={description:t.descriptions[t.descriptionIndices[i]],value:t.values[i]};
 }
 const walk=(v:any,ancestors=new Set<string>()):any=>{
  if(Array.isArray(v))return v.map(x=>walk(x,ancestors));if(!object(v))return v;
  if(Object.keys(v).length===1&&typeof v.$entity==='string'){
   if(!Object.hasOwn(entityTable,v.$entity)||ancestors.has(v.$entity))throw Error('Invalid entity reference');
   return walk(entityTable[v.$entity],new Set([...ancestors,v.$entity]));
  }
  return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,walk(x,ancestors)]));
 };
 return {context:walk(context),questions:walk(restored)};
}
