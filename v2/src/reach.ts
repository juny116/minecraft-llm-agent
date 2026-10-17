import type {Position} from './vision.js';
// Match pathfinder GoalNear exactly, including negative coordinates.
export function reachedCell(position:Position,target:Position,radius:number){
 return Math.hypot(Math.floor(position.x)-Math.floor(target.x),Math.floor(position.y)-Math.floor(target.y),Math.floor(position.z)-Math.floor(target.z))<=radius;
}
