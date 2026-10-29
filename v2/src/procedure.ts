import {pickupTargets} from './pickup.js';
import {candidates,type Action,type Plan,type Snapshot} from './types.js';
import type {Outcome} from './planning.js';
import {randomUUID} from 'node:crypto';

type Position=Snapshot['position'];
export type RecipeFact={key:string;item:string;output:number;ingredients:{item:string;count:number}[];requiresTable:boolean};
export type ProcedureStep=
 | {id:string;action:'mine';item:string;area:{center:Position;radius:number};targetCount?:number;materialsFor?:string}
 | {id:string;action:'craft';item:string;targetCount:number;recipeInputs:string[];workstation?:Position};
export type Procedure={version:1;steps:ProcedureStep[];maxActions:number;maxMs:number};
export type RecipeLookup=(item:string)=>RecipeFact[];
export type MaterialReport={recipe:RecipeFact;outputHeld:number;outputTarget:number;executions:number;ingredients:{item:string;required:number;held:number;missing:number}[]};
export type ProcedureView={id:string;status:'running'|'completed'|'blocked'|'suspended';taskId?:string;definition:Procedure;stepIndex:number;completedSteps:string[];actions:number;reason?:string;resumeAvailable?:boolean;remainingMs?:number;materials?:MaterialReport};
const itemName=(x:unknown):x is string=>typeof x==='string'&&/^[a-z0-9_]+$/.test(x);
const integer=(x:unknown,min:number,max:number)=>Number.isInteger(x)&&Number(x)>=min&&Number(x)<=max;
const point=(p:any)=>p&&['x','y','z'].every(k=>Number.isSafeInteger(p[k]))&&Math.abs(p.x)<=30000000&&Math.abs(p.z)<=30000000&&p.y>=-64&&p.y<=319;
export function parseProcedure(raw:any):Procedure {
 if(!raw||raw.version!==1||!Array.isArray(raw.steps)||!raw.steps.length||raw.steps.length>6||!integer(raw.maxActions,1,64)||!integer(raw.maxMs,1000,600000))throw Error('Invalid procedure: version=1, 1..6 steps, maxActions=1..64, maxMs=1000..600000');
 const ids=new Set<string>();
 for(const s of raw.steps){
  if(!s||typeof s.id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(s.id)||ids.has(s.id)||!itemName(s.item))throw Error('Invalid procedure step identity');
  ids.add(s.id);
  if(s.action==='mine'){
   if(!point(s.area?.center)||!integer(s.area?.radius,1,12)||((s.targetCount!==undefined)===(s.materialsFor!==undefined))||s.targetCount!==undefined&&!integer(s.targetCount,1,2304))throw Error('Invalid procedure mine: bounded area and exactly one of targetCount/materialsFor required');
  }else if(s.action==='craft'){
   if(!integer(s.targetCount,1,2304)||!Array.isArray(s.recipeInputs)||!s.recipeInputs.length||s.recipeInputs.length>9||s.recipeInputs.some((x:any)=>!itemName(x)))throw Error('Invalid procedure craft: target total and exact ingredient names required');
   // CONT4: 13 of 53 output repairs were these two; name the field so the error says what to change.
   if(new Set(s.recipeInputs).size!==s.recipeInputs.length)throw Error(`Invalid procedure craft ${s.id}: recipeInputs lists each distinct ingredient name once; counts are computed locally`);
   if(s.workstation!==undefined&&!point(s.workstation))throw Error(`Invalid procedure craft ${s.id}: workstation must be an {x,y,z} integer object of an observed crafting_table, not text; omit it for recipes without a table`);
  }else throw Error('Invalid procedure action: this version supports mine and craft steps only');
  const allowed=s.action==='mine'?['id','action','item','area','targetCount','materialsFor']:['id','action','item','targetCount','recipeInputs','workstation'];
  if(Object.keys(s).some(k=>!allowed.includes(k)))throw Error('Invalid procedure step field; no hidden commands or code');
 }
 raw.steps.forEach((s:any,index:number)=>{
  if(s.action==='mine'&&s.materialsFor!==undefined){
   const later=raw.steps.slice(index+1).find((c:any)=>c.id===s.materialsFor);
   if(later?.action!=='craft'||!later.recipeInputs.includes(s.item))throw Error(`Invalid procedure materialsFor: step ${s.id} names "${String(s.materialsFor).slice(0,40)}", but materialsFor must be the id of a later craft step in this procedure whose recipeInputs include ${s.item}. It is not a purpose label; for collection used otherwise (building, placing), give targetCount instead`);
  }
 });
 return structuredClone(raw);
}
export function carried(s:Snapshot,item:string){return (s.inventory??[]).filter(i=>i.name===item&&i.slot>=9&&i.slot<=44).reduce((n,i)=>n+i.count,0);}
export function recipeKey(r:Omit<RecipeFact,'key'>){return JSON.stringify([r.item,r.output,r.requiresTable,[...r.ingredients].sort((a,b)=>a.item.localeCompare(b.item)).map(i=>[i.item,i.count])]);}
// Only callers holding the bot's unlock record may expose these facts. No hidden catalog in prompts.
export function recipeFact(recipe:any,items:Record<number,{name:string}>):RecipeFact|undefined{
 const item=items[recipe.result?.id]?.name,output=recipe.result?.count;
 if(!item||!integer(output,1,64))return;
 const ingredients:{item:string;count:number}[]=[];
 for(const d of recipe.delta??[]){
  if(d.count>=0){if(d.count>0&&d.id!==recipe.result.id)return;continue;}
  if(!items[d.id]||d.metadata>0)return;
  const name=items[d.id].name,prior=ingredients.find(i=>i.item===name);
  if(prior)prior.count-=d.count;else ingredients.push({item:name,count:-d.count});
 }
 if(!ingredients.length)return;
 const r={item,output,ingredients:ingredients.sort((a,b)=>a.item.localeCompare(b.item)),requiresTable:!!recipe.requiresTable};
 return {...r,key:recipeKey(r)};
}
export function materials(step:Extract<ProcedureStep,{action:'craft'}>,s:Snapshot,lookup:RecipeLookup):MaterialReport{
 if(!s.recipeBook.unlocked.some(id=>id.replace(/^minecraft:/,'')===step.item))throw Error('Recipe is not unlocked: '+step.item);
 const names=[...step.recipeInputs].sort().join(','),matches=lookup(step.item).filter(r=>r.item===step.item&&r.ingredients.map(i=>i.item).sort().join(',')===names);
 const unique=[...new Map(matches.map(r=>[r.key,r])).values()];
 if(unique.length!==1)throw Error('Recipe is missing or ambiguous for selected inputs: '+step.item);
 const recipe=unique[0],outputHeld=carried(s,step.item),executions=Math.ceil(Math.max(0,step.targetCount-outputHeld)/recipe.output);
 return {recipe,outputHeld,outputTarget:step.targetCount,executions,ingredients:recipe.ingredients.map(i=>{const held=carried(s,i.item),required=i.count*executions;return {item:i.item,required,held,missing:Math.max(0,required-held)};})};
}
export type ProcedureCommand={action:Action;plan:Plan;binding:string;stepId:string};
export class ProcedureRunner {
 private state:ProcedureView;
 private started:number;
 private attempted=new Set<string>();
 private awaitingDrop=false;
 private resumeAllowed=false;
 private pending?:{command:ProcedureCommand;held:number};
 constructor(readonly owner:Plan,readonly definition:Procedure,now=Date.now()){
  this.definition=parseProcedure(definition);this.owner=structuredClone(owner);this.started=now;
  this.state={id:randomUUID(),status:'running',taskId:owner.intent?.taskId,definition:this.definition,stepIndex:0,completedSteps:[],actions:0};
 }
 view(now=Date.now()){return structuredClone({...this.state,resumeAvailable:this.state.status==='suspended'&&this.resumeAllowed&&!this.pending&&now-this.started<this.definition.maxMs&&this.state.actions<this.definition.maxActions,remainingMs:Math.max(0,this.definition.maxMs-(now-this.started))});}
 remainingMs(now=Date.now()){return Math.max(1,this.definition.maxMs-(now-this.started));}
 suspend(reason:string,resumable=false){
  if(this.state.status==='running'){this.state.status='suspended';this.state.reason=reason;this.resumeAllowed=resumable;}
  else if(!resumable){this.resumeAllowed=false;}
 }
 resume(s:Snapshot,now=Date.now()){
  if(!this.view(now).resumeAvailable||!s.ready||s.health<=0)return false;
  this.state.status='running';delete this.state.reason;this.resumeAllowed=false;return true;
 }
 block(reason:string){this.state.status='blocked';this.state.reason=reason;return undefined;}
 next(s:Snapshot,lookup:RecipeLookup,now=Date.now()):ProcedureCommand|undefined {
  if(this.state.status!=='running'||this.pending)return;
  if(!s.ready||s.health<=0)return this.block('World is not ready or bot is dead');
  if(now-this.started>=this.definition.maxMs)return this.block('Procedure time budget reached');
  try{
   while(this.state.stepIndex<this.definition.steps.length){
    const step=this.definition.steps[this.state.stepIndex];let target:number,report:MaterialReport|undefined;
    const dependent=step.action==='mine'&&step.materialsFor?this.definition.steps.find(c=>c.id===step.materialsFor) as Extract<ProcedureStep,{action:'craft'}>:undefined;
    // Already-owned output does not require a recipe lookup or more ingredients.
    if(step.targetCount!==undefined&&carried(s,step.item)>=step.targetCount||dependent&&carried(s,dependent.item)>=dependent.targetCount){
     if(this.state.materials&&carried(s,this.state.materials.recipe.item)>=this.state.materials.outputTarget){
      this.state.materials={...this.state.materials,outputHeld:carried(s,this.state.materials.recipe.item),executions:0,ingredients:this.state.materials.ingredients.map(i=>({...i,held:carried(s,i.item),required:0,missing:0}))};
     }
     this.state.completedSteps.push(step.id);this.state.stepIndex++;continue;
    }
    if(step.action==='craft')report=materials(step,s,lookup);
    else if(dependent)report=materials(dependent,s,lookup);
    this.state.materials=report;
    target=step.action==='craft'?step.targetCount:step.targetCount??report!.ingredients.find(i=>i.item===step.item)!.required;
    if(carried(s,step.item)>=target){
     this.state.completedSteps.push(step.id);this.state.stepIndex++;continue;
    }
    if(this.state.actions>=this.definition.maxActions)return this.block('Procedure action budget reached');
    const plan:Plan={goal:this.owner.goal,intent:this.owner.intent,preferred:step.action,modelSelected:true};
    let action:Action=step.action,binding:string;
    if(step.action==='craft'){
     if(report!.ingredients.some(i=>i.missing>0))return this.block('Missing crafting materials; planner must revise prerequisites');
     if(report!.recipe.requiresTable&&!step.workstation)return this.block('Selected recipe needs a model-specified workstation');
     plan.craft={item:step.item,count:Math.min(16,report!.executions),recipeKey:report!.recipe.key,workstation:step.workstation};
     binding='recipe arithmetic: ceil(output deficit / recipe yield); selected exact ingredient variant';
    }else{
     const within=(p:Position)=>Math.hypot(p.x-step.area.center.x,p.y-step.area.center.y,p.z-step.area.center.z)<=step.area.radius;
     const distance=(p:Position)=>Math.hypot(p.x-s.position.x,p.y-s.position.y,p.z-s.position.z);
     const drops=pickupTargets(s).filter(i=>i.name===step.item&&within(i.position)&&!this.attempted.has('drop:'+i.id))
       .sort((a,b)=>distance(a.position)-distance(b.position)||a.id-b.id);
     const drop=drops.find(i=>candidates(s,{...plan,pickup:{entityId:i.id,expected:i.name}}).includes('pickup'));
     if(drop){action='pickup';plan.pickup={entityId:drop.id,expected:drop.name};this.attempted.add('drop:'+drop.id);}
     else{
      if(this.awaitingDrop)return this.block('Previously observed drop is no longer available; no confirmed pickup');
      const blocks=(s.vision?.blocks??[]).filter(b=>b.name===step.item&&within(b.position)&&!this.attempted.has('block:'+JSON.stringify(b.position)))
       .sort((a,b)=>distance(a.position)-distance(b.position)||a.position.x-b.position.x||a.position.y-b.position.y||a.position.z-b.position.z);
      const block=blocks.find(b=>candidates(s,{...plan,mine:{position:b.position,expected:b.name}}).includes('mine'));
      if(!block)return this.block('No fresh matching target inside the delegated area; no automatic exploration or target substitution');
      plan.mine={position:block.position,expected:block.name,keepTool:true};this.attempted.add('block:'+JSON.stringify(block.position));
     }
     binding='delegated acquisition: visible matching drops before blocks; nearest within model area, coordinate/id tie-break; current held tool';
    }
    plan.preferred=action;
    if(!candidates(s,plan).includes(action))return this.block('Current physical validation rejected delegated action');
    const command={action,plan,binding,stepId:step.id};
    this.pending={command,held:carried(s,step.item)};this.state.actions++;
    return command;
   }
   this.state.status='completed';return;
  }catch(e){return this.block(e instanceof Error?e.message:'Material calculation failed');}
 }
 finish(outcome:Outcome,s:Snapshot){
  const pending=this.pending;this.pending=undefined;if(!pending)return;
  // An interrupted attempt is not an exhausted target. Fresh next() validation
  // still checks observation, inventory, scope and remaining total budget.
  if(outcome==='cancelled'){
   const p=pending.command.plan;
   if(p.mine)this.attempted.delete('block:'+JSON.stringify(p.mine.position));
   if(p.pickup)this.attempted.delete('drop:'+p.pickup.entityId);
  }
  const step=this.definition.steps[this.state.stepIndex],gain=carried(s,step.item)-pending.held;
  if(gain>0)this.awaitingDrop=false;
  if(this.state.status!=='running')return;
  if(outcome==='cancelled'){this.suspend('Execution cancelled; observed inventory changes are retained');return;}
  if(outcome==='failed'||outcome==='skipped'){this.block('Primitive failed; observed changes retained, model review required');return;}
  if(gain<=0){
   // A broken block can still have a visible uncollected drop. Try that pickup once,
   // but never repeatedly mine other blocks to mask a missing-drop/tool problem.
   if(step.action==='mine'&&pending.command.action==='mine'&&pickupTargets(s).some(i=>i.name===step.item&&Math.hypot(i.position.x-step.area.center.x,i.position.y-step.area.center.y,i.position.z-step.area.center.z)<=step.area.radius)){this.awaitingDrop=true;return;}
   this.block('No confirmed inventory gain; broken block/disappearance is not collection');
  }
 }
}

// Identity excludes model-generated step labels; relabelling cannot reset a failed job.
export function procedureIdentity(p:Procedure){return JSON.stringify({...p,steps:p.steps.map(s=>({...s,id:undefined,...(s.action==='mine'&&s.materialsFor?{materialsFor:p.steps.findIndex(t=>t.id===s.materialsFor)}:{})}))});}
export function procedureBasis(p:Procedure,s:Snapshot){
 const names=new Set(p.steps.flatMap(t=>[t.item,...(t.action==='craft'?t.recipeInputs:[])]));
 return JSON.stringify({life:s.lifecycle?.generation,position:[s.position.x,s.position.y,s.position.z].map(Math.floor),inventory:[...names].sort().map(n=>[n,carried(s,n)]),recipes:[...s.recipeBook.unlocked].sort(),blocks:(s.vision?.blocks??[]).filter(b=>names.has(b.name)).map(b=>[b.name,b.position]).sort(),drops:pickupTargets(s).filter(i=>names.has(i.name)).map(i=>[i.id,i.name,i.position]).sort()});
}
export type ProcedureOfferStatus={available:boolean;reason?:string;materials?:MaterialReport;blockedStep?:{id:string;action:'mine';item:string;area:{center:Position;radius:number};visibleMatchingBlocks:number;observedMatchingDrops:number;targetType:string}};
export function inspectProcedureOffer(plan:Plan,s:Snapshot,lookup:RecipeLookup):ProcedureOfferStatus{
 if(!plan.procedure)return {available:false};
 const preview=new ProcedureRunner(plan,plan.procedure);const command=preview.next(s,lookup),view=preview.view();
 const step=view.definition.steps[view.stepIndex];
 const blockedStep=!command&&step?.action==='mine'?{id:step.id,action:step.action,item:step.item,area:step.area,
  visibleMatchingBlocks:(s.vision?.blocks??[]).filter(b=>b.name===step.item&&Math.hypot(b.position.x-step.area.center.x,b.position.y-step.area.center.y,b.position.z-step.area.center.z)<=step.area.radius).length,
  observedMatchingDrops:pickupTargets(s).filter(i=>i.name===step.item&&Math.hypot(i.position.x-step.area.center.x,i.position.y-step.area.center.y,i.position.z-step.area.center.z)<=step.area.radius).length,
  targetType:'A matching block or already observed drop; entities are not mine targets. This operation never creates an entity-derived drop.'}:undefined;
 return {available:!!command,reason:command?undefined:view.reason??'All procedure output targets already satisfied',materials:view.materials,...(blockedStep?{blockedStep}:{})};
}
