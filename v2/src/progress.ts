import type {Snapshot} from './types.js';
// Per-agent observed progress; chat, model calls and repeated camera turns do not reset it.
export class ProgressTracker {
 private lastAt:number|null=null;private anchor?:Snapshot['position'];private inventory='';private equipment='';private known=new Set<string>();private visited=new Set<string>();private escalationAt=-Infinity;
 observe(s:Snapshot,now:number){
  const inv=JSON.stringify((s.inventory??[]).map(i=>[i.name,i.count]).sort());const gear=JSON.stringify(s.equipment??[]);
  let novel=false;for(const b of s.vision?.blocks??[]){const key=JSON.stringify([b.name,b.position]);if(!this.known.has(key)){novel=true;this.known.add(key);}}
  const cell=JSON.stringify([s.dimension,Math.floor(s.position.x/2),Math.floor(s.position.y/2),Math.floor(s.position.z/2)]);
  const moved=!this.visited.has(cell)&&!!this.anchor&&Math.hypot(s.position.x-this.anchor.x,s.position.y-this.anchor.y,s.position.z-this.anchor.z)>=2;
  if(this.lastAt===null||inv!==this.inventory||gear!==this.equipment||moved||novel){this.lastAt=now;this.anchor={...s.position};this.visited.add(cell);}
  this.inventory=inv;this.equipment=gear;
  return this.context(now);
 }
 context(now:number){return {noProgressMs:this.lastAt===null?0:Math.max(0,now-this.lastAt)};}
 review(now:number):'medium'|'long'|null{const age=this.context(now).noProgressMs;if(age<30000||now-this.escalationAt<30000)return null;this.escalationAt=now;return age>=90000?'long':'medium';}
 reset(){this.lastAt=null;this.anchor=undefined;this.known.clear();this.visited.clear();this.escalationAt=-Infinity;}
}
