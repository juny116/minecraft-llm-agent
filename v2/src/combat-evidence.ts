export type CombatEvidence = {id:number;kind:string;lastSeen:number;confirmedOwnHits:number;lastOwnHit:number|null;lastDamageWasOwn:boolean;lastDamageAt:number|null;deathObserved:boolean;ownKillConfirmed:boolean};
// Only visible entity events; no opponent health/armor/damage lookup.
export class CombatEvidenceStore {
 private entries=new Map<number,CombatEvidence>();
 seen(id:number,kind:string,now:number){
  const e=this.entries.get(id)??{id,kind,lastSeen:now,confirmedOwnHits:0,lastOwnHit:null,lastDamageWasOwn:false,lastDamageAt:null,deathObserved:false,ownKillConfirmed:false};
  e.lastSeen=now;this.entries.delete(id);this.entries.set(id,e);
  while(this.entries.size>32)this.entries.delete(this.entries.keys().next().value!);
 }
 hurt(id:number,ownSource:boolean,visible:boolean,now:number){
  const e=this.entries.get(id);if(!e||!visible||e.deathObserved)return;
  e.lastDamageWasOwn=ownSource;e.lastDamageAt=now;
  if(ownSource){e.confirmedOwnHits++;e.lastOwnHit=now;}
 }
 death(id:number,now:number){
  const e=this.entries.get(id);if(!e||now-e.lastSeen>1500)return;
  e.deathObserved=true;e.ownKillConfirmed=e.lastOwnHit!==null&&now-e.lastOwnHit<=1500&&e.lastDamageWasOwn;
 }
 get(id:number){const e=this.entries.get(id);return e?{...e}:undefined;}
 snapshot(){return [...this.entries.values()].filter(e=>e.confirmedOwnHits||e.deathObserved).map(e=>({...e}));}
 clear(){this.entries.clear();}
}
