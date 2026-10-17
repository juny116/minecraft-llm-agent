import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {compact,type ActionRecord} from './planning.js';
import type {Snapshot} from './types.js';

export const GAME_CONTEXT={version:1,description:'You live in a Minecraft survival world with other players. Manage health and food while gathering, crafting, building or exploring. Choose activities from current conditions and experience. Share information and cooperate when useful, without having to accept every proposal. Avoid needless danger while improving living conditions and learning about the world. No mandatory house, village, profession or fixed progression is assigned.'} as const;
export type GoalStatus='active'|'paused'|'completed'|'abandoned';
export type GoalDraft={id:string;description:string;reason:string;evidenceIds:string[];status:GoalStatus;successCriteria:string;pauseReason?:string};
export type Goal=GoalDraft&{version:number;createdAt:number;updatedAt:number};
export type GoalEvidence={id:string;kind:'observation'|'action'|'operator';at:number;data:unknown};
export type GoalReview={revision:number;needsReview:boolean;observationId:string;goals:Goal[];evidence:GoalEvidence[]};
type Data={schema:1;profile:string;revision:number;goals:Goal[];evidence:GoalEvidence[];revisions:Goal[]};
const text=(v:unknown,max:number)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
export function validateGoalUpdates(raw:unknown):asserts raw is GoalDraft[]{
 if(!Array.isArray(raw)||raw.length>8)throw Error('Invalid goal updates');const ids=new Set();
 for(const g of raw){if(!g||!text(g.id,60)||!/^[a-zA-Z0-9_-]+$/.test(g.id)||ids.has(g.id)||!text(g.description,400)||!text(g.reason,500)||!text(g.successCriteria,400)||!['active','paused','completed','abandoned'].includes(g.status)||!Array.isArray(g.evidenceIds)||g.evidenceIds.length<1||g.evidenceIds.length>8||!g.evidenceIds.every((x:unknown)=>text(x,100))||(g.status==='paused'&&!text(g.pauseReason,400))||(g.pauseReason!==undefined&&!text(g.pauseReason,400)))throw Error('Invalid goal update');ids.add(g.id);}
}
export class GoalBook{
 private data:Data;private pending:GoalEvidence[]=[];needsReview=true;
 constructor(private file?:string,private profile='ephemeral'){
  this.data=this.read();
 }
 private read():Data{
  if(!this.file||!existsSync(this.file))return {schema:1,profile:this.profile,revision:0,goals:[],evidence:[],revisions:[]};
  const d=JSON.parse(readFileSync(this.file,'utf8')) as Data;
  if(d.schema!==1||d.profile!==this.profile||!Number.isSafeInteger(d.revision)||d.revision<0||!Array.isArray(d.goals)||d.goals.length>32||!Array.isArray(d.revisions)||d.revisions.length>128||!Array.isArray(d.evidence)||d.evidence.length>1400)throw Error('Invalid goal memory; preserve file');
  for(const g of [...d.goals,...d.revisions]){validateGoalUpdates([g]);if(!Number.isSafeInteger(g.version)||g.version<1||!Number.isFinite(g.createdAt)||!Number.isFinite(g.updatedAt))throw Error('Invalid goal version');}
  if(new Set(d.goals.map(g=>g.id)).size!==d.goals.length||d.goals.filter(g=>g.status==='active').length>1)throw Error('Invalid goal identity');
  if(d.evidence.some(e=>!e||!text(e.id,100)||!['observation','action','operator'].includes(e.kind)||!Number.isFinite(e.at))||new Set(d.evidence.map(e=>e.id)).size!==d.evidence.length)throw Error('Invalid goal evidence');
  const ids=new Set(d.evidence.map(e=>e.id));if([...d.goals,...d.revisions].some(g=>g.evidenceIds.some(id=>!ids.has(id))))throw Error('Missing goal evidence');return d;
 }
 private persist(next:Data){
  if(!this.file){this.data=next;return;}
  mkdirSync(dirname(this.file),{recursive:true,mode:0o700});const lock=this.file+'.lock',fd=openSync(lock,'wx',0o600);
  try{if(this.read().revision!==this.data.revision)throw Error('Invalid stale goal revision');const tmp=this.file+'.'+randomUUID()+'.tmp';writeFileSync(tmp,JSON.stringify(next),{mode:0o600});renameSync(tmp,this.file);this.data=next;}finally{closeSync(fd);unlinkSync(lock);}
 }
 snapshot(){return {revision:this.data.revision,needsReview:this.needsReview,goals:structuredClone(this.data.goals),activeGoal:this.needsReview?null:structuredClone(this.data.goals.find(g=>g.status==='active')??null)};}
 private evidence(kind:GoalEvidence['kind'],data:unknown){const e={id:randomUUID(),kind,at:Date.now(),data:structuredClone(data)};this.pending.push(e);this.pending=this.pending.slice(-64);return e;}
 record(action:ActionRecord){this.evidence('action',{decision:action.decision,outcome:action.outcome,result:action.result,before:action.before,after:action.after,changes:action.changes});}
 pause(reason:string){
  this.needsReview=true;const next=structuredClone(this.data);let changed=false;
  for(const g of next.goals)if(g.status==='active'){g.status='paused';g.pauseReason=reason;g.updatedAt=Date.now();g.version++;next.revisions.push(structuredClone(g));changed=true;}
  if(changed){next.revisions=next.revisions.slice(-128);next.revision++;this.persist(next);}
 }
 review(s:Snapshot,userRequest:string|null):GoalReview{
  const observation=this.evidence('observation',{...compact(s),recovery:s.recovery,dimension:s.dimension,vision:s.vision,nearbyPlayers:s.nearbyPlayers,chatEvents:s.chatEvents});
  const operator=this.evidence('operator',{request:userRequest});
  // Always include the source facts for existing intentions, plus recent action evidence.
  const referenced=new Set(this.data.goals.flatMap(g=>g.evidenceIds));
  const all=new Map([...this.data.evidence.filter(e=>referenced.has(e.id)),...this.pending.slice(-16),observation,operator].map(e=>[e.id,e]));
  return {revision:this.data.revision,needsReview:this.needsReview,observationId:observation.id,goals:structuredClone(this.data.goals),evidence:structuredClone([...all.values()])};
 }
 apply(review:GoalReview,updates:unknown,activeId:string|null){
  validateGoalUpdates(updates);if(review.revision!==this.data.revision)throw Error('Invalid stale goal review');
  const allowed=new Set(review.evidence.map(e=>e.id)),next=structuredClone(this.data);
  for(const u of updates){
   if(u.evidenceIds.some(id=>!allowed.has(id)))throw Error('Invalid goal evidence reference');
   const old=next.goals.find(g=>g.id===u.id);
   if(old&&['completed','abandoned'].includes(old.status))throw Error('Invalid terminal goal revision; create a new goal');
   if((u.status==='active'||u.status==='completed')&&!u.evidenceIds.includes(review.observationId))throw Error('Invalid goal activation/completion without fresh observation');
   const g:Goal={id:u.id,description:u.description,reason:u.reason,status:u.status,successCriteria:u.successCriteria,evidenceIds:[...u.evidenceIds],pauseReason:u.status==='paused'?u.pauseReason:undefined,version:(old?.version??0)+1,createdAt:old?.createdAt??Date.now(),updatedAt:Date.now()};
   next.goals=next.goals.filter(x=>x.id!==u.id);next.goals.push(g);next.revisions.push(structuredClone(g));
  }
  const active=next.goals.filter(g=>g.status==='active');
  if(active.length>1||(activeId===null?active.length>0:active.length!==1||active[0].id!==activeId))throw Error('Invalid active goal selection');
  if(this.needsReview&&activeId!==null&&!updates.some(g=>g.id===activeId&&g.status==='active'&&g.evidenceIds.includes(review.observationId)))throw Error('Invalid unreviewed restored goal');
  if(next.goals.length>32||next.goals.filter(g=>g.status==='active'||g.status==='paused').length>8)throw Error('Invalid goal capacity');
  next.revisions=next.revisions.slice(-128);const refs=new Set([...next.goals,...next.revisions].flatMap(g=>g.evidenceIds));
  const all=new Map([...next.evidence,...review.evidence,...this.pending].map(e=>[e.id,e]));const recent=new Set([...all.keys()].slice(-64));next.evidence=[...all.values()].filter(e=>refs.has(e.id)||recent.has(e.id));
  next.revision++;this.persist(next);this.pending=[];this.needsReview=false;
 }
}
