import pathfinderPackage from 'mineflayer-pathfinder';
import type {Bot} from 'mineflayer';
import type {PlaceMemory} from './vision.js';
const {Movements}=pathfinderPackage;
// Exclusion callbacks also run on head-clearance cells. Filter actual landing
// nodes instead; the upstream collision checks still reject blocked geometry.
export function observedMovements(bot:Bot,memory:PlaceMemory){
 const movement=new Movements(bot),neighbors=movement.getNeighbors.bind(movement);
 movement.maxDropDown=4;movement.canDig=false;movement.allow1by1towers=false;movement.allowParkour=false;
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

// A pickup can succeed from an adjacent standing cell. The item cell may have
// insufficient headroom; upstream pathfinding still checks the standing cell.
export class PickupGoal extends pathfinderPackage.goals.GoalNear {
 constructor(private item:{x:number;y:number;z:number}){super(Math.floor(item.x),Math.floor(item.y),Math.floor(item.z),1);}
 isEnd(node:{x:number;y:number;z:number}){
  return Math.abs(node.x+.5-this.item.x)<=1.2&&Math.abs(node.z+.5-this.item.z)<=1.2&&this.item.y-node.y>=-.4&&this.item.y-node.y<=1.8;
 }
 heuristic(node:any){return Math.max(0,super.heuristic(node)-3);}
}

// Fallback when no route exists over observed supports (for example at the bottom of a dug shaft): the same
// movement may dig and pillar with dirt/cobblestone. Used only after the normal search failed.
export function escapeMovements(bot:Bot,protectedCell:(p:{x:number;y:number;z:number})=>boolean){
 const movement=new Movements(bot);
 movement.maxDropDown=4;movement.canDig=true;movement.allow1by1towers=true;movement.allowParkour=false;movement.allowFreeMotion=false;
 const keep=/^(chest|barrel|furnace|blast_furnace|smoker|crafting_table|.*_bed|.*_door)$/;
 // Workstations, containers, beds and doors are never broken; own placed blocks only cost more, so a bot sealed
 // inside its own shelter (CONT1: Alice never moved in 40 min) can still break out when no other way exists.
 movement.exclusionAreasBreak=[(b:any)=>keep.test(b.name)?100:protectedCell(b.position)?20:0];
 return movement;
}
