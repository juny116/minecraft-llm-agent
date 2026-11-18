import type {Snapshot} from './types.js';
import {workBlocks} from './types.js';
import {isBed} from './beds.js';

// Survival-relevant possessions and time in one place for the goal and task layers. In FREE1 the goal layer had
// minutesUntilNight but spent the first day exploring with only logs, and met night unarmed and unsheltered.
const TOOL=/^(wooden|stone|iron|golden|diamond|netherite)_(pickaxe|axe|shovel|hoe|sword)$/;
export function readinessFacts(s:Snapshot){
 const count=(pred:(n:string)=>boolean)=>(s.inventory??[]).filter(i=>pred(i.name)).reduce((n,i)=>n+i.count,0);
 const tools:Record<string,string[]>={};
 for(const i of s.inventory??[]){const m=TOOL.exec(i.name);if(m)(tools[m[2]]??=[]).includes(m[1])||tools[m[2]].push(m[1]);}
 const edible=new Set(s.edibleItems??[]);
 const beds=[...workBlocks(s).filter(b=>isBed(b.name)).map(b=>b.position),...(s.importantPlaces??[]).filter(p=>/bed/i.test(p.label)).map(p=>p.position)];
 return {time:s.time??null,health:s.health,food:s.food,
  weaponsAndTools:tools,armorWorn:(s.equipment??[]).filter(e=>['head','chest','legs','feet'].includes(e.slot)).map(e=>e.name),
  ...(s.respawnPoint?{respawnPoint:s.respawnPoint}:{}),foodItems:count(n=>edible.has(n)),bedsCarried:count(isBed),knownBeds:beds.slice(0,3),placeableBlocks:(s.placeableItems??[]).length?count(n=>(s.placeableItems??[]).includes(n)&&!isBed(n)):0,
  meaning:'Current time and survival-relevant possessions: tools and weapons by type and material, worn armor, food items, beds carried or known. Facts, not a recommendation.'};
}
