import pathfinderPackage from 'mineflayer-pathfinder';
import type {Bot} from 'mineflayer';
import type {PlaceMemory} from './vision.js';
const {Movements}=pathfinderPackage;
// Exclusion callbacks also run on head-clearance cells. Filter actual landing
// nodes instead; the upstream collision checks still reject blocked geometry.
export function observedMovements(bot:Bot,memory:PlaceMemory){
 const movement=new Movements(bot),neighbors=movement.getNeighbors.bind(movement);
 movement.canDig=false;movement.allow1by1towers=false;movement.allowParkour=false;
 movement.allowFreeMotion=false;movement.scafoldingBlocks=[];
 movement.getNeighbors=node=>neighbors(node).filter(next=>memory.hasSupport(next));
 return movement;
}


// Affordance hints, not a map oracle or an automatic destination selector.
// Every returned cell comes from prior direct observation; reachability is a local motor check.
export function localNavigationTargets(position:import('./vision.js').Position,observed:import('./vision.js').SeenBlock[],reachable:(p:import('./vision.js').Position)=>boolean){
 const candidates=observed.filter(b=>!['air','cave_air','void_air','water','lava'].includes(b.name)&&Math.abs(b.position.y-position.y)<=4)
  .filter(b=>{const d=Math.hypot(b.position.x-position.x,b.position.y-position.y,b.position.z-position.z);return d>=4&&d<=10;})
  .sort((a,b)=>Math.abs(a.position.y-position.y)-Math.abs(b.position.y-position.y)||Math.hypot(a.position.x-position.x,a.position.z-position.z)-Math.hypot(b.position.x-position.x,b.position.z-position.z));
 const out:import('./vision.js').Position[]=[],sectors=new Set<number>(),attempts=new Map<number,number>();let checked=0;
 for(const b of candidates){const sector=Math.floor((Math.atan2(b.position.z-position.z,b.position.x-position.x)+Math.PI)/(Math.PI/2))%4;
  if(sectors.has(sector)||(attempts.get(sector)??0)>=2)continue;attempts.set(sector,(attempts.get(sector)??0)+1);if(checked++>=8)break;
  if(reachable(b.position)){out.push({...b.position});sectors.add(sector);}if(out.length===4)break;
 }
 return out;
}
