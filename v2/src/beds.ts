import type {Position} from './vision.js';
export const bedFacings=['north','east','south','west'] as const;
export type BedFacing=typeof bedFacings[number];
export const isBed=(name:string)=>/^(white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)_bed$/.test(name);
export function bedHead(p:Position,facing:BedFacing):Position {
 const d={north:[0,-1],east:[1,0],south:[0,1],west:[-1,0]}[facing];
 if(!d)throw Error('Bed placement requires a cardinal facing');
 return {x:p.x+d[0],y:p.y,z:p.z+d[1]};
}
export const bedYaw=(f:BedFacing)=>({north:0,east:-Math.PI/2,south:Math.PI,west:Math.PI/2}[f]);
export const RESPAWN_SET_RESULT='Respawn point set to this bed; sleeping is possible only at night or during thunder';
export const BED_CAPABILITY='place_block supports beds: position is the foot cell, facing points from foot to head, two adjacent empty cells with visible floor support are required. The model chooses facing; no alternative site is automatically selected. sleep selects an observed nearby bed, approaches it, and attempts sleeping until waking or interruption. Sleeping requires the Overworld, night or thunder, an unoccupied bed and server permission. In daytime sleep uses the bed instead: the server sets your respawn point to it (recorded as partial). Daytime failure does not mean the bed is broken. Only actual sleep is recorded as success. animals lists visible passive animals; attack may target them for hunting using held equipment, with no automatic pickup or guaranteed drops. Shearing is not implemented.';
