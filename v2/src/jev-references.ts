import {createHash} from 'node:crypto';
import {jevLosslessRequest,decodeJevState,decodeJevQuestions} from './jev-state.js';
const object=(v:any)=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const position=(v:any)=>object(v)&&Object.keys(v).length===3&&['x','y','z'].every(k=>Number.isFinite(v[k]));
const canonical=(v:any):string=>JSON.stringify(v,(_k,x)=>object(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
// Request-local exact references. No candidates are ranked, shortened or replaced.
export function referenceRequest(context:Record<string,any>,questions:Record<string,any>){
 const candidates=new Set<string>();
 for(const q of Object.values(questions))for(const v of Object.values(q.criteria??{}) as any[]){
  if(object(v)&&object(v.value))candidates.add(canonical(v.value));
  if(object(v)&&Array.isArray(v.values))for(const x of v.values)if(object(x))candidates.add(canonical(x));
 }
 const entities:Record<string,any>={},originals=new Map<string,string>();
 const walk=(v:any,root=false):any=>{
  if(Array.isArray(v))return v.map(x=>walk(x));
  if(!object(v))return v;
  const key=canonical(v);
  if(!root&&(position(v)||candidates.has(key))){
   const id='e_'+createHash('sha256').update(key).digest('hex').slice(0,16);
   if(originals.has(id)&&originals.get(id)!==key)throw Error('Reference collision');
   if(!originals.has(id)){originals.set(id,key);entities[id]=position(v)?v:walk(v,true);}
   return {$entity:id};
  }
  return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,walk(x)]));
 };
 const state=walk(context),q=walk(questions);
 return jevLosslessRequest({...state,entityTable:entities,referenceContract:'Every {$entity:id} refers to the exact object in entityTable, shared by observation and question arguments. Resolve references before choosing. IDs are not rankings. Only supplied choices can be returned.'},q);
}
export function decodeReferenceRequest(state:any,questions:any){
 const decoded=decodeJevState(state),{entityTable,referenceContract,...context}=decoded;
 if(!entityTable)return {context:decoded,questions:decodeJevQuestions(questions)};
 const walk=(v:any,ancestors=new Set<string>()):any=>{
  if(Array.isArray(v))return v.map(x=>walk(x,ancestors));if(!object(v))return v;
  if(Object.keys(v).length===1&&typeof v.$entity==='string'){
   if(!Object.hasOwn(entityTable,v.$entity)||ancestors.has(v.$entity))throw Error('Invalid entity reference');
   return walk(entityTable[v.$entity],new Set([...ancestors,v.$entity]));
  }
  return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,walk(x,ancestors)]));
 };
 return {context:walk(context),questions:walk(decodeJevQuestions(questions))};
}
