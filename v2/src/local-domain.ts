import type {Position} from './vision.js';
export const ARGUMENT_LIMIT=254; // Leave room for an explicit withdrawal in comparison contracts.
export const LOCAL_ACTION_RADIUS=12;
export function localDomain<T>(values:T[],origin:Position,point:(v:T)=>Position,identity:(v:T)=>string,maxRadius=LOCAL_ACTION_RADIUS){
 const unique=[...new Map(values.map(v=>[identity(v),v])).values()];
 const distances=unique.map(v=>({v,d:Math.hypot(point(v).x-origin.x,point(v).y-origin.y,point(v).z-origin.z)}));
 let radius=maxRadius,inside=distances.filter(x=>x.d<=radius);
 // Whole radius shells only: no goal-, material-, direction- or score-based shortlist.
 while(inside.length>ARGUMENT_LIMIT&&radius>0){radius=Math.max(0,radius-1);inside=distances.filter(x=>x.d<=radius);}
 if(inside.length>ARGUMENT_LIMIT)throw Error('Invalid local domain: too many co-located identities');
 return {values:inside.map(x=>x.v),outside:distances.filter(x=>x.d>radius).map(x=>x.v),scope:{radiusBlocks:radius,maxRadiusBlocks:maxRadius,origin,eligibleCount:inside.length,knownCount:unique.length,outsideCount:unique.length-inside.length,limit:ARGUMENT_LIMIT}};
}
export const cellCenter=(p:Position)=>({x:p.x+.5,y:p.y+.5,z:p.z+.5});
export const cellKey=(p:Position)=>`${p.x},${p.y},${p.z}`;
