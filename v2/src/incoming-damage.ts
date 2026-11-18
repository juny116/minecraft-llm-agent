export type IncomingEvent = {at:number;type:'hit';attacker:{id:number;kind:string}|null}|{at:number;type:'health_loss';before:number;after:number;amount:number};
// Separate events: health updates need not arrive in the same order as damage packets.
export class IncomingDamage {
 private events:IncomingEvent[]=[];
 private previous?:number;
 health(value:number,at:number){
  if(this.previous!==undefined&&value<this.previous)this.add({at,type:'health_loss',before:this.previous,after:value,amount:this.previous-value});
  this.previous=value;
 }
 hit(at:number,visibleAttacker?:{id:number;kind:string}){this.add({at,type:'hit',attacker:visibleAttacker?{...visibleAttacker}:null});}
 private add(e:IncomingEvent){this.events.push(e);this.events=this.events.slice(-16);}
 snapshot(now:number){return this.events.filter(e=>now-e.at<=10000).map(e=>structuredClone(e));}
 clear(){this.events=[];this.previous=undefined;}
}
