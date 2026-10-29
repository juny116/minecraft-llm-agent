import type {Plan,Snapshot} from './types.js';
import {workBlocks} from './types.js';
import {moveReached} from './action-contracts.js';
import {supportsFeet} from './building.js';

type Position={x:number;y:number;z:number};
// Kinds the executor may navigate to without a remembered block at that exact cell.
export const REFERENCED_DESTINATION_KINDS=['entity','plan_coordinate','chat_coordinate'] as const;
export type MoveTarget={kind:'observed_block'|'remembered_place'|'death_site'|'entity'|'plan_coordinate'|'chat_coordinate'|'scope_edge'|'other_coordinate';
 label:string;position?:Position;distance?:number;source?:string;meaning?:string};

const floor=(p:Position)=>({x:Math.floor(p.x),y:Math.floor(p.y),z:Math.floor(p.z)});
const dist=(a:Position,b:Position)=>+Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z).toFixed(1);
const COORD=/\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?/g;
export function coordinatesIn(text:string){return [...text.matchAll(COORD)].map(m=>floor({x:Number(m[1]),y:Number(m[2]),z:Number(m[3])}));}
const DIRECTIONS=['east','southeast','south','southwest','west','northwest','north','northeast'];
const IGNORED=new Set(['air','cave_air','void_air']);
// Blocks a body can occupy; everything else known is treated as solid.
const PASSABLE=/^(air|cave_air|void_air|water|lava|snow)$|(^|_)(grass|fern|flower|sapling|torch|button|carpet|rail|vine|bush|tulip|orchid|allium|bluet|daisy|poppy|dandelion)$/;
const key=(p:Position)=>`${p.x},${p.y},${p.z}`;
// A target counts as reachable when an observed solid cell within the arrival radius could be stood on:
// nothing known solid in the two cells above, and its top no higher than about half a block above the eyes
// (observations are exposed surfaces; a top face above the eyes, such as a ceiling, was never seen).
export function standingChecker(s:Snapshot){
 const solid=new Set(workBlocks(s).filter(b=>!PASSABLE.test(b.name)).map(b=>key(b.position))),highest=Math.floor(s.position.y+1.62+.5);
 return (target:Position)=>{for(let dx=-2;dx<=2;dx++)for(let dy=-3;dy<=1;dy++)for(let dz=-2;dz<=2;dz++){
  const c={x:target.x+dx,y:target.y+dy,z:target.z+dz};
  if(c.y>highest||!solid.has(key(c))||solid.has(key({...c,y:c.y+1}))||solid.has(key({...c,y:c.y+2})))continue;
  if(Math.hypot(c.x-target.x,c.y+1-target.y,c.z-target.z)<=2)return true;
 }
 return false;};
}

// Every known target appears once per identity; nothing is ranked or filtered by usefulness.
export function moveTargets(s:Snapshot,plan:Plan|undefined,scopeCells:Position[]):MoveTarget[]{
 const here=s.position,out:MoveTarget[]=[],seen=new Set<string>(),standingNear=standingChecker(s);
 const add=(t:MoveTarget)=>{if(t.position&&moveReached(here,t.position))return;const k=t.kind+':'+t.label+':'+(t.position?`${t.position.x},${t.position.y},${t.position.z}`:'');if(seen.has(k))return;seen.add(k);out.push({...t,...(t.position?{distance:dist(here,t.position)}:{})});};
 // One option per observed block type: its nearest observed cell.
 const nearest=new Map<string,Position>();
 for(const b of workBlocks(s))if(!IGNORED.has(b.name)&&!moveReached(here,b.position)&&standingNear(b.position)){const old=nearest.get(b.name);if(!old||dist(here,b.position)<dist(here,old))nearest.set(b.name,b.position);}
 for(const [name,p] of [...nearest].sort((a,b)=>a[0].localeCompare(b[0])))add({kind:'observed_block',label:name,position:p,meaning:'Nearest observed cell of this block type with an observed standing place within the arrival radius; other cells remain in other_coordinate'});
 for(const p of s.importantPlaces??[])if(!p.dimension||p.dimension===s.dimension)add({kind:'remembered_place',label:p.label,position:floor(p.position),source:'important place memory'});
 for(const d of s.recovery?.deaths??[])if(!d.dimension||d.dimension===s.dimension)add({kind:'death_site',label:`death ${d.id}`,position:floor(d.position),source:'death record'});
 for(const a of s.animals??[])add({kind:'entity',label:`${a.kind} #${a.id}`,position:floor(a.position),source:'currently visible animal'});
 for(const e of s.enemies??[])add({kind:'entity',label:`${e.kind} #${e.id}`,position:floor(e.position),source:'currently visible enemy'});
 for(const p of s.nearbyPlayers??[])add({kind:'entity',label:`player ${p.name}`,position:floor(p.position),source:'currently visible player'});
 for(const i of s.visibleItems??[])add({kind:'entity',label:`dropped ${i.name} #${i.id}`,position:floor(i.position),source:'currently visible dropped item'});
 const planText=[plan?.goal,plan?.intent?.description,...plan?.intent?.constraints??[]].filter(Boolean).join(' ');
 for(const p of coordinatesIn(planText))add({kind:'plan_coordinate',label:'coordinate in current plan',position:p,source:'medium plan text; not verified by observation'});
 const self=s.social?.self;
 for(const m of s.social?.heard??[])if(m.speaker!==self)for(const p of coordinatesIn(m.text))add({kind:'chat_coordinate',label:`coordinate said by ${m.speaker}`,position:p,source:`chat message ${m.id}; unverified claim`});
 // Exploration without a target: the farthest eligible cell in each horizontal direction.
 const edge=new Map<number,Position>();
 for(const p of scopeCells){if(!standingNear(p))continue;const dx=p.x+.5-here.x,dz=p.z+.5-here.z;const sector=((Math.round(Math.atan2(dz,dx)/(Math.PI/4))%8)+8)%8;const old=edge.get(sector);const h=Math.hypot(dx,dz);if(!old||h>Math.hypot(old.x+.5-here.x,old.z+.5-here.z))edge.set(sector,p);}
 for(const [sector,p] of [...edge].sort((a,b)=>a[0]-b[0]))add({kind:'scope_edge',label:`${DIRECTIONS[sector]} edge of current scope`,position:p,meaning:'Farthest eligible observed cell in this direction within the current scope that has an observed standing place nearby'});
 out.push({kind:'other_coordinate',label:'choose an exact coordinate',meaning:`Opens the full list of ${scopeCells.length} eligible observed cells in the current scope`});
 return out;
}

type Site={position:Position;reference:Position};
export const onFloor=(site:Site)=>site.reference.x===site.position.x&&site.reference.z===site.position.z&&site.reference.y===site.position.y-1;
export type PlacementTarget={kind:'next_to'|'other_site';label:string;site?:Site;distance?:number;source?:string;meaning?:string};
// Placement sites by known anchors: the nearest valid site to each anchor. other_site opens every site.
export function placementTargets(s:Snapshot,plan:Plan|undefined,sites:Site[]):PlacementTarget[]{
 const out:PlacementTarget[]=[],seen=new Set<string>();
 const near=(anchor:Position,label:string,source:string)=>{
  // A floor-supported site wins over a side-attached one: beds need it, and it is the ordinary choice for other blocks.
  let best:Site|undefined,bestD=Infinity;for(const site of sites){const d=dist(anchor,site.position)+(onFloor(site)?0:1000);if(d<bestD){bestD=d;best=site;}}
  if(!best)return;const k=key(best.position)+':'+label;if(seen.has(k))return;seen.add(k);
  out.push({kind:'next_to',label,site:best,distance:dist(s.position,best.position),source});
 };
 near(floor(s.position),'next to me','own position');
 for(const p of s.nearbyPlayers??[])near(floor(p.position),`next to player ${p.name}`,'currently visible player');
 for(const b of workBlocks(s))if(/^(crafting_table|chest|furnace|blast_furnace|smoker)$|_bed$/.test(b.name))near(b.position,`next to ${b.name} at ${b.position.x},${b.position.y},${b.position.z}`,'observed block');
 for(const p of s.importantPlaces??[])if(!p.dimension||p.dimension===s.dimension)near(floor(p.position),`near ${p.label}`,'important place memory');
 const planText=[plan?.goal,plan?.intent?.description,...plan?.intent?.constraints??[]].filter(Boolean).join(' ');
 for(const p of coordinatesIn(planText))near(p,`near plan coordinate ${p.x},${p.y},${p.z}`,'medium plan text');
 out.push({kind:'other_site',label:'choose an exact site',meaning:`Opens the full list of ${sites.length} observed placement sites in the current scope`});
 return out;
}

type Block={name:string;position:Position};
export type MineTarget={kind:'block_type'|'other_block';label:string;block?:Block;count?:number;distance?:number;meaning?:string};
// One option per block type in the mine scope (its nearest cell); other_block opens every cell.
// Own placed blocks (walls, shelters) and the block under the feet are left out of the default per-type pick: in
// CONT1 "nearest stone" was usually the floor, and Bob dug an 11-block shaft and opened his own wall. Both stay
// selectable through other_block.
export function mineTargets(s:Snapshot,blocks:Block[]):MineTarget[]{
 const byType=new Map<string,{block:Block;count:number}>(),own=new Set((s.ownPlacedBlocks??[]).map(b=>key(b.position)));
 for(const b of blocks){if(own.has(key(b.position))||supportsFeet(b.position,s.position))continue;const old=byType.get(b.name);if(!old)byType.set(b.name,{block:b,count:1});else{old.count++;if(dist(s.position,b.position)<dist(s.position,old.block.position))old.block=b;}}
 const out:MineTarget[]=[...byType].sort((a,b)=>a[0].localeCompare(b[0])).map(([name,{block,count}])=>({kind:'block_type' as const,label:name,block,count,distance:dist(s.position,block.position),meaning:'Nearest cell of this block type in the mine scope'}));
 out.push({kind:'other_block',label:'choose an exact block cell',meaning:`Opens the full list of ${blocks.length} block cells in the mine scope${own.size?', including blocks you placed yourself':''}`});
 return out;
}
