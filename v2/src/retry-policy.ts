import type {Action,Plan,Snapshot} from './types.js';
// Local execution guard, not learned world knowledge. A new plan ID alone is not
// evidence that an unchanged failed interaction has become possible.
export class RetryPolicy {
 private failures=new Map<string,{state:string;count:number;quantity:number;reason:string;stateReason:string;position:Snapshot["position"]}>();
 private route(a:Action,reason:string){return ['pickup','move','mine'].includes(a)&&/Destination not reached|no observed route|approach limit/i.test(reason)||a==='mine'&&/not in view|occluded|visible only|not currently observed/i.test(reason)||a==='move'&&/timed out/i.test(reason);}
 private nearby(a:Snapshot['position'],b:Snapshot['position']){return Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)<1;}
 private key(action:Action,p:Plan){return JSON.stringify({action,target:action==='mine'?{position:p.mine?.position,expected:p.mine?.expected}:action==='move'?p.destination:action==='craft'?{item:p.craft?.item}:action==='pickup'?p.pickup:action==='equip'?p.equip:action==='place_block'?p.build:{container:p.container,transfer:p.transfer}});}
 private state(s:Snapshot,a:Action,reason='',p?:Plan){
  if(this.route(a,reason))return 'route_conditions';
  if(a==='mine'&&/not in view|occluded|visible only|not currently observed/i.test(reason))return JSON.stringify({attempt:a==='mine'?{maxMs:p?.mine?.maxMs??30000,tool:p?.mine?.tool,toolSlot:p?.mine?.toolSlot}:undefined,position:Object.fromEntries(Object.entries(s.position).map(([k,v])=>[k,Math.round(v*2)/2]))});
  if(a==='craft'&&/^Missing ingredients/.test(reason)){
   const names=[...reason.matchAll(/([a-z0-9_]+) x[0-9]+/g)].map(m=>m[1]);
   if(names.length)return JSON.stringify(names.map(name=>[name,(s.inventory??[]).filter(i=>i.name===name).reduce((n,i)=>n+i.count,0)]));
  }
  if(a==='craft')return JSON.stringify({craftable:[...(s.craftable??[])].sort(),inventory:Object.entries((s.inventory??[]).reduce<Record<string,number>>((o,i)=>{o[i.name]=(o[i.name]??0)+i.count;return o;},{})).sort(([a],[b])=>a.localeCompare(b)),tables:(s.vision?.blocks??[]).filter(b=>b.name==='crafting_table').map(b=>[b.position.x,b.position.y,b.position.z]).sort()});
  return JSON.stringify({attempt:a==='mine'?{maxMs:p?.mine?.maxMs??30000,tool:p?.mine?.tool,toolSlot:p?.mine?.toolSlot}:undefined,position:Object.fromEntries(Object.entries(s.position).map(([k,v])=>[k,Math.round(v*2)/2])),inventory:s.inventory,equipment:s.equipment,items:s.visibleItems});}
 blocked(a:Action,p:Plan,s:Snapshot){const f=this.failures.get(this.key(a,p));return !!f&&f.count>=2&&f.state===this.state(s,a,f.stateReason,p)&&(!this.route(a,f.stateReason)||this.nearby(f.position,s.position))&&(a!=='craft'||(p.craft?.count??1)>=f.quantity);}
 record(a:Action,p:Plan,s:Snapshot,failed:boolean,reason:string){
  if(['idle','look','attack','flee','eat'].includes(a))return;
  const key=this.key(a,p);if(!failed){this.failures.delete(key);return;}
  const state=this.state(s,a,reason,p),old=this.failures.get(key),same=old?.state===state&&(!this.route(a,reason)||this.nearby(old.position,s.position));this.failures.set(key,{state,position:same?old!.position:{...s.position},quantity:Math.min(p.craft?.count??1,same?old!.quantity:Infinity),count:same?old!.count+1:1,reason:reason.length>240?reason.slice(0,115)+' ... '+reason.slice(-120):reason,stateReason:reason});
  if(this.failures.size>64)this.failures.delete(this.failures.keys().next().value!);
 }
 context(){return [...this.failures].filter(([,v])=>v.count>=2).map(([target,v])=>({target,attempts:v.count,reason:v.reason,instruction:'Unchanged failed interaction: reposition, change equipment/conditions, or choose another target. This is not proof of impossibility.'}));}
}
