import {localDomain,cellCenter,cellKey} from './local-domain.js';
import type {Snapshot} from './types.js';
import {key,type SeenBlock,type Position} from './vision.js';
export type Rect={x:[number,number];y:number;z:[number,number]};
// Exact rectangles on horizontal layers. No bounding-box filling across holes.
export function rectangles(points:Position[]):Rect[]{
 const layers=new Map<number,Set<string>>();
 for(const p of points){if(!layers.has(p.y))layers.set(p.y,new Set());layers.get(p.y)!.add(`${p.x},${p.z}`);}
 const result:Rect[]=[];
 for(const [y,cells] of [...layers].sort((a,b)=>a[0]-b[0])){
  const ordered=[...cells].map(s=>s.split(',').map(Number)).sort((a,b)=>a[1]-b[1]||a[0]-b[0]);
  for(const [x,z] of ordered){if(!cells.has(`${x},${z}`))continue;let endX=x,endZ=z;
   while(cells.has(`${endX+1},${z}`))endX++;
   outer:while(true){for(let xx=x;xx<=endX;xx++)if(!cells.has(`${xx},${endZ+1}`))break outer;endZ++;}
   for(let zz=z;zz<=endZ;zz++)for(let xx=x;xx<=endX;xx++)cells.delete(`${xx},${zz}`);
   result.push({x:[x,endX],y,z:[z,endZ]});
  }
 }
 return result;
}
export function rectCells(r:Rect):Position[]{const out:Position[]=[];for(let z=r.z[0];z<=r.z[1];z++)for(let x=r.x[0];x<=r.x[1];x++)out.push({x,y:r.y,z});return out;}
export function terrainAreas(blocks:SeenBlock[],current:Set<string>){
 const groups=new Map<string,SeenBlock[]>();
 for(const b of blocks){const id=JSON.stringify([b.name,b.lastSeen,current.has(key(b.position))]);if(!groups.has(id))groups.set(id,[]);groups.get(id)!.push(b);}
 return [...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0])).flatMap(([id,bs])=>{const [block,lastObservedAt,isCurrent]=JSON.parse(id);return rectangles(bs.map(b=>b.position)).map(cells=>({block,lastObservedAt,source:isCurrent?'current_observation':'past_observation',cells}));});
}
// Placement scope is current local observation, independent of overview compression.
export function placementDomain(s:Snapshot){
 const visible=new Set(s.vision?.blocks.map(b=>key(b.position))??[]);
 // Same target with multiple observed support faces is one placement. Canonical
 // face selection resolves equivalent geometry, never chooses the target.
 const sites=[...(s.placementSites??[])].filter(site=>s.perception?.mode!=='panorama'||visible.has(key(site.reference)))
  .sort((a,b)=>cellKey(a.reference).localeCompare(cellKey(b.reference)));
 return localDomain(sites,{...s.position,y:s.position.y+1.62},v=>cellCenter(v.position),v=>cellKey(v.position));
}
export function localPlacementSites(s:Snapshot){return s.perception?.mode==='panorama'?placementDomain(s).values:s.placementSites??[];}
export function placementRegions(s:Snapshot){
 const observed=new Map(s.vision?.blocks.map(b=>[key(b.position),b.name])??[]);
 const groups=new Map<string,NonNullable<Snapshot['placementSites']>>();
 for(const site of localPlacementSites(s)){const offset={x:site.position.x-site.reference.x,y:site.position.y-site.reference.y,z:site.position.z-site.reference.z};const id=JSON.stringify([observed.get(key(site.reference))??'unknown',offset]);if(!groups.has(id))groups.set(id,[]);groups.get(id)!.push(site);}
 return [...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0])).flatMap(([id,sites])=>{const [supportBlock,targetOffsetFromSupport]=JSON.parse(id);return rectangles(sites.map(p=>p.position)).map(cells=>({supportBlock,targetOffsetFromSupport,targetCells:cells}));}).map((g,i)=>({id:`placement-${i}`, ...g}));
}
export function regionSite(g:ReturnType<typeof placementRegions>[number],p:Position){return {position:p,reference:{x:p.x-g.targetOffsetFromSupport.x,y:p.y-g.targetOffsetFromSupport.y,z:p.z-g.targetOffsetFromSupport.z}};}
