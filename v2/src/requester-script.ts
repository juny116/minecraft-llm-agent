// Scripted in-game requester for testing chat understanding. It only sends fixed lines and records replies;
// it never calls a model and the tested bot sees it as an ordinary player.
export type RequesterLine={afterMs:number;text:string};
export type RequesterRecord={at:number;kind:'sent'|'heard';speaker:string;text:string};

export function parseRequesterScript(raw:unknown):RequesterLine[]{
 if(!Array.isArray(raw)||!raw.length||raw.length>20)throw Error('Invalid requester script: 1-20 lines');
 let last=-1;
 return raw.map(l=>{
  if(!l||!Number.isInteger(l.afterMs)||l.afterMs<0||l.afterMs<last||typeof l.text!=='string'||!l.text.trim()||l.text.length>200||l.text.trimStart().startsWith('/'))throw Error('Invalid requester line: non-decreasing afterMs and 1-200 character text, no slash commands');
  last=l.afterMs;return {afterMs:l.afterMs,text:l.text};
 });
}

export type RequesterAck={item:string;text:string};
export class RequesterScript{
 readonly records:RequesterRecord[]=[];private next=0;private acks:RequesterAck[];private baseline=new Map<string,number>();private acked=new Set<string>();
 constructor(readonly self:string,private lines:RequesterLine[],private send:(text:string)=>void,private startedAt:number,ack?:RequesterAck|RequesterAck[]){this.acks=ack?Array.isArray(ack)?ack:[ack]:[];}
 // Acknowledge once per item when the requester's own inventory count rises above its first reading.
 held(item:string,count:number,now:number){const ack=this.acks.find(a=>a.item===item);if(!ack||this.acked.has(item))return;if(!this.baseline.has(item)){this.baseline.set(item,count);return;}if(count>this.baseline.get(item)!){this.acked.add(item);this.send(ack.text);this.records.push({at:now,kind:'sent',speaker:this.self,text:ack.text});}}
 get ackItems(){return this.acks.map(a=>a.item);}
 // Call periodically; sends every line whose time has come, in order.
 tick(now:number){while(this.next<this.lines.length&&now-this.startedAt>=this.lines[this.next].afterMs){const {text}=this.lines[this.next++];this.send(text);this.records.push({at:now,kind:'sent',speaker:this.self,text});}}
 heard(speaker:string,text:string,now:number){if(speaker!==this.self)this.records.push({at:now,kind:'heard',speaker,text});}
 get done(){return this.next>=this.lines.length;}
}
