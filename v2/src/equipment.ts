import type {Bot} from 'mineflayer';
import {setTimeout as delay} from 'node:timers/promises';
export const destinations=['hand','off-hand','head','torso','legs','feet'] as const;
export type EquipRequest={item:string|null;destination:typeof destinations[number];sourceSlot?:number};
export function compatible(item:string,d:EquipRequest['destination']){return d==='hand'||d==='off-hand'||d==='head'&&(/_helmet$/.test(item)||['turtle_helmet','carved_pumpkin'].includes(item))||d==='torso'&&(/_chestplate$/.test(item)||item==='elytra')||d==='legs'&&/_leggings$/.test(item)||d==='feet'&&/_boots$/.test(item);}
// This is a command convention, not a loadout recommendation.
export function defaultEquipmentDestination(item:string):EquipRequest['destination']{
 return destinations.find(d=>d!=='hand'&&d!=='off-hand'&&compatible(item,d))??'hand';
}
export type EquipmentChoice=[number,string|null,'default'|EquipRequest['destination']];
// Changes that would leave equipment as it is are not offered: re-equipping the held item "succeeded" without
// effect and was repeated every 1-2 s (CONT1 Alice: wooden_axe; CONT2 Bob: oak_log).
const SLOT_OF:Record<string,string>={head:'head',torso:'chest',legs:'legs',feet:'feet','off-hand':'offhand',hand:'hand'};
export function equipmentChoices(inventory:{slot:number;name:string}[]=[],equipped?:{slot:string;name:string}[]):EquipmentChoice[]{
 const items=[...new Map(inventory.filter(i=>Number.isInteger(i.slot)&&i.slot>=5&&i.slot<=45).map(i=>[i.slot,i])).values()];
 const worn=(d:EquipRequest['destination'])=>equipped?.find(e=>e.slot===SLOT_OF[d])?.name;
 const noop=([slot,item,mode]:EquipmentChoice)=>{if(!equipped)return false;const d=mode==='default'?(item===null?'hand':defaultEquipmentDestination(item)):mode;return item===null?!worn(d):worn(d)===item||(slot>=5&&slot<=8||slot===45)&&mode==='default';};
 return [...items.flatMap(i=>{
  const choices:EquipmentChoice[]=[[i.slot,i.name,'default']];
  if(defaultEquipmentDestination(i.name)==='hand')choices.push([i.slot,i.name,'off-hand']);
  return choices;
 }),...destinations.map(d=>[-1,null,d] as EquipmentChoice)].filter(c=>!noop(c));
}
export function equipmentRequest([sourceSlot,item,mode]:EquipmentChoice):EquipRequest{
 const destination=mode==='default'?(item===null?'hand':defaultEquipmentDestination(item)):mode;
 return {item,destination,...(sourceSlot<0?{}:{sourceSlot})};
}
export function validateEquip(p:EquipRequest){if(!p||!destinations.includes(p.destination)||p.item!==null&&(typeof p.item!=='string'||!/^[a-z0-9_]+$/.test(p.item)||!compatible(p.item,p.destination))||p.sourceSlot!==undefined&&(!Number.isInteger(p.sourceSlot)||p.sourceSlot<5||p.sourceSlot>45||p.item===null))throw Error('Invalid equipment request');}
export async function executeEquip(bot:Bot,p:EquipRequest,signal:AbortSignal){
 validateEquip(p);signal.throwIfAborted();if(bot.currentWindow||bot.inventory.selectedItem)throw Error('Equipment requires closed window and empty cursor');
 const dest=()=>bot.getEquipmentDestSlot(p.destination),current=()=>bot.inventory.slots[dest()];
 const fingerprint=(i:any)=>i?JSON.stringify({name:i.name,metadata:i.metadata,enchants:i.enchants??[],durabilityUsed:i.durabilityUsed,nbt:i.nbt??null}):null;
 const totals=()=>{const t:Record<string,number>={};for(const i of bot.inventory.slots.slice(5,46))if(i)t[i.name]=(t[i.name]??0)+i.count;return JSON.stringify(Object.entries(t).sort());};
 const before=totals(),source=p.item===null?null:bot.inventory.slots.find((i,n)=>n>=5&&n<=45&&i?.name===p.item&&(p.sourceSlot===undefined||n===p.sourceSlot));
 if(p.item!==null&&!source)throw Error('Equipment item not carried');const expected=fingerprint(source);
 const click=bot.clickWindow;
 bot.clickWindow=((...args:Parameters<typeof click>)=>{signal.throwIfAborted();if(args[0]===-999)throw Error('Equipment must not drop items');return click.apply(bot,args);}) as typeof click;
 try{
  if(p.item===null&&current()){
   const empty=bot.inventory.slots.findIndex((i,n)=>n>=9&&n<=44&&!i);if(empty<0)throw Error('Equipment removal needs free inventory slot');
   if(p.destination==='hand'&&empty>=36)bot.setQuickBarSlot(empty-36);else await bot.moveSlotItem(dest(),empty);
  }else if(source)await bot.equip(source,p.destination);
  signal.throwIfAborted();
  for(let n=0;n<20&&fingerprint(current())!==expected;n++)await delay(50,undefined,{signal});
  if(fingerprint(current())!==expected||totals()!==before)throw Error('Equipment change not confirmed');
  return JSON.stringify({kind:'equipment',destination:p.destination,item:p.item,sourceSlot:p.sourceSlot??null,equipped:current()?{name:current()!.name,enchants:current()!.enchants,durabilityUsed:current()!.durabilityUsed}:null,inventoryConserved:true});
 }finally{bot.clickWindow=click;}
}
