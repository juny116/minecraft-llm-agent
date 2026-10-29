// The task layer's prepared response to hostile mobs. The full policy stays with the task layer; JEV receives
// only the rules that match currently visible enemies, so its input stays small.
export const THREAT_RESPONSES=['fight','avoid','flee','retreat','ignore'] as const;
export type ThreatRule={enemies:string[];response:typeof THREAT_RESPONSES[number];when?:string;note?:string};
export type ThreatResponse={rules:ThreatRule[];retreatTo?:{x:number;y:number;z:number;label?:string};basis?:string};
export const ANY_HOSTILE='any_hostile';

const text=(v:unknown,max:number,field:string)=>{if(v===undefined)return undefined;if(typeof v!=='string'||!v.trim()||v.length>max)throw Error(`Invalid threatResponse: ${field} must be text of at most ${max} characters`);return v;};
export function parseThreatResponse(raw:any):ThreatResponse{
 if(!raw||typeof raw!=='object'||!Array.isArray(raw.rules)||!raw.rules.length||raw.rules.length>8)throw Error('Invalid threatResponse: rules must list 1-8 {enemies,response,when?,note?}');
 const rules=raw.rules.map((r:any):ThreatRule=>{
  if(!Array.isArray(r?.enemies)||!r.enemies.length||r.enemies.length>8||r.enemies.some((e:any)=>typeof e!=='string'||!/^[a-z_]+$/.test(e)))throw Error(`Invalid threatResponse: enemies must be mob names such as zombie, or ${ANY_HOSTILE}`);
  if(!THREAT_RESPONSES.includes(r.response))throw Error(`Invalid threatResponse: response must be one of ${THREAT_RESPONSES.join('|')}`);
  const when=text(r.when,160,'when'),note=text(r.note,200,'note');
  return {enemies:[...r.enemies],response:r.response,...(when?{when}:{}),...(note?{note}:{})};
 });
 const p=raw.retreatTo;
 if(p!==undefined&&(!p||!['x','y','z'].every(k=>Number.isSafeInteger(p[k]))))throw Error('Invalid threatResponse: retreatTo needs integer x,y,z');
 const label=p?text(p.label,80,'retreatTo.label'):undefined,basis=text(raw.basis,400,'basis');
 return {rules,...(p?{retreatTo:{x:p.x,y:p.y,z:p.z,...(label?{label}:{})}}:{}),...(basis?{basis}:{})};
}

// Rules for the visible enemy kinds (or any_hostile), without notes or basis; null when nothing is visible.
export function threatView(t:ThreatResponse|undefined,enemyKinds:string[]){
 if(!enemyKinds.length)return undefined;
 if(!t)return {prepared:false,meaning:'The task layer has not prepared a response for hostiles yet; judge from observations and guidance.'};
 const kinds=new Set(enemyKinds);
 const rules=t.rules.filter(r=>r.enemies.some(e=>kinds.has(e))).concat(t.rules.filter(r=>r.enemies.includes(ANY_HOSTILE))).slice(0,4).map(({enemies,response,when})=>({enemies:enemies.filter(e=>kinds.has(e)||e===ANY_HOSTILE),response,...(when?{when}:{})}));
 return {prepared:true,rules,...(t.retreatTo?{retreatTo:t.retreatTo}:{}),meaning:'Task layer prepared response for the visible hostiles. Follow it unless current health, numbers or gear contradict its conditions.'};
}

// A visible hostile that no prepared rule covers.
export function uncovered(t:ThreatResponse|undefined,enemyKinds:string[]){
 if(!enemyKinds.length)return [];
 if(!t)return [...new Set(enemyKinds)];
 if(t.rules.some(r=>r.enemies.includes(ANY_HOSTILE)))return [];
 return [...new Set(enemyKinds)].filter(k=>!t.rules.some(r=>r.enemies.includes(k)));
}

// What a threat policy depends on. A new policy is applied only when this changes (or none exists); DUO6 plans
// rewrote it every 8-10 s and flipped between fight and flee with nothing changed.
export function threatBasis(s:import('./types.js').Snapshot,guides:{id:string;version:number}[]=[]){
 const worn=(s.equipment??[]).filter(e=>['head','chest','legs','feet'].includes(e.slot)).map(e=>e.name).sort();
 const weapons=[...new Set((s.inventory??[]).map(i=>i.name).filter(n=>/_(sword|axe)$/.test(n)))].sort();
 const health=s.health>=14?'high':s.health>=7?'medium':'low';
 const phase=s.time?.phase==='night'||s.time?.phase==='sunset'?'dark':'light';
 // All active guides, not the action-filtered retrieval, so switching actions does not count as a change.
 const guidance=guides.map(g=>`${g.id}@${g.version}`).sort();
 return {worn,weapons,health,phase,guidance,life:s.lifecycle?.generation??0};
}
export function basisChanges(before:ReturnType<typeof threatBasis>|undefined,now:ReturnType<typeof threatBasis>){
 if(!before)return ['no policy yet'];
 return (Object.keys(now) as (keyof typeof now)[]).filter(k=>JSON.stringify(before[k])!==JSON.stringify(now[k]));
}

// For a visible hostile within 16 blocks whose prepared rule says fight: text appended to the attack and flee
// criteria, so the rule and its facts sit next to the choice. In a DUO7 replay this changed attack 0/12 -> 7/12.
export function fightRuleCriteria(t:ThreatResponse|undefined,enemies:{id:number;kind:string;distance:number}[],facts?:{enemies:{kind:string;yourHitsToKill:number;secondsToKillAtFullSwing:number;hitsYouCanTakeNow:number}[]}){
 if(!t)return undefined;
 const near=[...enemies].filter(e=>e.distance<=16).sort((a,b)=>a.distance-b.distance).find(e=>t.rules.some(r=>r.response==='fight'&&(r.enemies.includes(e.kind)||r.enemies.includes(ANY_HOSTILE))));
 if(!near)return undefined;
 const rule=t.rules.find(r=>r.response==='fight'&&(r.enemies.includes(near.kind)||r.enemies.includes(ANY_HOSTILE)))!,f=facts?.enemies.find(e=>e.kind===near.kind);
 const fact=f?` combatFacts for ${near.kind}: you kill it in ${f.yourHitsToKill} hits (~${f.secondsToKillAtFullSwing} s) and can take ${f.hitsYouCanTakeNow} of its hits.`:'';
 return {attack:` threatPlan prepares FIGHT for ${near.kind} #${near.id} at ${near.distance.toFixed(1)} blocks${rule.when?` (when: ${rule.when})`:''}.${fact}`,
  flee:` threatPlan prepares fight, not flight, for ${near.kind}; choose flee only if current health, numbers or gear contradict that rule.`};
}

// While an attack runs on a target the policy prepares a fight for, continue/stop carry the same rule and facts:
// in CONT2 Alice started a prepared fight at 14 HP, switched to flee mid-fight and died with one hit landed.
export function runningFightCriteria(t:ThreatResponse|undefined,target:{id:number;kind:string;distance:number}|undefined,facts?:{enemies:{kind:string;yourHitsToKill:number;hitsYouCanTakeNow:number}[]}){
 if(!t||!target)return undefined;
 const rule=t.rules.find(r=>r.response==='fight'&&(r.enemies.includes(target.kind)||r.enemies.includes(ANY_HOSTILE)));if(!rule)return undefined;
 const f=facts?.enemies.find(e=>e.kind===target.kind),fact=f?` combatFacts: you kill it in ${f.yourHitsToKill} hits and can take ${f.hitsYouCanTakeNow} of its hits now.`:'';
 return {continue:` threatPlan prepares FIGHT for this ${target.kind}${rule.when?` (when: ${rule.when})`:''}; continuing keeps the hits already landed.${fact}`,
  stop:` The running attack is a fight the threatPlan prepared for this ${target.kind}; switching to flight mid-fight forfeits landed hits, so stop only if health, numbers or gear no longer meet its condition.`};
}
