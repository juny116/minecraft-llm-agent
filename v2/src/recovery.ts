import {randomUUID} from 'node:crypto';
import {existsSync,readFileSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';
import type {Snapshot} from './types.js';
export type AlivePossessions={at:number;inventory:Snapshot['inventory'];equipment:Snapshot['equipment']};
export type RecoveryDecision={strategy:'recover'|'prepare'|'defer'|'abandon'|'resolved';reason:string;at:number};
export type RecoveryOutcome={id:string;version:number;at:number;status:'unresolved'|'partial'|'supplies_restored'|'unknown';matched:Record<string,number>;missing:Record<string,number>;nearDeathSite:boolean;source:'own_inventory_observation';attribution:'origin_unconfirmed'};
export type DeathExperience={id:string;at:number;dimension?:string;position:Snapshot['position'];inventory:Snapshot['inventory'];equipment:Snapshot['equipment'];enemies:Snapshot['enemies'];incomingDamage:Snapshot['incomingDamage'];environment:Snapshot['environment'];cause:'unconfirmed';possessionsObservedAt?:number;possessionsSource?:'last_alive_observation'|'death_event';respawn?:{at:number;position:Snapshot['position'];dimension?:string;inventory:Snapshot['inventory']};outcome?:RecoveryOutcome;outcomeHistory?:RecoveryOutcome[];decisionHistory?:(RecoveryDecision&{supersededAt:number;outcomeId?:string})[];decision?:RecoveryDecision};
export class RecoveryMemory{
 private records:DeathExperience[];
 constructor(private file?:string){this.records=file&&existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[];if(!Array.isArray(this.records)||this.records.some(d=>!d.id||!d.position||!Number.isFinite(d.at)))throw Error('Invalid recovery memory');}
 private reload(){if(this.file&&existsSync(this.file))this.records=JSON.parse(readFileSync(this.file,'utf8'));}
 acceptDeath(d:DeathExperience){this.reload();if(!this.records.some(x=>x.id===d.id)){this.records.push(structuredClone(d));this.save();}}
 private save(){if(!this.file)return;mkdirSync(dirname(this.file),{recursive:true,mode:0o700});const temp=this.file+'.tmp';writeFileSync(temp,JSON.stringify(this.records),{mode:0o600});renameSync(temp,this.file);}
 death(s:Snapshot,possessions?:AlivePossessions){this.reload();const d:DeathExperience={id:randomUUID(),at:Date.now(),dimension:s.dimension,position:{...s.position},inventory:structuredClone(possessions?.inventory??s.inventory??[]),equipment:structuredClone(possessions?.equipment??s.equipment??[]),possessionsObservedAt:possessions?.at??Date.now(),possessionsSource:possessions?'last_alive_observation':'death_event',enemies:structuredClone(s.enemies??[]),incomingDamage:structuredClone(s.incomingDamage??[]),environment:structuredClone(s.environment),cause:'unconfirmed'};this.records.push(d);this.save();return structuredClone(d);}
 respawn(s:Snapshot){this.reload();const d=this.records.at(-1);if(!d||d.respawn)return;d.respawn={at:Date.now(),position:{...s.position},dimension:s.dimension,inventory:structuredClone(s.inventory??[])};this.save();}
 decide(id:string,strategy:NonNullable<DeathExperience['decision']>['strategy'],reason:string){this.reload();const d=this.records.find(x=>x.id===id);if(!d||!['recover','prepare','defer','abandon','resolved'].includes(strategy)||typeof reason!=='string'||!reason.trim()||reason.length>500)throw Error('Invalid recovery decision');if(strategy==='resolved'&&d.outcome?.status!=='supplies_restored')throw Error('Invalid recovery completion without observed supplies');if(d.outcome?.status==='supplies_restored'&&strategy!=='resolved')throw Error('Invalid obsolete recovery intention');if(d.decision)d.decisionHistory=[...(d.decisionHistory??[]),{...d.decision,supersededAt:Date.now(),outcomeId:d.outcome?.id}].slice(-64);d.decision={strategy,reason,at:Date.now()};this.save();}

 // Match observed item kinds and enchantments, never infer the origin of gains.
 observe(s:Snapshot){
  this.reload();const d=this.records.at(-1);if(!d?.respawn||!s.ready||s.health<=0||s.lifecycle?.phase==='dead'||d.outcome?.status==='supplies_restored')return false;
  const totals=(items:Snapshot['inventory'])=>{const counts:Record<string,number>={};for(const i of items??[]){const key=JSON.stringify([i.name,[...(i.enchants??[])].map(e=>[e.name,e.lvl]).sort()]);counts[key]=(counts[key]??0)+i.count;}return counts;};
  const lost=totals(d.inventory),base=totals(d.respawn.inventory),current=totals(s.inventory),matched:Record<string,number>={},missing:Record<string,number>={};let required=0,found=0;
  for(const key of Object.keys(lost).sort()){const need=Math.max(0,lost[key]-(base[key]??0));if(!need)continue;const have=Math.min(need,Math.max(0,(current[key]??0)-(base[key]??0)));required+=need;found+=have;matched[key]=have;missing[key]=need-have;}
  const status:RecoveryOutcome['status']=!required?'unknown':found===required?'supplies_restored':found?'partial':'unresolved';
  if(d.outcome&&JSON.stringify([status,matched,missing])===JSON.stringify([d.outcome.status,d.outcome.matched,d.outcome.missing]))return false;
  const outcome:RecoveryOutcome={id:randomUUID(),version:(d.outcome?.version??0)+1,at:Date.now(),status,matched,missing,nearDeathSite:s.dimension===d.dimension&&Math.hypot(s.position.x-d.position.x,s.position.y-d.position.y,s.position.z-d.position.z)<=8,source:'own_inventory_observation',attribution:'origin_unconfirmed'};
  if(d.outcome)d.outcomeHistory=[...(d.outcomeHistory??[]),d.outcome].slice(-64);
  d.outcome=outcome;
  if(d.decision){d.decisionHistory=[...(d.decisionHistory??[]),{...d.decision,supersededAt:outcome.at,outcomeId:outcome.id}].slice(-64);delete d.decision;}
  if(status==='supplies_restored')d.decision={strategy:'resolved',at:outcome.at,reason:'Observed post-respawn supplies now cover the recorded loss by item kind and enchantment. Retrieval versus replacement origin is unconfirmed; this does not complete unrelated long-term goals.'};
  this.save();return true;
 }
 outcomeVersion(){this.reload();const d=this.records.at(-1);return JSON.stringify([d?.id,d?.outcome?.version??0]);}
 context(){this.reload();return structuredClone({deaths:this.records.slice(-5),warning:'Historical death observations only. Possessions may be the last alive observation, at possessionsObservedAt, not proof of actual dropped items; death-event inventories can already be cleared by server packet order. Cause, present danger, item survival and item location remain unknown until re-observed. Recovery must be judged from current gear, distance, observed terrain and experience; no forced retrieval. Inventory gain is not proof of drop origin. Outcome supplies_restored means the recorded supply deficit was covered, not exact item provenance or full durability/NBT equivalence. Completion is historical and survives later use of supplies. Superseded decisions are historical, not current advice. Reconsider paused recovery goals against fresh outcome evidence; do not automatically complete broader survival goals.'});}
}
