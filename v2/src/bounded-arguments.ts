import {recipeExecutionCounts} from './crafting-state.js';
import {bedFacings} from './beds.js';
import type {Action,Plan,Snapshot} from './types.js';
import {actionDomains} from './action-domains.js';
import {moveTargets,placementTargets,mineTargets,onFloor} from './move-targets.js';
import {equipmentChoices,equipmentRequest} from './equipment.js';
type Pick=<T>(name:string,values:T[])=>Promise<T>;
type Together=(specs:{name:string;values:any[]}[])=>Promise<any[]>;
const uniq=(xs:string[])=>[...new Set(xs)];
const counts=(n:number)=>Array.from({length:Math.min(64,n)},(_,i)=>i+1);
export async function bindBoundedArguments(s:Snapshot,action:Action,pick:Pick,together:Together,plan?:Plan):Promise<Partial<Plan>>{
 const d=actionDomains(s),inv=(s.inventory??[]).filter(i=>i.slot>=9&&i.slot<=44);
 switch(action){
 case 'move':{
  // Known targets go all the way, even outside the scope; exact cells stay reachable via other_coordinate.
  const t=await pick('destination',moveTargets(s,plan,d.move.values));
  if(t.kind==='other_coordinate'||!t.position)return {destination:await pick('destinationCoordinate',d.move.values)};
  return {destination:t.position,destinationTarget:{kind:t.kind,label:t.label,...(t.source?{source:t.source}:{})}};
 }
 case 'mine':{const target=await pick('block',mineTargets(s,d.mine.values));const b=target.kind==='other_block'||!target.block?await pick('blockExact',d.mine.values):target.block;const t=await pick('tool',[{slot:-1,name:'keep_current_hand'},...inv.map(i=>({slot:i.slot,name:i.name}))]);return {mine:{position:b.position,expected:b.name,...(t.slot<0?{keepTool:true}:{toolSlot:t.slot,tool:t.name})}};}
 case 'place_block':case 'place_table':{
  // Sites are offered by known anchors; other_site opens the exact list in a second question.
  const [item,target,facing]=await together([{name:'blockItem',values:action==='place_table'?['crafting_table']:s.placeableItems??[]},{name:'placementSite',values:placementTargets(s,plan,d.place_block.values)},...(s.placeableItems?.some(i=>i.endsWith('_bed'))?[{name:'bedFacing',values:[...bedFacings]}]:[])]);
  // A bed stands on the floor below its foot: use that cell's floor support, and list only floor sites.
  const bed=item.endsWith('_bed'),floorSites=d.place_block.values.filter(onFloor);
  let site=target.kind==='other_site'||!target.site?await pick('placementSiteExact',bed?floorSites:d.place_block.values):target.site;
  if(bed&&!onFloor(site))site=floorSites.find(f=>f.position.x===site.position.x&&f.position.y===site.position.y&&f.position.z===site.position.z)??site;
  return {build:{item,...site,...(bed?{facing}:{})}};
 }
 case 'craft':{
  const item=await pick('recipeOutput',uniq(s.craftable??[]));const needsTable=!!s.inventoryCraftable&&!s.inventoryCraftable.includes(item);
  const [count,station]=await together([{name:'recipeExecutions',values:recipeExecutionCounts(s,item)},...(needsTable?[{name:'workstation',values:d.workstation.values}]:[])]);
  return {craft:{item,count,...(needsTable?{workstation:station.position}:{})}};
 }
 case 'pickup':{const i=await pick('drop',d.pickup.values);return {pickup:{entityId:i.id,expected:i.name}};}
 case 'equip':return {equip:equipmentRequest(await pick('equipmentChange',equipmentChoices(s.inventory,s.equipment)))};
 case 'eat':return {foodItem:await pick('foodItem',s.edibleItems??[])};
 case 'follow':return {followPlayer:(await pick('player',s.nearbyPlayers??[])).name};
 case 'sleep':return {bed:(await pick('bed',d.bed.values)).position};
 case 'attack':case 'flee':return {targetEntityId:(await pick('target',action==='attack'?[...s.enemies??[],...s.animals??[]]:s.enemies??[])).id};
 case 'give':{
  const [recipient,item]=await together([{name:'recipient',values:s.nearbyPlayers??[]},{name:'item',values:uniq(inv.map(i=>i.name))}]);
  return {transfer:{recipient:recipient.name,item,count:await pick('count',counts(inv.filter(i=>i.name===item).reduce((n,i)=>n+i.count,0)))}};
 }
 case 'inspect_container':case 'deposit':case 'withdraw':{
  const c=await pick('container',d.container.values);if(action==='inspect_container')return {container:c.position};
  const memory=s.containers?.find(m=>m.position.x===c.position.x&&m.position.y===c.position.y&&m.position.z===c.position.z);
  const slots=c.name==='chest'?[undefined]:action==='deposit'?['input','fuel'] as const:['input','fuel','output'] as const;
  const sources=slots.flatMap(slot=>{
   const items=action==='deposit'?inv:slot?(memory?.slots?.[slot]?[memory.slots[slot]!]:[]):memory?.items??[];
   return uniq(items.map(i=>i.name)).map(item=>({item,...(slot?{slot}:{}),availableCount:items.filter(i=>i.name===item).reduce((n,i)=>n+i.count,0)}));
  });
  // Speculate only quantities for this chosen action/container. Each count is
  // conditional on its named source; unused answers do not alter the plan.
  const names=sources.map((v,i)=>`count_if_source_${i}_${v.item}_${'slot'in v?v.slot:'chest'}`);
  const [source,...quantities]=await together([{name:'transferSource',values:sources},...sources.map((v,i)=>({name:names[i],values:counts(v.availableCount)}))]);
  const index=sources.findIndex(v=>v===source);if(index<0)throw Error('Invalid transfer source');
  return {container:c.position,transfer:{item:source.item,count:quantities[index],...('slot'in source?{slot:source.slot}:{})}};
 }
 default:throw Error('Unsupported bounded action '+action);
 }
}
