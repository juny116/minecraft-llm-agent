export type PickupRequest={entityId:number;expected:string};
export type VisibleItem={id:number;name:string;count:number;position:{x:number;y:number;z:number}};
export type PickupResult={kind:'pickup';target:PickupRequest|null;inventoryGained:{name:string;count:number}[];status:'finished'|'failed'|'cancelled';elapsedMs:number;detail?:string;attribution:'inventory_delta_not_proof_of_target_origin'};
export function validatePickup(p:PickupRequest){if(!p||!Number.isSafeInteger(p.entityId)||p.entityId<0||typeof p.expected!=='string'||!/^[a-z0-9_]+$/.test(p.expected))throw Error('Invalid pickup target');}
export function readPickupResult(text:string):PickupResult|undefined{try{const r=JSON.parse(text);return r.kind==='pickup'&&Array.isArray(r.inventoryGained)?r:undefined;}catch{return undefined;}}

export type RememberedItem=VisibleItem & {lastSeen:number;source:'last_seen';currentExistence:'unknown'};
export class DropMemory {
 private items=new Map<number,RememberedItem>();
 clear(){this.items.clear();}
 forget(id:number){this.items.delete(id);}
 observe(visible:VisibleItem[],now=Date.now()){
  for(const i of visible)this.items.set(i.id,{...structuredClone(i),lastSeen:now,source:'last_seen',currentExistence:'unknown'});
  for(const [id,i] of this.items)if(now-i.lastSeen>120000)this.items.delete(id);
  while(this.items.size>64)this.items.delete(this.items.keys().next().value!);
 }
 remembered(visible:VisibleItem[],now=Date.now()){
  this.observe([],now);const ids=new Set(visible.map(i=>i.id));
  return [...this.items.values()].filter(i=>!ids.has(i.id)).map(i=>structuredClone(i));
 }
}
export function pickupTargets(s:{visibleItems?:VisibleItem[];rememberedItems?:RememberedItem[]},now=Date.now()): (VisibleItem|RememberedItem)[]{
 const visible=s.visibleItems??[],ids=new Set(visible.map(i=>i.id));
 return [...visible,...(s.rememberedItems??[]).filter(i=>!ids.has(i.id)&&now-i.lastSeen<=120000)];
}
