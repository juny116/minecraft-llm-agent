// Lossless transport encoding, never a relevance filter. Object keys and values
// are restored by decodeTables; criteria retain their original answer keys.
const BLOCKS='$jev_blocks',POINTS='$jev_points',TABLE='$jev_table',OBJECT='$jev_object',PREFIX='JEV_JSON:';
const object=(v:any):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const bytes=(v:unknown)=>Buffer.byteLength(JSON.stringify(v));
const set=(o:Record<string,any>,k:string,v:any)=>Object.defineProperty(o,k,{value:v,enumerable:true,writable:true,configurable:true});
function leaves(value:Record<string,any>,path:string[]=[],out:{path:string[];value:any}[]=[]){
 for(const k of Object.keys(value).sort()){
  const child=value[k],next=[...path,k];
  if(object(child)&&Object.keys(child).length&&!Object.hasOwn(child,TABLE)&&!Object.hasOwn(child,OBJECT)&&!Object.hasOwn(child,POINTS)&&!Object.hasOwn(child,BLOCKS))leaves(child,next,out);
  else out.push({path:next,value:child});
 }
 return out;
}
export const isSeenCell=(v:any)=>object(v)&&Object.keys(v).length===3&&typeof v.name==='string'&&Number.isSafeInteger(v.lastSeen)&&object(v.position)&&Object.keys(v.position).length===3&&['x','y','z'].every(k=>Number.isSafeInteger(v.position[k]));
function encodeJson(value:any):any{
 if(Array.isArray(value)){
  if(value.length>1&&value.every(isSeenCell)){
   const origin=[value[0].position.x,value[0].position.y,value[0].position.z],timeBase=value[0].lastSeen,names=[...new Set(value.map(b=>b.name))];
   const rows=value.map(b=>[b.position.x-origin[0],b.position.y-origin[1],b.position.z-origin[2],names.indexOf(b.name),b.lastSeen-timeBase]);
   const packed={[BLOCKS]:{origin,timeBase,names,rows}};if(rows.every(row=>row.every(Number.isSafeInteger))&&bytes(packed)<bytes(value))return packed;
  }
  if(value.length>1&&value.every(p=>object(p)&&Object.keys(p).length===3&&['x','y','z'].every(k=>Number.isSafeInteger(p[k])))){
   const origin=[value[0].x,value[0].y,value[0].z],offsets=value.map(p=>[p.x-origin[0],p.y-origin[1],p.z-origin[2]]);
   const packed={[POINTS]:{origin,offsets}};
   if(offsets.every(p=>p.every(Number.isSafeInteger))&&bytes(packed)<bytes(value))return packed;
  }
  const items=value.map(encodeJson);
  if(items.length<2||!items.every(x=>object(x)&&Object.keys(x).length&&!Object.hasOwn(x,TABLE)&&!Object.hasOwn(x,OBJECT)&&!Object.hasOwn(x,POINTS)&&!Object.hasOwn(x,BLOCKS)))return items;
  const flat=items.map(x=>leaves(x)),columns=flat[0].map(x=>x.path),shape=JSON.stringify(columns);
  if(!flat.every(row=>JSON.stringify(row.map(x=>x.path))===shape))return items;
  const table={[TABLE]:{columns,rows:flat.map(row=>row.map(x=>x.value))}};
  return bytes(table)<bytes(items)?table:items;
 }
 if(!object(value))return value;
 const result=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encodeJson(v)]));
 return Object.hasOwn(value,TABLE)||Object.hasOwn(value,OBJECT)||Object.hasOwn(value,POINTS)||Object.hasOwn(value,BLOCKS)?{[OBJECT]:result}:result;
}
export function encodeTables(value:any):any{return value===undefined?undefined:encodeJson(JSON.parse(JSON.stringify(value)));}
export function decodeTables(value:any):any{
 if(Array.isArray(value))return value.map(decodeTables);
 if(!object(value))return value;
 if(Object.keys(value).length===1&&Object.hasOwn(value,OBJECT))return Object.fromEntries(Object.entries(value[OBJECT]).map(([k,v])=>[k,decodeTables(v)]));
 if(Object.keys(value).length===1&&Object.hasOwn(value,BLOCKS)){
  const {origin,timeBase,names,rows}=value[BLOCKS];
  if(!Array.isArray(origin)||origin.length!==3||!origin.every(Number.isSafeInteger)||!Number.isSafeInteger(timeBase)||!Array.isArray(names)||!names.every((n:any)=>typeof n==='string')||!Array.isArray(rows)||!rows.every((r:any)=>Array.isArray(r)&&r.length===5&&r.every(Number.isSafeInteger)&&r[3]>=0&&r[3]<names.length&&[r[0]+origin[0],r[1]+origin[1],r[2]+origin[2],r[4]+timeBase].every(Number.isSafeInteger)))throw Error('Invalid JEV block encoding');
  return rows.map((r:number[])=>({name:names[r[3]],position:{x:r[0]+origin[0],y:r[1]+origin[1],z:r[2]+origin[2]},lastSeen:r[4]+timeBase}));
 }
 if(Object.keys(value).length===1&&Object.hasOwn(value,POINTS)){
  const {origin,offsets}=value[POINTS];
  if(!Array.isArray(origin)||origin.length!==3||!origin.every(Number.isSafeInteger)||!Array.isArray(offsets)||!offsets.every((p:any)=>Array.isArray(p)&&p.length===3&&p.every(Number.isSafeInteger)&&p.every((n:number,i:number)=>Number.isSafeInteger(n+origin[i]))))throw Error('Invalid JEV point encoding');
  return offsets.map((p:number[])=>({x:p[0]+origin[0],y:p[1]+origin[1],z:p[2]+origin[2]}));
 }
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
export const TABLE_SCHEMA='Lossless encoding: $jev_blocks means observed cells: rows [dx,dy,dz,nameIndex,dt], position=origin+offset, name=names[nameIndex], lastSeen=timeBase+dt. $jev_points means an ordered array of {x,y,z} positions: add each offsets triple to origin [x,y,z]. $jev_table means an array of objects. columns lists property paths; each rows entry supplies the exact values at those paths. $jev_object escapes a literal object. JEV_JSON: criterion descriptions contain minified JSON using the same encoding. No observation, coordinate or choice is removed or preferred.';
