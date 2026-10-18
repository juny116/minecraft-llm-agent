// Lossless transport encoding, never a relevance filter. Object keys and values
// are restored by decodeTables; criteria retain their original answer keys.
const TABLE='$jev_table',OBJECT='$jev_object',PREFIX='JEV_JSON:';
const object=(v:any):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const bytes=(v:unknown)=>Buffer.byteLength(JSON.stringify(v));
const set=(o:Record<string,any>,k:string,v:any)=>Object.defineProperty(o,k,{value:v,enumerable:true,writable:true,configurable:true});
function leaves(value:Record<string,any>,path:string[]=[],out:{path:string[];value:any}[]=[]){
 for(const k of Object.keys(value).sort()){
  const child=value[k],next=[...path,k];
  if(object(child)&&Object.keys(child).length&&!Object.hasOwn(child,TABLE)&&!Object.hasOwn(child,OBJECT))leaves(child,next,out);
  else out.push({path:next,value:child});
 }
 return out;
}
function encodeJson(value:any):any{
 if(Array.isArray(value)){
  const items=value.map(encodeJson);
  if(items.length<2||!items.every(x=>object(x)&&Object.keys(x).length&&!Object.hasOwn(x,TABLE)&&!Object.hasOwn(x,OBJECT)))return items;
  const flat=items.map(x=>leaves(x)),columns=flat[0].map(x=>x.path),shape=JSON.stringify(columns);
  if(!flat.every(row=>JSON.stringify(row.map(x=>x.path))===shape))return items;
  const table={[TABLE]:{columns,rows:flat.map(row=>row.map(x=>x.value))}};
  return bytes(table)<bytes(items)?table:items;
 }
 if(!object(value))return value;
 const result=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encodeJson(v)]));
 return Object.hasOwn(value,TABLE)||Object.hasOwn(value,OBJECT)?{[OBJECT]:result}:result;
}
export function encodeTables(value:any):any{return value===undefined?undefined:encodeJson(JSON.parse(JSON.stringify(value)));}
export function decodeTables(value:any):any{
 if(Array.isArray(value))return value.map(decodeTables);
 if(!object(value))return value;
 if(Object.keys(value).length===1&&Object.hasOwn(value,OBJECT))return Object.fromEntries(Object.entries(value[OBJECT]).map(([k,v])=>[k,decodeTables(v)]));
 if(Object.keys(value).length===1&&Object.hasOwn(value,TABLE)){
  const {columns,rows}=value[TABLE];
  if(!Array.isArray(columns)||!columns.every((p:any)=>Array.isArray(p)&&p.length&&p.every((k:any)=>typeof k==='string'))||!Array.isArray(rows)||!rows.every((r:any)=>Array.isArray(r)&&r.length===columns.length))throw Error('Invalid JEV table encoding');
  return rows.map((row:any[])=>{
   const restored:Record<string,any>={};
   columns.forEach((path:string[],i:number)=>{let target=restored;for(const part of path.slice(0,-1)){if(!Object.hasOwn(target,part))set(target,part,{});target=target[part];}set(target,path.at(-1)!,decodeTables(row[i]));});
   return restored;
  });
 }
 return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,decodeTables(v)]));
}
export function encodeCriterion(value:any){
 if(object(value)||Array.isArray(value)||typeof value==='string'&&value.startsWith(PREFIX))return PREFIX+JSON.stringify(encodeTables(value));
 return value;
}
export function decodeCriterion(value:any){
 return typeof value==='string'&&value.startsWith(PREFIX)?decodeTables(JSON.parse(value.slice(PREFIX.length))):value;
}
export const TABLE_FORMAT='jev-lossless-tables-v1';
export const TABLE_SCHEMA='Lossless encoding: $jev_table means an array of objects. columns lists property paths; each rows entry supplies the exact values at those paths. $jev_object escapes a literal object. JEV_JSON: criterion descriptions contain minified JSON using the same encoding. No observation, coordinate or choice is removed or preferred.';
