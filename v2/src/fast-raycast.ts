import type {Position} from './vision.js';

export type CellShape={name:string;shapes:number[][]};
// Same traversal and shape intersection as prismarine-world's raycast, but cells are looked up through a
// caller-supplied cache instead of constructing a Block for every cell along the ray.
// lookup returns null for an unloaded cell, which the ray passes through like prismarine does.
export function fastRaycast(from:Position,dir:Position,range:number,lookup:(x:number,y:number,z:number)=>CellShape|null):{name:string;position:Position}|null{
 const inv=(d:number)=>d===0?Number.MAX_VALUE:1/d,delta=(d:number)=>d===0?Number.MAX_VALUE:Math.abs(1/d);
 const invX=inv(dir.x),invY=inv(dir.y),invZ=inv(dir.z),stepX=Math.sign(dir.x),stepY=Math.sign(dir.y),stepZ=Math.sign(dir.z);
 const dX=delta(dir.x),dY=delta(dir.y),dZ=delta(dir.z);
 let x=Math.floor(from.x),y=Math.floor(from.y),z=Math.floor(from.z);
 let tX=dir.x===0?Number.MAX_VALUE:Math.abs((x+(dir.x>0?1:0)-from.x)/dir.x),tY=dir.y===0?Number.MAX_VALUE:Math.abs((y+(dir.y>0?1:0)-from.y)/dir.y),tZ=dir.z===0?Number.MAX_VALUE:Math.abs((z+(dir.z>0?1:0)-from.z)/dir.z);
 for(;;){
  const cell=lookup(x,y,z);
  if(cell){
   const px=from.x-x,py=from.y-y,pz=from.z-z;
   for(const s of cell.shapes){
    let tmin=(s[invX>0?0:3]-px)*invX,tmax=(s[invX>0?3:0]-px)*invX;
    const tymin=(s[invY>0?1:4]-py)*invY,tymax=(s[invY>0?4:1]-py)*invY;
    if(tmin>tymax||tymin>tmax)continue;
    if(tymin>tmin)tmin=tymin;if(tymax<tmax)tmax=tymax;
    const tzmin=(s[invZ>0?2:5]-pz)*invZ,tzmax=(s[invZ>0?5:2]-pz)*invZ;
    if(tmin>tzmax||tzmin>tmax)continue;
    return {name:cell.name,position:{x,y,z}};
   }
  }
  if(Math.min(tX,tY,tZ)>range)return null;
  if(tX<tY){if(tX<tZ){x+=stepX;tX+=dX;}else{z+=stepZ;tZ+=dZ;}}
  else if(tY<tZ){y+=stepY;tY+=dY;}else{z+=stepZ;tZ+=dZ;}
 }
}
