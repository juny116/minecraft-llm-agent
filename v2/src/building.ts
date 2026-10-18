import type {Position} from './vision.js';
export type BuildRequest={item:string;position:Position;reference:Position};
export type DigRequest={position:Position;expected:string;maxMs?:number;keepTool?:boolean;tool?:string;toolSlot?:number};
export const sameCell=(a:Position,b:Position)=>a.x===b.x&&a.y===b.y&&a.z===b.z;
export function validCell(p:Position){return !!p&&[p.x,p.y,p.z].every(Number.isSafeInteger)&&Math.abs(p.x)<=30000000&&Math.abs(p.z)<=30000000&&p.y>=-64&&p.y<=319;}
// Ordinary construction materials; special multi-block, falling, fluid and interactive placements need separate executors.
export function buildingMaterial(name:string){return /^(dirt|grass_block|cobblestone|mossy_cobblestone|stone|andesite|diorite|granite|polished_(andesite|diorite|granite)|deepslate|cobbled_deepslate|bricks|stone_bricks|mossy_stone_bricks|cracked_stone_bricks|deepslate_bricks|deepslate_tiles|sandstone|red_sandstone|smooth_stone|smooth_sandstone|smooth_red_sandstone|glass|terracotta|obsidian|netherrack|nether_bricks|end_stone|end_stone_bricks|quartz_block|smooth_quartz|prismarine|dark_prismarine|prismarine_bricks|calcite|tuff|mud_bricks|packed_mud|snow_block|clay|bookshelf|crafting_table|chest|furnace|blast_furnace|smoker|[a-z_]+_(planks|log|wood|stem|hyphae|wool|concrete|terracotta|stained_glass)|(?:iron|gold|diamond|emerald|copper|coal|lapis|redstone|netherite)_block)$/.test(name);}
export function validateBuild(r:BuildRequest){
 if(!r||!buildingMaterial(r.item))throw Error('Invalid block placement: choose a supported ordinary solid block item');
 if(!validCell(r.position)||!validCell(r.reference))throw Error('Invalid block placement: position and reference must be integer block cells within world bounds');
 if(Math.abs(r.position.x-r.reference.x)+Math.abs(r.position.y-r.reference.y)+Math.abs(r.position.z-r.reference.z)!==1)throw Error('Invalid block placement: position is the empty destination; reference must be a DIFFERENT solid block sharing one face (Manhattan distance 1)');
}
export function validateDig(r:DigRequest){if(!r||(r.toolSlot!==undefined&&(!Number.isInteger(r.toolSlot)||r.toolSlot<9||r.toolSlot>44))||(r.maxMs!==undefined&&(!Number.isInteger(r.maxMs)||r.maxMs<1000||r.maxMs>120000))||(r.tool!==undefined&&!/^[a-z0-9_]+$/.test(r.tool))||!validCell(r.position)||typeof r.expected!=='string'||!/^[a-z0-9_]+$/.test(r.expected)||['air','cave_air','void_air','water','lava','bedrock'].includes(r.expected))throw Error('Invalid block removal');}
export function overlapsCell(cell:Position,p:Position,width=.6,height=1.8){return p.x+width/2>cell.x&&p.x-width/2<cell.x+1&&p.z+width/2>cell.z&&p.z-width/2<cell.z+1&&p.y+height>cell.y&&p.y<cell.y+1;}

export function supportsFeet(cell:Position,feet:Position){return cell.y<feet.y&&cell.y+1>=feet.y-.1&&overlapsCell(cell,{x:feet.x,y:cell.y,z:feet.z});}

// Placement is allowed on observed ordinary solid materials, including leaf canopies.
// Actual collision, air clearance and entity overlap are checked again by the executor.
export function tableSupportMaterial(name:string){return name==='bedrock'||name!=='chest'&&buildingMaterial(name)||/^[a-z_]+_leaves$/.test(name);}
