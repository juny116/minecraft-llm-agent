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
