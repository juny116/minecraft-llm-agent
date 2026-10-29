import {pickupTargets} from './pickup.js';
import type {Snapshot} from './types.js';
import {workBlocks} from './types.js';
import {moveDomain} from './action-contracts.js';
import {placementDomain} from './map-regions.js';
import {isExcluded,type ExcludedTarget} from './stuck-guard.js';
import {equipmentChoices} from './equipment.js';
import {localDomain,cellCenter,cellKey} from './local-domain.js';
import {validCell} from './building.js';
export const LOCAL_SCOPE_RULE='actionScopes lists the CURRENT selectable radius and count per action. It is a selection scope, not arm reach or a route guarantee. Max radius12 shrinks by whole blocks only when too many targets exist; every eligible target inside the reported radius remains available. Farther known terrain stays in the map/memory but is NOT a current argument. To work farther away, first choose a local move toward it, observe again, then select the work action. Short approach inside the scope is included. If no local route or target is observed, absence is not proof the world is empty. No local strategy or preferred target is supplied.';
export function actionDomains(s:Snapshot){
 const eye={...s.position,y:s.position.y+1.62};
 const work=workBlocks(s),ex=s.stuck?.excludedTargets;
 const seen=s.perception?.mode==='panorama'?new Set((s.vision?.blocks??[]).map(b=>`${b.position.x},${b.position.y},${b.position.z}`)):undefined;
 const cells=<T>(xs:T[],p:(v:T)=>Snapshot['position'])=>localDomain(xs,eye,v=>cellCenter(p(v)),v=>cellKey(p(v)));
 return {
  move:cells(moveDomain(s).eligible.filter(p=>!isExcluded(ex,'move',p)),p=>p),
  // Only cells in the current observation: a remembered block is unconfirmed now, so it is reached with move first
  // and becomes a mine option once seen again (FREE1: 25 'remembered target not observable' failures).
  mine:cells(work.filter(b=>validCell(b.position)&&!['air','cave_air','void_air','water','lava','bedrock'].includes(b.name)&&!isExcluded(ex,'mine',b.position)&&(!seen||seen.has(`${b.position.x},${b.position.y},${b.position.z}`))),b=>b.position),
  place_block:withoutExcludedSites(placementDomain(s),ex),
  pickup:localDomain(pickupTargets(s),eye,v=>v.position,v=>String(v.id)),
  bed:cells(work.filter(b=>b.name.endsWith('_bed')),b=>b.position),
  workstation:cells(work.filter(b=>b.name==='crafting_table'),b=>b.position),
  container:cells(work.filter(b=>['chest','furnace','blast_furnace','smoker'].includes(b.name)),b=>b.position)
 };
}
export function actionScopes(s:Snapshot){const d=actionDomains(s);return {rule:LOCAL_SCOPE_RULE,...Object.fromEntries(Object.entries(d).map(([k,v])=>[k,v.scope]))};}

function withoutExcludedSites<D extends {values:{position:Snapshot['position']}[]}>(d:D,ex?:ExcludedTarget[]):D{return ex?.length?{...d,values:d.values.filter(v=>!isExcluded(ex,'place_block',v.position))}:d;}

// Actions whose argument domain is empty now. Offering them only produced "No observed values" loops (CONT1:
// pickup with no drop 494 times, sleep with no bed 290 times). move is never listed: it always has other_coordinate.
export function emptyActions(s:Snapshot){
 const d=actionDomains(s),carried=(s.inventory??[]).some(i=>i.slot>=9&&i.slot<=44),empty:string[]=[];
 if(!d.pickup.values.length)empty.push('pickup');
 if(!d.bed.values.length)empty.push('sleep');
 if(!d.container.values.length)empty.push('inspect_container','withdraw','deposit');else if(!carried)empty.push('deposit');
 if(!(s.nearbyPlayers??[]).length)empty.push('follow','give');else if(!carried)empty.push('give');
 if(![...s.enemies??[],...s.animals??[]].length)empty.push('attack');
 if(!(s.enemies??[]).length)empty.push('flee');
 if(!(s.edibleItems??[]).length)empty.push('eat');
 if(!d.mine.values.length)empty.push('mine');
 if(!(s.placeableItems??[]).length||!d.place_block.values.length)empty.push('place_block');
 if(!equipmentChoices(s.inventory,s.equipment).length)empty.push('equip');
 return empty;
}
