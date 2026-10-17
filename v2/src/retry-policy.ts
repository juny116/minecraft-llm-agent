import type {Action,Plan,Snapshot} from './types.js';
// Local execution guard, not learned world knowledge. A new plan ID alone is not
// evidence that an unchanged failed interaction has become possible.
export class RetryPolicy {
 private failures=new Map<string,{state:string;count:number;quantity:number;reason:string}>();
 private key(action:Action,p:Plan){return JSON.stringify({action,target:action==='mine'?p.mine:action==='move'?p.destination:action==='craft'?{item:p.craft?.item}:action==='pickup'?p.pickup:action==='equip'?p.equip:action==='place_block'?p.build:{container:p.container,transfer:p.transfer}});}
 private state(s:Snapshot,a:Action){return JSON.stringify({craftable:a==='craft'?s.craftable:undefined,position:Object.fromEntries(Object.entries(s.position).map(([k,v])=>[k,Math.round(v*2)/2])),inventory:s.inventory,equipment:s.equipment,items:s.visibleItems});}
 blocked(a:Action,p:Plan,s:Snapshot){const f=this.failures.get(this.key(a,p));return !!f&&f.count>=2&&f.state===this.state(s,a)&&(a!=='craft'||(p.craft?.count??1)>=f.quantity);}
 record(a:Action,p:Plan,s:Snapshot,failed:boolean,reason:string){
  if(['idle','look','attack','flee','eat'].includes(a))return;
  const key=this.key(a,p);if(!failed){this.failures.delete(key);return;}
  const state=this.state(s,a),old=this.failures.get(key);this.failures.set(key,{state,quantity:Math.min(p.craft?.count??1,old?.state===state?old.quantity:Infinity),count:old?.state===state?old.count+1:1,reason:reason.slice(0,240)});
  if(this.failures.size>64)this.failures.delete(this.failures.keys().next().value!);
 }
 context(){return [...this.failures].filter(([,v])=>v.count>=2).map(([target,v])=>({target,attempts:v.count,reason:v.reason,instruction:'Unchanged failed interaction: reposition, change equipment/conditions, or choose another target. This is not proof of impossibility.'}));}
}
