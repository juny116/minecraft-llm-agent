import {randomUUID} from 'node:crypto';
import {existsSync,readFileSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';
import type {Snapshot} from './types.js';
export type DeathExperience={id:string;at:number;dimension?:string;position:Snapshot['position'];inventory:Snapshot['inventory'];equipment:Snapshot['equipment'];enemies:Snapshot['enemies'];incomingDamage:Snapshot['incomingDamage'];environment:Snapshot['environment'];cause:'unconfirmed';respawn?:{at:number;position:Snapshot['position'];dimension?:string;inventory:Snapshot['inventory']};decision?:{strategy:'recover'|'prepare'|'defer'|'abandon';reason:string;at:number}};
export class RecoveryMemory{
 private records:DeathExperience[];
 constructor(private file?:string){this.records=file&&existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[];if(!Array.isArray(this.records)||this.records.some(d=>!d.id||!d.position||!Number.isFinite(d.at)))throw Error('Invalid recovery memory');}
 private reload(){if(this.file&&existsSync(this.file))this.records=JSON.parse(readFileSync(this.file,'utf8'));}
 acceptDeath(d:DeathExperience){this.reload();if(!this.records.some(x=>x.id===d.id)){this.records.push(structuredClone(d));this.save();}}
 private save(){if(!this.file)return;mkdirSync(dirname(this.file),{recursive:true,mode:0o700});const temp=this.file+'.tmp';writeFileSync(temp,JSON.stringify(this.records),{mode:0o600});renameSync(temp,this.file);}
 death(s:Snapshot){this.reload();const d:DeathExperience={id:randomUUID(),at:Date.now(),dimension:s.dimension,position:{...s.position},inventory:structuredClone(s.inventory??[]),equipment:structuredClone(s.equipment??[]),enemies:structuredClone(s.enemies??[]),incomingDamage:structuredClone(s.incomingDamage??[]),environment:structuredClone(s.environment),cause:'unconfirmed'};this.records.push(d);this.save();return structuredClone(d);}
 respawn(s:Snapshot){this.reload();const d=this.records.at(-1);if(!d||d.respawn)return;d.respawn={at:Date.now(),position:{...s.position},dimension:s.dimension,inventory:structuredClone(s.inventory??[])};this.save();}
 decide(id:string,strategy:NonNullable<DeathExperience['decision']>['strategy'],reason:string){this.reload();const d=this.records.find(x=>x.id===id);if(!d||!['recover','prepare','defer','abandon'].includes(strategy)||typeof reason!=='string'||!reason.trim()||reason.length>500)throw Error('Invalid recovery decision');d.decision={strategy,reason,at:Date.now()};this.save();}
 context(){this.reload();return structuredClone({deaths:this.records.slice(-5),warning:'Historical death observations only. Cause, present danger, item survival and item location remain unknown until re-observed. Recovery must be judged from current gear, distance, observed terrain and experience; no forced retrieval. Inventory gain is not proof of drop origin.'});}
}
