import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync,unlinkSync,openSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import type {ActionRecord} from './planning.js';
import type {Snapshot,Action} from './types.js';
import {actions} from './types.js';
export type Episode={id:string;session:string;record:ActionRecord;guidanceUsed:{id:string;version:number}[]};
export type GuideDraft={supersedes?:string[];revisionReason?:string;id:string;status:'active'|'retired';text:string;uncertainty:string;scope:{species:string[];equipment:string[];health:[number,number];food?:[number,number];hasFood?:boolean;inventory?:{item:string;min:number}[];action:Action};support:string[];counterexamples:string[]};
export type Guide=GuideDraft&{version:number;updatedAt:number;model:string};
export type Reflection={maintenance?:boolean;followupWindows?:ReturnType<typeof followupWindows>;feedback?:string;passiveSummary?:{count:number;byAction:Record<string,number>;note:string};revision:number;through:number;episodes:Episode[];guides:Guide[]};
type Data={lastMaintenanceAt?:number;schema:1;profile:string;revision:number;reviewed:number;episodes:Episode[];guides:Guide[];revisions:Guide[]};
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
 retrieve(_s?:Snapshot,_actions:Action[]=[]):Guide[]{
  this.data=this.read();return structuredClone(this.data.guides.filter(g=>g.status==='active').map(g=>['gather','dig_block','inspect_chest'].includes(g.scope.action)?{...g,legacyAction:g.scope.action,scope:{...g.scope,action:(String(g.scope.action)==='inspect_chest'?'inspect_container':'mine') as Action}}:g));
 }
 needsMaintenance(now=Date.now()){
  this.data=this.read();const active=this.data.guides.filter(g=>g.status==='active');
  return active.length>0&&now-(this.data.lastMaintenanceAt??0)>=(JSON.stringify(guidebookView(active)).length>6000?60000:300000);
 }

 pending(){this.data=this.read();return this.data.episodes.length-this.data.reviewed;}
 reflection():Reflection{
  this.data=this.read();const d=this.data;
  // Review the next bounded batch, never silently skip an unreviewed backlog.
  const batch:Episode[]=[],passive:Episode[]=[];let end=d.reviewed;
  // Preserve raw episodes. Summarize only unchanged successful idle/look, in order.
  for(const e of d.episodes.slice(d.reviewed,d.reviewed+128)){
   const r=e.record,unchanged=r.outcome==='succeeded'&&['idle','look'].includes(r.decision.action)&&r.changes.health===0&&r.changes.food===0&&!Object.values(r.changes.inventory).some(n=>n!==0)&&JSON.stringify(r.before.position)===JSON.stringify(r.after.position)&&!r.changes.enemiesEntered.length&&!r.changes.enemiesLeft.length;
   if(unchanged)passive.push(e);else batch.push(e);end++;
   if(batch.length>=8)break;
  }
  const byAction:Record<string,number>={};for(const e of passive)byAction[e.record.decision.action]=(byAction[e.record.decision.action]??0)+1;
  batch.push(...passive.slice(0,1));if(passive.length>1)batch.push(passive[passive.length-1]);
  const relevant=d.guides.filter(g=>g.status==='active');
  const refs=new Set(relevant.flatMap(g=>[...g.support,...g.counterexamples]));
  const prior=d.episodes.slice(0,d.reviewed),contrasts:Episode[]=[];
  for(const action of new Set(batch.map(e=>e.record.decision.action).filter(a=>a!=='look'&&a!=='idle'))){
   for(const success of [true,false])contrasts.push(...prior.filter(e=>e.record.decision.action===action&&(success?e.record.outcome==='succeeded':['failed','partial'].includes(e.record.outcome))).slice(-2));
  }
  // Revisit earlier choices when later outcomes arrive, including a previously deferred meal.
  const temporal=d.episodes.slice(0,end).filter(e=>batch.some(b=>e.session===b.session&&e.record.endedAt<=b.record.startedAt&&b.record.startedAt-e.record.endedAt<=120000)).slice(-12);
  const episodes=[...new Map([...batch,...temporal,...d.episodes.filter(e=>refs.has(e.id)),...contrasts.slice(-12)].map(e=>[e.id,e])).values()]; // Bounded new/contrast batches plus every active-guide evidence reference; never truncate referenced evidence.
  return structuredClone({maintenance:this.needsMaintenance(),revision:d.revision,through:end,episodes,guides:relevant,followupWindows:followupWindows(episodes),passiveSummary:{count:passive.length,byAction,note:'Raw episodes retained. Unchanged successful idle/look summarized; this does not prove no new visual information. Only explicitly supplied episode IDs may support guidance.'}});
 }
 private validate(g:any,ids:Set<string>,historical=false){
  const range=(x:any)=>Array.isArray(x)&&x.length===2&&x.every((n:any)=>Number.isFinite(n)&&n>=0&&n<=20)&&x[0]<=x[1];
  if(g?.scope?.food!==undefined&&!range(g.scope.food)||g?.scope?.hasFood!==undefined&&typeof g.scope.hasFood!=='boolean'||g?.scope?.inventory!==undefined&&(!Array.isArray(g.scope.inventory)||g.scope.inventory.length>6||g.scope.inventory.some((t:any)=>!t||!/^[a-z0-9_]+$/.test(t.item)||!Number.isInteger(t.min)||t.min<0||t.min>2304)))throw Error('Invalid guideline situational scope');
  if(g?.scope&&(!Array.isArray(g.scope.health)||g.scope.health.length!==2||!g.scope.health.every((n:any)=>Number.isFinite(n)&&n>=0&&n<=20)||g.scope.health[0]>g.scope.health[1]))throw Error('Invalid guideline scope.health: exactly [minimum,maximum] in 0..20; use [0,20] for any health, never []');
  if(g&&typeof g.text==='string'&&g.text.length>600)throw Error('Invalid guideline text: max 600 characters');
  if(g&&typeof g.uncertainty==='string'&&g.uncertainty.length>300)throw Error('Invalid guideline uncertainty: max 300 characters');
  if(g&&Array.isArray(g.support)&&g.support.length>8)throw Error('Invalid guideline support: max 8 episode IDs');
  if(g&&Array.isArray(g.counterexamples)&&g.counterexamples.length>8)throw Error('Invalid guideline counterexamples: max 8 episode IDs; preserve prior counterexamples');
  if(Array.isArray(g?.support)&&Array.isArray(g?.counterexamples)&&[...g.support,...g.counterexamples].some(x=>!ids.has(x)))throw Error('Invalid guideline evidence: copy only exact episode IDs supplied in this reflection; no invented or altered IDs');
  if(Array.isArray(g?.support)&&Array.isArray(g?.counterexamples)&&g.support.some((x:string)=>g.counterexamples.includes(x)))throw Error('Invalid guideline evidence: support and counterexamples must not overlap');
  const list=(x:any,max:number)=>Array.isArray(x)&&x.length<=max&&x.every((v:any)=>typeof v==='string'&&v.length>0&&v.length<=100);
  if(!g||typeof g.id!=='string'||!/^[a-zA-Z0-9_-]{1,60}$/.test(g.id)||!['active','retired'].includes(g.status)||typeof g.text!=='string'||!g.text.trim()||g.text.length>600||typeof g.uncertainty!=='string'||!g.uncertainty.trim()||g.uncertainty.length>300||!g.scope||!(actions.includes(g.scope.action)||historical&&['gather','dig_block','inspect_chest'].includes(g.scope.action))||!list(g.scope.species,6)||!list(g.scope.equipment,6)||!Array.isArray(g.scope.health)||g.scope.health.length!==2||!g.scope.health.every((n:any)=>Number.isFinite(n)&&n>=0&&n<=20)||g.scope.health[0]>g.scope.health[1]||!list(g.support,8)||!g.support.length||!list(g.counterexamples,8)||[...g.support,...g.counterexamples].some(x=>!ids.has(x))||g.support.some((x:string)=>g.counterexamples.includes(x)))throw Error('Invalid or unsupported guideline');
 }
 apply(input:Reflection,updates:unknown,model='unspecified'){
  if(!Array.isArray(updates)||updates.length>32)throw Error('Invalid guideline updates');
  const ids=new Set(input.episodes.map(e=>e.id));for(const g of updates){
   this.validate(g,ids);
   // Old persisted drafts can be retired verbatim; active revisions must be concise.
   if(g.status==='active'&&(g.text.length>240||g.uncertainty.length>160))throw Error('Invalid guideline: one concise sentence max240 chars and uncertainty max160 chars');
   if(g.revisionReason!==undefined&&(typeof g.revisionReason!=='string'||!g.revisionReason.trim()||g.revisionReason.length>240))throw Error('Invalid guideline revision reason');
   if(g.supersedes!==undefined&&(!Array.isArray(g.supersedes)||!g.supersedes.length||new Set(g.supersedes).size!==g.supersedes.length||g.supersedes.includes(g.id)||g.status!=='active'||typeof g.revisionReason!=='string'||!g.revisionReason.trim()||g.revisionReason.length>240))throw Error('Invalid guideline merge: supersedes must be nonempty other guide IDs, never this draft ID; active status and revisionReason required; omit supersedes when not merging');
  }
  const merged=updates.flatMap(g=>g.supersedes??[]);
  if(new Set(merged).size!==merged.length||merged.some(id=>updates.some(g=>g.id===id)))throw Error('Invalid overlapping guideline merge');
  if(new Set(updates.map(g=>g.id)).size!==updates.length)throw Error('Duplicate guideline update');
  this.change(d=>{
   if(d.revision!==input.revision||input.through<d.reviewed||input.through>d.episodes.length)throw Error('Stale memory reflection');
   const known=new Set(input.guides.map(g=>g.id));
   for(const raw of updates){
    const old=d.guides.find(g=>g.id===raw.id);if(old&&!known.has(raw.id))throw Error('Unseen guideline revision');
    if(old&&old.counterexamples.some(id=>!raw.counterexamples.includes(id)))throw Error('Cannot silently erase counterexamples');
    for(const id of raw.supersedes??[]){
     const source=d.guides.find(g=>g.id===id);
     if(!source||source.status!=='active'||!known.has(id))throw Error('Unseen guideline merge');
     if(source.counterexamples.some(x=>!raw.counterexamples.includes(x))||!source.support.some(x=>raw.support.includes(x)))throw Error('Cannot erase merge evidence or counterexamples');
    }
    const g:Guide={...(raw.supersedes?{supersedes:[...raw.supersedes]}:{}),...(typeof raw.revisionReason==='string'?{revisionReason:raw.revisionReason}:{}),id:raw.id,status:raw.status,text:raw.text,uncertainty:raw.uncertainty,scope:structuredClone(raw.scope),support:[...new Set(raw.support)] as string[],counterexamples:[...new Set(raw.counterexamples)] as string[],version:(old?.version??0)+1,updatedAt:Date.now(),model};
    d.guides=d.guides.filter(x=>x.id!==g.id);d.guides.push(g);d.revisions.push(structuredClone(g));
    for(const id of raw.supersedes??[]){const source=d.guides.find(x=>x.id===id)!;source.status='retired';source.version++;source.updatedAt=Date.now();source.model=model;source.revisionReason=`Merged into ${g.id}: ${raw.revisionReason}`;d.revisions.push(structuredClone(source));}
   }
   d.reviewed=input.through;d.revision++;d.lastMaintenanceAt=Date.now();
  });
 }
}

export function botMemoryLocation(mode:string,name:string,c:{host:string;port:number;version:string},root='runs/memory/experience'){
 const profile=JSON.stringify({namespace:process.env.MEMORY_NAMESPACE??'default',mode,host:c.host,port:c.port,version:c.version,name});
 return {dir:join(root,createHash('sha256').update(profile).digest('hex').slice(0,24)),profile};
}

export function openBotMemory(mode:string,name:string,c:{host:string;port:number;version:string},root='runs/memory/experience'){const {dir,profile}=botMemoryLocation(mode,name,c,root);return new ExperienceMemory(dir,profile);}

// All active hypotheses, no top-k or condition filtering. Conditions remain explicit.
export function guidebookView(guides:Guide[]){return guides.filter(g=>g.status==='active').map(g=>({id:g.id,version:g.version,text:g.text,scope:g.scope,uncertainty:g.uncertainty,evidence:{supportCount:g.support.length,counterexampleCount:g.counterexamples.length}}));}
// Descriptive sequence evidence, never a label saying food=5 requires eating.
// Same session only; a finite observation window cannot establish future safety.
export function followupWindows(episodes:Episode[]){
 const ordered=[...episodes].sort((a,b)=>a.record.startedAt-b.record.startedAt);
 return ordered.filter(e=>e.record.before.food<20&&e.record.decision.action!=='eat'&&e.record.outcome!=='skipped').slice(-12).map(e=>{
  const later=ordered.filter(n=>n.session===e.session&&n.id!==e.id&&(e.record.before.lifeGeneration===undefined||n.record.before.lifeGeneration===e.record.before.lifeGeneration)&&n.record.startedAt>=e.record.endedAt&&n.record.startedAt-e.record.endedAt<=120000);
  const sequence=[e,...later],food=sequence.flatMap(n=>[n.record.before.food,n.record.after.food]);
  const meal=later.find(n=>n.record.decision.action==='eat'&&n.record.changes.food>0);
  return {decisionId:e.id,evidenceIds:sequence.map(n=>n.id),observedThrough:sequence.at(-1)!.record.endedAt,initialFood:e.record.before.food,minFood:Math.min(...food),emptyGaugeObserved:food.includes(0),laterMeal:meal?{episodeId:meal.id,delayMs:meal.record.endedAt-e.record.endedAt}:null,healthLossObserved:sequence.reduce((sum,n)=>sum+Math.max(0,-n.record.changes.health),0),status:later.length?'followup_observed':'pending' as string,note:'No fixed eating threshold or causal starvation claim. Missing later meal is not proof none occurred; window is bounded and may omit observations.'};
 });
}
