import type {Snapshot} from './types.js';

type Position={x:number;y:number;z:number};
type Message={id:string;speaker:string;text:string;at:number};
// One give action. Each field is a separate fact; none is inferred from another.
export type Delivery={id:number;recipient:string;item:string;count:number;droppedAt:number;droppedNear:Position;
 recipientMessages:Message[];groundCheck:{at:number;seenNearDropPoint:boolean}|null};

const TRACK_MS=300000,NEAR=4;
export const DELIVERY_MEANING='droppedBySelf is your own completed drop. recipientMessages are the recipient\'s own later chat lines, unverified statements, not your observation of their inventory; read them yourself. groundCheck says whether a matching dropped item was visible near the drop point at that time: not seen does not mean received, and seen does not mean refused. You cannot observe another player\'s inventory.';

export class DeliveryLog{
 private items:Delivery[]=[];
 record(id:number,recipient:string,item:string,count:number,near:Position,at=Date.now()){
  this.items=[...this.items,{id,recipient,item,count,droppedAt:at,droppedNear:{...near},recipientMessages:[],groundCheck:null}].slice(-8);
 }
 observe(s:Pick<Snapshot,'visibleItems'|'position'>,heard:Message[],now=Date.now()){
  for(const d of this.items){
   if(now-d.droppedAt>TRACK_MS)continue;
   for(const m of heard)if(m.speaker===d.recipient&&m.at>=d.droppedAt&&!d.recipientMessages.some(x=>x.id===m.id))d.recipientMessages=[...d.recipientMessages,{id:m.id,speaker:m.speaker,text:m.text,at:m.at}].slice(-3);
   // Only report the ground when the drop point is close enough to have been observed.
   if(Math.hypot(s.position.x-d.droppedNear.x,s.position.y-d.droppedNear.y,s.position.z-d.droppedNear.z)>12)continue;
   const seen=(s.visibleItems??[]).some(v=>v.name===d.item&&!!v.position&&Math.hypot(v.position.x-d.droppedNear.x,v.position.y-d.droppedNear.y,v.position.z-d.droppedNear.z)<=NEAR);
   d.groundCheck={at:now,seenNearDropPoint:seen};
  }
 }
 view(now=Date.now()){
  const recent=this.items.filter(d=>now-d.droppedAt<=TRACK_MS);
  return recent.length?{meaning:DELIVERY_MEANING,deliveries:recent.map(d=>({actionId:d.id,recipient:d.recipient,item:d.item,count:d.count,droppedBySelf:{at:d.droppedAt,near:d.droppedNear},recipientMessages:d.recipientMessages,groundCheck:d.groundCheck}))}:undefined;
 }
}
