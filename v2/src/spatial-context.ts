import type {Snapshot} from './types.js';
import {key,type SeenBlock,type Position} from './vision.js';
export const SPATIAL={detailRadius:8,localRadius:48,sectors:8,nearRows:256};
const distance=(p:Position,o:Position)=>Math.hypot(p.x+.5-o.x,p.y+.5-o.y,p.z+.5-o.z);
export function localTerrain(s:Snapshot){
 const blocks=new Map<string,SeenBlock>();
 for(const b of [...s.places??[],...s.vision?.blocks??[]])if(distance(b.position,s.position)<=SPATIAL.localRadius)blocks.set(key(b.position),b);
 return [...blocks.values()];
}
export function terrainRegions(s:Snapshot){
 const visible=new Set(s.vision?.blocks.map(b=>key(b.position))??[]),groups=new Map<string,{id:string;direction:string;band:string;points:SeenBlock[];current:number}>();
 const directions=['east','southeast','south','southwest','west','northwest','north','northeast'];
 for(const b of localTerrain(s)){
  if(['air','cave_air','void_air'].includes(b.name))continue;
  const d=distance(b.position,s.position),sector=Math.floor((Math.atan2(b.position.z+.5-s.position.z,b.position.x+.5-s.position.x)+Math.PI*2+Math.PI/8)%(Math.PI*2)/(Math.PI/4));
  const band=d<=8?'0-8':d<=24?'8-24':'24-48',id=band+':'+sector;
  if(!groups.has(id))groups.set(id,{id,direction:directions[sector],band,points:[],current:0});
  const g=groups.get(id)!;g.points.push(b);if(visible.has(key(b.position)))g.current++;
 }
 return [...groups.values()].sort((a,b)=>a.id.localeCompare(b.id));
}
export function spatialContext(s:Snapshot){
 const visible=new Set(s.vision?.blocks.map(b=>key(b.position))??[]);
 const near=localTerrain(s).filter(b=>distance(b.position,s.position)<=SPATIAL.detailRadius).sort((a,b)=>distance(a.position,s.position)-distance(b.position,s.position)||key(a.position).localeCompare(key(b.position)));
 const selected=near.slice(0,SPATIAL.nearRows),origin={x:Math.floor(s.position.x),y:Math.floor(s.position.y),z:Math.floor(s.position.z)},timeBase=selected.length?Math.max(...selected.map(b=>b.lastSeen)):0,names=[...new Set(selected.map(b=>b.name))];
 return {mode:'automatic_occluded_panorama',detailRadius:8,summaryRadius:48,
  near:{origin,timeBase,names,rows:selected.map(b=>[b.position.x-origin.x,b.position.y-origin.y,b.position.z-origin.z,names.indexOf(b.name),b.lastSeen-timeBase,visible.has(key(b.position))?1:0]),total:near.length,omitted:near.length-selected.length,encoding:'[dx,dy,dz,nameIndex,timeDeltaMs,current]. Exact position=origin+[dx,dy,dz], lastSeen=timeBase+timeDeltaMs. Closest 256 exact cells; all other observed cells remain available through region argument selection. Missing cells are unknown, not empty.'},
  regions:terrainRegions(s).map(g=>({id:g.id,direction:g.direction,distanceBand:g.band,observedCells:g.points.length,currentCells:g.current,lastSeen:Math.max(...g.points.map(b=>b.lastSeen)),materials:[...new Set(g.points.map(b=>b.name))].sort()})),
  meaning:'First-hit surfaces from automatic surrounding observation, not x-ray or complete terrain. Historical cells retain their observation time and may have changed. Regions summarize observed cells only: no filled volume, inferred connectivity or safety. Select a region to receive its exact action targets. Remote ordinary terrain stays on disk; local context does not grow with journey length.'};
}
