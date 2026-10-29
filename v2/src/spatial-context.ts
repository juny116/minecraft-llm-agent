import {terrainAreas,placementRegions,rectCells} from './map-regions.js';
import type {Snapshot} from './types.js';
import {key,type SeenBlock,type Position} from './vision.js';
export const SPATIAL={detailRadius:12,localRadius:48,sectors:8,nearRows:256};
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
function fullSpatialContext(s:Snapshot){
 const visible=new Set(s.vision?.blocks.map(b=>key(b.position))??[]);
 const near=localTerrain(s).filter(b=>distance(b.position,{...s.position,y:s.position.y+1.62})<=SPATIAL.detailRadius);
 const areas=terrainAreas(near,visible);
 return {mode:'automatic_occluded_panorama',dimension:s.dimension,feetPosition:s.position,detailRadius:12,summaryRadius:48,
  coordinateRules:'Integer block cells; x east, z south, y up. Inclusive ranges contain exactly the listed cells, not a filled volume between separate regions.',
  near:{names:[...new Set(near.map(b=>b.name))],total:near.length,omitted:0,
   currentObservation:areas.filter(a=>a.source==='current_observation'),rememberedTerrain:areas.filter(a=>a.source==='past_observation'),
   meaning:'Exact observed block cells grouped losslessly by material, layer and observation time. A block cell is not a full collision cube. Unlisted space is unknown; no air or walking clearance is implied.'},
  regions:terrainRegions(s).map(g=>({id:g.id,direction:g.direction,distanceBand:g.band,observedCells:g.points.length,currentCells:g.current,lastSeen:Math.max(...g.points.map(b=>b.lastSeen)),materials:[...new Set(g.points.map(b=>b.name))].sort()})),
  occludedSpace:{sampledAxisRays:s.perception?.occlusion??[],meaning:'A first-hit surface hides farther points on that sightline only. A null ray does not establish an empty sector.'},
  interactionGeometry:{placement:placementRegions(s),meaning:'Exact currently observed empty target cells and supporting blocks; reference=target-targetOffsetFromSupport. Regions do not fill holes. No route or placement success is guaranteed. Work includes approach and revalidation.'},
  sources:{importantPlaces:'Supplied separately with observation times; remembered existence is not current proof.',playerReports:'Supplied in dialogue/messages with attribution; not promoted to observed terrain.'},
  meaning:'Near surfaces are inspected per block with occlusion; distant surfaces are sampled and summarized, not exhaustive. Historical cells may have changed. Remote ordinary terrain stays on disk; local context does not grow with journey length.'};
}

// UTF-8 bytes conservatively bound tokenizer input; target domains stay on Snapshot.
export const MAP_INPUT_BYTES=16000;
export function boundedSpatialContext(raw:ReturnType<typeof fullSpatialContext>){
 const size=(x:unknown)=>Buffer.byteLength(JSON.stringify(x));
 if(size(raw)<=MAP_INPUT_BYTES)return raw;
 const all=[...raw.near.currentObservation,...raw.near.rememberedTerrain];
 const placementCount=raw.interactionGeometry.placement.reduce((n,g)=>n+rectCells(g.targetCells).length,0);
 for(const radius of [3,2,1,0]){
  const areas=all.flatMap(a=>{
   const cells=rectCells(a.cells).filter(p=>Math.hypot(p.x+.5-raw.feetPosition.x,p.y+.5-raw.feetPosition.y-1.62,p.z+.5-raw.feetPosition.z)<=radius);
   return terrainAreas(cells.map(position=>({name:a.block,position,lastSeen:a.lastObservedAt})),new Set(a.source==='current_observation'?cells.map(key):[]));
  });
  const detailed=areas.reduce((n,a)=>n+rectCells(a.cells).length,0);
  const next={...raw,detailRadius:radius,
   near:{...raw.near,names:[...new Set(areas.map(a=>a.block))],omitted:raw.near.total-detailed,currentObservation:areas.filter(a=>a.source==='current_observation'),rememberedTerrain:areas.filter(a=>a.source==='past_observation'),meaning:'Exact cells only inside detailRadius. Other observed cells are summarized in regions, not absent. Only targets inside each current actionScopes radius are available as individual action arguments; other known terrain remains in this map. Unlisted space is unknown, never implied clear.'},
   interactionGeometry:{placement:[],meaning:`${placementCount} observed placement sites inside the current local selection scope. Choose place_block to select an exact site; approach and revalidation are included. No path is guaranteed.`},
   meaning:'Bounded map overview. Coarse regions summarize observations only, NOT filled volumes or certified routes. Detailed target domains remain available in action argument selection; summary does not remove targets. Past observations may be stale.'};
  if(size(next)<=MAP_INPUT_BYTES)return next;
  // If even material lists exceed the budget, preserve every sector and counts;
  // material identity remains in the hierarchical argument domains, not a top-k list.
  const coarse={...next,regions:next.regions.map(g=>({...g,materials:[],materialKinds:g.materials.length,materialDetail:'Available through action argument groups; no material was excluded from the domain.'}))};
  if(size(coarse)<=MAP_INPUT_BYTES)return coarse;
 }
 throw Error('Map overview exceeded fixed byte budget');
}
export function spatialContext(s:Snapshot){return boundedSpatialContext(fullSpatialContext(s));}
