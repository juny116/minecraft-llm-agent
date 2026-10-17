import {randomUUID} from 'node:crypto';
import {mkdirSync,existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';
import {actions,type Action} from './types.js';
import type {ActionRecord} from './planning.js';
export type ChatEvent={id:string;at:number;speaker:string;text:string};
export type AliasUpdate={alias:string;subject:string;evidenceId:string;certainty:'tentative'|'confirmed';reason:string};
export type Speech={aliases?:AliasUpdate[];to:string;kind:'proposal'|'accept'|'decline'|'question'|'report'|'warning'|'chat';text:string;replyTo?:string;promise?:{id:string;task:string;action:Action;status:'accepted'|'cancelled'|'completed';actionEvidence?:string}};
type PromiseRecord=NonNullable<Speech['promise']>&{sourceMessage:string;updatedAt:number};
type SocialData={routes?:Record<string,{route:import('./supervision.js').Route|'handled';at:number}>;aliases?:(AliasUpdate&{speaker:string;at:number})[];reportKeys?:string[];schema:1;self:string;events:ChatEvent[];promises:PromiseRecord[];actionEvidence:{id:string;at:number;action:Action;outcome:string;result:string}[]};
export function validateSpeech(s:any):Speech{
 if(!s||!['proposal','accept','decline','question','report','warning','chat'].includes(s.kind)||typeof s.to!=='string'||!/^([A-Za-z0-9_]{1,16}|all)$/.test(s.to)||typeof s.text!=='string'||!s.text.trim()||s.text.length>180||/[\r\n\u0000-\u001f\u007f]/.test(s.text)||s.text.trimStart().startsWith('/')||(s.replyTo!==undefined&&typeof s.replyTo!=='string'))throw Error('Invalid speech');
 if(s.promise){const p=s.promise;if(typeof p.id!=='string'||!/^[a-zA-Z0-9_-]{1,60}$/.test(p.id)||typeof p.task!=='string'||!p.task.trim()||p.task.length>200||!actions.includes(p.action)||!['accepted','cancelled','completed'].includes(p.status)||(p.actionEvidence!==undefined&&typeof p.actionEvidence!=='string'))throw Error('Invalid promise');}
 return structuredClone(s);
}
export class SocialMemory {
 private data:SocialData;private lastSent=-Infinity;private sent:number[]=[];private recentTexts=new Set<string>();
 constructor(readonly self:string,private file?:string){
  this.data=file&&existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{schema:1,self,events:[],promises:[],actionEvidence:[]};
  if(this.data.schema!==1||this.data.self!==self||!Array.isArray(this.data.events)||!Array.isArray(this.data.promises)||!Array.isArray(this.data.actionEvidence))throw Error('Invalid social memory');
  for(const e of this.data.events.filter(e=>e.speaker===self).slice(-20)){this.recentTexts.add(e.text);this.lastSent=Math.max(this.lastSent,e.at);this.sent.push(e.at);}
 }
 private save(){if(!this.file)return;mkdirSync(dirname(this.file),{recursive:true,mode:0o700});const tmp=this.file+'.'+randomUUID()+'.tmp';writeFileSync(tmp,JSON.stringify(this.data),{mode:0o600});renameSync(tmp,this.file);}
 ingest(events:ChatEvent[]){let changed=false;const known=new Set(this.data.events.map(e=>e.id));for(const e of events){if(e.speaker===this.self||known.has(e.id))continue;if(!/^[A-Za-z0-9_]{1,16}$/.test(e.speaker)||!e.text||e.text.length>250)continue;this.data.events.push(structuredClone(e));known.add(e.id);changed=true;}if(changed)this.save();return changed;}
 context(){return structuredClone({self:this.self,heard:this.data.events.slice(-16).map(e=>({...e,source:e.speaker===this.self?'self_statement':'heard_unverified'})),promises:this.data.promises.slice(-12),aliases:(this.data.aliases??[]).slice(-24),inbox:this.addressed().map(e=>({...e,routing:this.data.routes?.[e.id]?.route})),recentActionEvidence:this.data.actionEvidence.slice(-8)});}
 pendingRouting(now=Date.now()){return this.data.events.filter(e=>e.speaker!==this.self&&(!this.data.routes?.[e.id]||this.data.routes[e.id].route==='defer'&&now-this.data.routes[e.id].at>=10000)).slice(0,6).map(e=>structuredClone(e));}
 route(id:string,route:import('./supervision.js').Route,now=Date.now()){if(!['respond','clarify','observe','other','defer'].includes(route)||!this.data.events.some(e=>e.id===id&&e.speaker!==this.self))throw Error('Invalid conversation route');this.data.routes??={};this.data.routes[id]={route,at:now};this.save();}
 addressed(){return this.data.events.filter(e=>['respond','clarify'].includes(this.data.routes?.[e.id]?.route??'')).slice(0,8).map(e=>structuredClone(e));}
 handled(ids:string[]){this.data.routes??={};for(const id of ids)if(this.data.events.some(e=>e.id===id))this.data.routes[id]={route:'handled',at:Date.now()};this.save();}
 rememberAliases(updates:AliasUpdate[]){
  if(!Array.isArray(updates)||updates.length>4)throw Error('Invalid alias updates');
  const known=new Set([this.self,...this.data.events.map(e=>e.speaker)]);
  const validated=updates.map(u=>{const e=this.data.events.find(e=>e.id===u.evidenceId);if(!e||!known.has(u.subject)||typeof u.alias!=='string'||!u.alias.trim()||u.alias.length>40||!e.text.normalize('NFKC').toLowerCase().includes(u.alias.normalize('NFKC').toLowerCase())||!['tentative','confirmed'].includes(u.certainty)||typeof u.reason!=='string'||!u.reason.trim()||u.reason.length>300)throw Error('Invalid alias evidence');return {...u,speaker:e.speaker,at:Date.now()};});
  // Speaker-scoped, fallible hypotheses; conflicting aliases coexist for clarification.
  this.data.aliases=[...(this.data.aliases??[]),...validated].slice(-64);for(const e of this.data.events.slice(-16))if(['other','defer'].includes(this.data.routes?.[e.id]?.route??''))delete this.data.routes![e.id];this.save();
 }
 recordAction(r:ActionRecord){const id=randomUUID();this.data.actionEvidence.push({id,at:Date.now(),action:r.decision.action,outcome:r.outcome,result:r.result.slice(0,600)});this.save();return id;}
 canSpeak(now=Date.now()){return now-this.lastSent>=8000&&this.sent.filter(t=>now-t<60000).length<4;}
 send(raw:Speech,chat:(text:string)=>void,now=Date.now(),reportKey?:string){
  const s=validateSpeech(raw),text=((s.to==='all'?'':s.to+', ')+s.text).slice(0,180);
  this.sent=this.sent.filter(t=>now-t<60000);
  if(now-this.lastSent<8000||this.sent.length>=4||this.recentTexts.has(text))return {sent:false,reason:'rate_or_duplicate'};
  if(s.kind==='report'&&!s.replyTo&&!s.promise&&reportKey&&this.data.reportKeys?.includes(reportKey))return {sent:false,reason:'no_new_report_evidence'};
  if(s.to===this.self)return {sent:false,reason:'self_address'};
  if(s.replyTo&&!this.data.events.some(e=>e.id===s.replyTo&&e.speaker!==this.self&&(s.to==='all'||s.to===e.speaker)))return {sent:false,reason:'unknown_reply'};
  if(['accept','decline'].includes(s.kind)&&!s.replyTo)return {sent:false,reason:'missing_reply'};
  const old=this.data.promises.find(p=>p.id===s.promise?.id);
  if(s.promise?.status==='completed'&&(!old||old.status!=='accepted'||old.action!==s.promise.action||!this.data.actionEvidence.some(e=>e.id===s.promise!.actionEvidence&&e.action===old.action&&e.outcome==='succeeded'&&e.at>=old.updatedAt)))return {sent:false,reason:'missing_completion_evidence'};
  if(s.promise?.status==='cancelled'&&!old)return {sent:false,reason:'unknown_promise'};
  const e:ChatEvent={id:randomUUID(),speaker:this.self,text,at:now};
  chat(text);this.lastSent=now;this.sent.push(now);this.recentTexts.add(text);if(this.recentTexts.size>30)this.recentTexts.delete(this.recentTexts.values().next().value!);
  this.data.events.push(e);
  if(s.kind==='report'&&reportKey)this.data.reportKeys=[...(this.data.reportKeys??[]),reportKey].slice(-32);
  if(s.promise){this.data.promises=this.data.promises.filter(p=>p.id!==s.promise!.id);this.data.promises.push({...s.promise,sourceMessage:e.id,updatedAt:now});}
  this.save();return {sent:true,event:e};
 }
}
