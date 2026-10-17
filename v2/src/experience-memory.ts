import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync,unlinkSync,openSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import type {ActionRecord} from './planning.js';
import type {Snapshot,Action} from './types.js';
import {actions} from './types.js';
export type Episode={id:string;session:string;record:ActionRecord;guidanceUsed:{id:string;version:number}[]};
export type GuideDraft={id:string;status:'active'|'retired';text:string;uncertainty:string;scope:{species:string[];equipment:string[];health:[number,number];action:Action};support:string[];counterexamples:string[]};
export type Guide=GuideDraft&{version:number;updatedAt:number;model:string};
export type Reflection={revision:number;through:number;episodes:Episode[];guides:Guide[]};
type Data={schema:1;profile:string;revision:number;reviewed:number;episodes:Episode[];guides:Guide[];revisions:Guide[]};
export class ExperienceMemory {
 readonly session=randomUUID();
 private file:string;private lock:string;private data:Data;
 constructor(private dir:string,private profile:string){
  mkdirSync(dir,{recursive:true,mode:0o700});this.file=join(dir,'memory.json');this.lock=join(dir,'write.lock');
  this.data=this.read();
 }
 private read():Data{
  if(!existsSync(this.file))return {schema:1,profile:this.profile,revision:0,reviewed:0,episodes:[],guides:[],revisions:[]};
  const d=JSON.parse(readFileSync(this.file,'utf8'));
  if(d.schema!==1||d.profile!==this.profile||!Array.isArray(d.episodes)||!Array.isArray(d.guides)||!Array.isArray(d.revisions)||!Number.isInteger(d.revision)||!Number.isInteger(d.reviewed))throw Error('Invalid experience memory; preserve file for recovery');
  if(d.episodes.some((e:any)=>typeof e.id!=='string'||!e.record?.decision||!e.record?.before||!e.record?.after))throw Error('Invalid experience episode');
  for(const g of d.guides)this.validate(g,new Set(d.episodes.map((e:Episode)=>e.id)),true);
  return d;
 }
 private change(fn:(d:Data)=>void){
  const fd=openSync(this.lock,'wx',0o600),tmp=this.file+'.'+randomUUID()+'.tmp';
  try{const d=this.read();fn(d);writeFileSync(tmp,JSON.stringify(d),{mode:0o600});renameSync(tmp,this.file);this.data=d;}
  finally{closeSync(fd);unlinkSync(this.lock);if(existsSync(tmp))unlinkSync(tmp);}
 }
 add(record:ActionRecord,used:{id:string;version:number}[]=[]){
  const e:Episode={id:randomUUID(),session:this.session,record:structuredClone(record),guidanceUsed:structuredClone(used)};
  this.change(d=>{d.episodes.push(e);});return e.id;
 }
 retrieve(s:Snapshot):Guide[]{
  this.data=this.read();const species=new Set(s.enemies?.map(e=>e.kind)??[]),gear=new Set(s.equipment?.map(e=>e.name)??[]);
  return structuredClone(this.data.guides.filter(g=>g.status==='active'&&s.health>=g.scope.health[0]&&s.health<=g.scope.health[1]
   &&(!g.scope.species.length||g.scope.species.some(x=>species.has(x)))&&g.scope.equipment.every(x=>gear.has(x)))
   .sort((a,b)=>(b.scope.species.length+b.scope.equipment.length)-(a.scope.species.length+a.scope.equipment.length)||b.updatedAt-a.updatedAt).slice(0,4).map(g=>['gather','dig_block','inspect_chest'].includes(g.scope.action)?{...g,legacyAction:g.scope.action,scope:{...g.scope,action:(String(g.scope.action)==='inspect_chest'?'inspect_container':'mine') as Action}}:g));
 }
 pending(){this.data=this.read();return this.data.episodes.length-this.data.reviewed;}
 reflection():Reflection{
  this.data=this.read();const d=this.data;
  // Review the next bounded batch, never silently skip an unreviewed backlog.
  const batch=d.episodes.slice(d.reviewed,d.reviewed+8);
  const relevant=d.guides.filter(g=>batch.some(e=>g.scope.action===e.record.decision.action||e.record.before.enemies.some(x=>g.scope.species.includes(x.kind)))).slice(-2);
  const refs=new Set(relevant.flatMap(g=>[...g.support,...g.counterexamples]));
  const prior=d.episodes.slice(0,d.reviewed),contrasts:Episode[]=[];
  for(const action of new Set(batch.map(e=>e.record.decision.action).filter(a=>a!=='look'&&a!=='idle'))){
   for(const success of [true,false])contrasts.push(...prior.filter(e=>e.record.decision.action===action&&(success?e.record.outcome==='succeeded':['failed','partial'].includes(e.record.outcome))).slice(-2));
  }
  const episodes=[...new Map([...batch,...d.episodes.filter(e=>refs.has(e.id)),...contrasts.slice(-12)].map(e=>[e.id,e])).values()].slice(0,40);
  return structuredClone({revision:d.revision,through:d.reviewed+batch.length,episodes,guides:relevant});
 }
 private validate(g:any,ids:Set<string>,historical=false){
  const list=(x:any,max:number)=>Array.isArray(x)&&x.length<=max&&x.every((v:any)=>typeof v==='string'&&v.length>0&&v.length<=100);
  if(!g||typeof g.id!=='string'||!/^[a-zA-Z0-9_-]{1,60}$/.test(g.id)||!['active','retired'].includes(g.status)||typeof g.text!=='string'||!g.text.trim()||g.text.length>600||typeof g.uncertainty!=='string'||!g.uncertainty.trim()||g.uncertainty.length>300||!g.scope||!(actions.includes(g.scope.action)||historical&&['gather','dig_block','inspect_chest'].includes(g.scope.action))||!list(g.scope.species,6)||!list(g.scope.equipment,6)||!Array.isArray(g.scope.health)||g.scope.health.length!==2||!g.scope.health.every((n:any)=>Number.isFinite(n)&&n>=0&&n<=20)||g.scope.health[0]>g.scope.health[1]||!list(g.support,8)||!g.support.length||!list(g.counterexamples,8)||[...g.support,...g.counterexamples].some(x=>!ids.has(x))||g.support.some((x:string)=>g.counterexamples.includes(x)))throw Error('Invalid or unsupported guideline');
 }
 apply(input:Reflection,updates:unknown,model='unspecified'){
  if(!Array.isArray(updates)||updates.length>6)throw Error('Invalid guideline updates');
  const ids=new Set(input.episodes.map(e=>e.id));for(const g of updates)this.validate(g,ids);
  if(new Set(updates.map(g=>g.id)).size!==updates.length)throw Error('Duplicate guideline update');
  this.change(d=>{
   if(d.revision!==input.revision||input.through<d.reviewed||input.through>d.episodes.length)throw Error('Stale memory reflection');
   const known=new Set(input.guides.map(g=>g.id));
   for(const raw of updates){
    const old=d.guides.find(g=>g.id===raw.id);if(old&&!known.has(raw.id))throw Error('Unseen guideline revision');
    if(old&&old.counterexamples.some(id=>!raw.counterexamples.includes(id)))throw Error('Cannot silently erase counterexamples');
    const g:Guide={id:raw.id,status:raw.status,text:raw.text,uncertainty:raw.uncertainty,scope:structuredClone(raw.scope),support:[...new Set(raw.support)] as string[],counterexamples:[...new Set(raw.counterexamples)] as string[],version:(old?.version??0)+1,updatedAt:Date.now(),model};
    d.guides=d.guides.filter(x=>x.id!==g.id);d.guides.push(g);d.revisions.push(structuredClone(g));
   }
   d.reviewed=input.through;d.revision++;
  });
 }
}

export function botMemoryLocation(mode:string,name:string,c:{host:string;port:number;version:string},root='runs/memory/experience'){
 const profile=JSON.stringify({namespace:process.env.MEMORY_NAMESPACE??'default',mode,host:c.host,port:c.port,version:c.version,name});
 return {dir:join(root,createHash('sha256').update(profile).digest('hex').slice(0,24)),profile};
}

export function openBotMemory(mode:string,name:string,c:{host:string;port:number;version:string},root='runs/memory/experience'){const {dir,profile}=botMemoryLocation(mode,name,c,root);return new ExperienceMemory(dir,profile);}
