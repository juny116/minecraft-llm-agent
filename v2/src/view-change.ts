import type {Snapshot} from './types.js';

// Comparing two observed views is not proof that a block has never been seen before.
export function viewChange(before:Snapshot,after:Snapshot){
 if(!before.vision||!after.vision)return undefined;
 const degrees=(r:number)=>r*180/Math.PI;
 const camera=(s:Snapshot)=>({yawDegrees:((degrees(s.vision!.yaw)%360)+360)%360,pitchDegrees:degrees(s.vision!.pitch)});
 const a=camera(before),b=camera(after);
 const keys=(s:Snapshot)=>new Set(s.vision!.blocks.map(block=>JSON.stringify([block.name,block.position.x,block.position.y,block.position.z])));
 const old=keys(before),now=keys(after);
 return {camera:{before:a,after:b,yawDeltaDegrees:((b.yawDegrees-a.yawDegrees+540)%360)-180,pitchDeltaDegrees:b.pitchDegrees-a.pitchDegrees},visibleBlocks:{beforeCount:old.size,afterCount:now.size,enteredCount:[...now].filter(k=>!old.has(k)).length,leftCount:[...old].filter(k=>!now.has(k)).length},meaning:'Observed view change during this action, not guaranteed world discovery or task completion.'};
}
