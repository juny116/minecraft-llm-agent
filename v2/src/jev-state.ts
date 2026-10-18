// A minified JSON string preserves all field names and values without provider-side
// pretty-print expansion. It is not a summary or a relevance filter.
export function encodeJevState(state:any):string{return JSON.stringify(state);}
export function decodeJevState(state:any){
 if(typeof state==='string'){try{state=JSON.parse(state);}catch{return state;}}
 if(state?.__jevEncoding?.format===TABLE_FORMAT){
  const {__jevEncoding,...data}=state;
  if(Object.hasOwn(__jevEncoding,'originalMarker'))data.__jevEncoding=__jevEncoding.originalMarker;
  return decodeTables(data);
 }
 return state;
}

export function jevStateForRequest(state:any,questions:unknown){
 // Preserve native structure for small requests. Large requests use the exact
 // same JSON values as minified text, avoiding server serialization expansion.
 return Buffer.byteLength(JSON.stringify({state,questions}))>28000?encodeJevState(state):state;
}
import {encodeTables,decodeTables,encodeCriterion,decodeCriterion,TABLE_FORMAT,TABLE_SCHEMA} from './jev-table-codec.js';

export function jevLosslessRequest(state:Record<string,unknown>,questions:Record<string,any>){
 const encoded=encodeTables(state);
 const metadata={format:TABLE_FORMAT,schema:TABLE_SCHEMA,...(Object.hasOwn(encoded,'__jevEncoding')?{originalMarker:encoded.__jevEncoding}:{})};
 const compactQuestions=Object.fromEntries(Object.entries(questions).map(([key,q])=>[key,{...q,criteria:Object.fromEntries(Object.entries(q.criteria).map(([id,value])=>[id,encodeCriterion(value)]))}]));
 return {state:jevStateForRequest({...encoded,__jevEncoding:metadata},compactQuestions),questions:compactQuestions};
}
export function decodeJevQuestions(questions:Record<string,any>){return Object.fromEntries(Object.entries(questions).map(([key,q])=>[key,{...q,criteria:Object.fromEntries(Object.entries(q.criteria).map(([id,value])=>[id,decodeCriterion(value)]))}]));}
