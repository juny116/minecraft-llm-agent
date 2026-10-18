import {partitionMoveDestinations,moveArgumentSemantics,MOVE_DESCRIPTION} from '../src/action-contracts.js';
/** Saved-input factorial diagnosis only: no Minecraft connection or runtime policy change. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {config} from '../src/config.js';
import {ApiBrain} from '../src/providers.js';
import {selectValue,type Ask} from '../src/parameter-supervisor.js';
import {proposalWithdrawal} from '../src/proposal-withdrawal.js';
import {decodeJevQuestions,decodeJevState,jevLosslessRequest} from '../src/jev-state.js';
import {reachedCell} from '../src/reach.js';
import {FunctionalLedger} from './functional-ledger.js';
const arg=(k:string)=>process.argv.find(x=>x.startsWith(k+'='))?.slice(k.length+1);
if(!arg('--input'))throw Error('Supply --input');
const clean=(x:any)=>JSON.parse(JSON.stringify(x));
const es=readFileSync(arg('--input')!,'utf8').trim().split('\n').map(x=>JSON.parse(x));
const requests=new Map<string,any>(),chains=new Map<string,any[]>(),frames:any[]=[];
for(let i=0;i<es.length;i++){
 const e=es[i],d=e.data;
 if(e.event==='model_input'){
  assert.equal(es[i-1].event,'api_request');const bot=d.context?.dialogue?.self;
  if(d.questions?.action)chains.set(bot,[]);
  if(d.context?.argumentName==='destination'){
   const r={line:i+1,bot,context:d.context,questions:decodeJevQuestions(d.questions),wireState:d.wireState,wireQuestions:d.questions};
   const chain=chains.get(bot)??[];chain.push(r);chains.set(bot,chain);requests.set(es[i-1].data.id,r);
  }
 }
 if(e.event==='api_request'&&d.phase==='complete'&&requests.has(d.id)){
  const r=requests.get(d.id);assert.equal(es[i-1].event,'model_output');r.answers=es[i-1].data.content;
  if(r.answers.bindingDecision){const chain=chains.get(r.bot)!;if(!chain[0].questions.destination)throw Error('Missing root');frames.push({bot:r.bot,chain:[...chain],gate:r,root:chain[0],original:r.answers.bindingDecision.choice});}
 }
}
const selected:any[]=[];
for(const bot of [...new Set(frames.map(f=>f.bot))].sort()){
 const failures=frames.filter(f=>f.bot===bot&&f.original==='withdraw');
 for(const i of [0,Math.floor(failures.length/2),failures.length-1])if(failures[i]&&!selected.includes(failures[i]))selected.push(failures[i]);
 const control=frames.find(f=>f.bot===bot&&f.original==='bind');if(control)selected.push(control);
}
const priorLines=new Set(selected.map(f=>f.root.line));
if(process.argv.includes('--meaning-ablation')||process.argv.includes('--execution-contract'))for(const bot of [...new Set(frames.map(f=>f.bot))].sort()){
 const failures=frames.filter(f=>f.bot===bot&&f.original==='withdraw');
 for(const i of [Math.floor(failures.length/4),Math.floor(3*failures.length/4)])if(failures[i]&&!selected.includes(failures[i]))selected.push(failures[i]);
 const control=frames.filter(f=>f.bot===bot&&f.original==='bind').at(-1);if(control&&!selected.includes(control))selected.push(control);
}
const valuesOf=(q:any)=>Object.values(q.criteria).flatMap((v:any)=>v.values??[v.value]);
const inside=(f:any,p:any)=>reachedCell(f.root.context.argumentSemantics.currentPosition,p,2);
const audit=frames.map(f=>{const root=f.root.questions.destination,leaf=f.chain.find((r:any)=>r.questions.destination&&!Object.keys(r.questions.destination.criteria).some(k=>k.startsWith('group_')));const selectedGroup=root.criteria[f.root.answers.destination.choice];return {bot:f.bot,line:f.root.line,original:f.original,rootChoice:f.root.answers.destination.choice,rootOptions:Object.keys(root.criteria).length,total:valuesOf(root).length,totalInside:valuesOf(root).filter(p=>inside(f,p)).length,groupSize:selectedGroup.values?.length,groupInside:selectedGroup.values?.filter((p:any)=>inside(f,p)).length,leafChoice:leaf?.answers.destination.choice,leafIndex:leaf?Object.keys(leaf.questions.destination.criteria).indexOf(leaf.answers.destination.choice):null,proposedInside:inside(f,f.gate.context.proposedArgument.value.value)};});
// A fixed permutation changes composition/order only; never ranks by distance or usefulness.
function shuffle<T>(xs:T[]){const a=[...xs];let seed=41721;for(let i=a.length-1;i>0;i--){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const j=seed%(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
const modes=process.argv.includes('--execution-contract')?['original','eligible','contract']:process.argv.includes('--meaning-ablation')?['original','shape','effect','not_recommended','arrival_label']:process.argv.includes('--arrival-label')?['original','arrival_label']:['original','absolute','shuffle','shuffle_absolute'];
async function replay(f:any,mode:string,transport:Ask){
 const base={...f.root.context};delete base.proposalStatus;
 const domain=partitionMoveDestinations(base.observation.position,valuesOf(f.root.questions.destination));
 if(mode==='contract'){base.argumentSemantics=moveArgumentSemantics(base.observation.position,domain);base.moveSemantics=MOVE_DESCRIPTION;}
 const adapted=proposalWithdrawal(async(q,c)=>{const data={...base,...c};delete data.lookFeedback;delete data.moveSemantics;return transport(q,{...data,lookFeedback:base.lookFeedback,moveSemantics:base.moveSemantics});});
 const ask:Ask=async(q,c)=>{
  const changed=structuredClone(q);
  for(const v of Object.values(changed)){delete v.criteria.none;v.criteria.revise='Withdraw the selected action and return to action selection; no replacement is forced';v.instructions=v.instructions.replace(/none[^.]*\./gi,'').trim()+' You selected move. Bind this argument consistently with boundArguments. These are values to use, not truth claims. Select revise only to withdraw this action. No value is preferred.';}
  const out=structuredClone(await adapted(changed,c));for(const n of Object.keys(q))if(out[n]?.choice==='revise')out[n].choice='none';return out;
 };
 const original=valuesOf(f.root.questions.destination),values=['eligible','contract'].includes(mode)?domain.eligible:mode.startsWith('shuffle')?shuffle(original):original;
 assert.deepEqual(values.map(p=>JSON.stringify(p)).sort(),(['eligible','contract'].includes(mode)?original.filter(p=>!inside(f,p)):original).map(p=>JSON.stringify(p)).sort());
 try{return {kind:'selected',value:await selectValue('destination',values,ask,{selectedAction:'move',boundArguments:f.root.context.boundArguments,argumentSemantics:base.argumentSemantics,argumentContract:'coordinated'})};}catch(e){if(e instanceof Error&&e.message==='No suitable destination')return {kind:'withdrawn'};throw e;}
}
// Replay original recorded answers locally: reconstructed baseline must exactly match every question/context and wire payload.
for(const f of selected){let index=0;await replay(f,'original',async(q,c)=>{const expected=f.chain[index++];assert.deepEqual(clean(q),expected.questions);assert.deepEqual(clean(c),expected.context);const packed=jevLosslessRequest(c,q);assert.deepEqual(packed.questions,expected.wireQuestions);assert.deepEqual(packed.state,expected.wireState);return structuredClone(expected.answers);});assert.equal(index,f.chain.length);}
const dir=`runs/destination-factor-${Date.now()}`;mkdirSync(dir,{recursive:true,mode:0o700});writeFileSync(dir+'/audit.json',JSON.stringify({audit,samples:selected.map(f=>({bot:f.bot,line:f.root.line,original:f.original,cohort:priorLines.has(f.root.line)?'prior':'additional'}))}),{mode:0o600});
console.log(JSON.stringify({dir,frames:frames.length,samples:selected.length,baselineExact:true}));
if(!process.argv.includes('--with-api'))process.exit(0);
const c=config(),ledger=new FunctionalLedger('runs/functional-cost-ledger.json',process.argv.includes('--meaning-ablation')?500:300,.5,Number(arg('--authorized-total-usd')??5));const brain:any=new ApiBrain(c,ledger.budget),rows:any[]=[];
try{for(let repeat=0;repeat<2;repeat++)for(let fi=0;fi<selected.length;fi++){
 const f=selected[fi],ordered=modes.map((_,i)=>modes[(i+fi+repeat)%modes.length]);
 for(const mode of ordered){const calls:any[]=[],start=Date.now();const result=await replay(f,mode,async(q,context)=>{
  let wireContext=context;
  if(['shape','effect','not_recommended','arrival_label'].includes(mode)){
   wireContext=structuredClone(context);const points=(wireContext.argumentSemantics as any).alreadyWithinArrivalRadius;
   const meaning=mode==='effect'?'These are already reached coordinates: move execution does not start for them.':mode==='not_recommended'?'This is a fact list, not a recommended destination list.':mode==='arrival_label'?'These are already reached coordinates: move execution does not start for them. This is a no-movement fact list, not a recommended destination list.':undefined;
   (wireContext.argumentSemantics as any).alreadyWithinArrivalRadius={...(meaning?{meaning}:{}),coordinates:points};
   const restored=structuredClone(wireContext);(restored.argumentSemantics as any).alreadyWithinArrivalRadius=(restored.argumentSemantics as any).alreadyWithinArrivalRadius.coordinates;assert.deepEqual(restored,context);
  }
  const packed=jevLosslessRequest(wireContext,q);
  // Only criterion coordinate-array representation changes. Context and instructions stay byte-identical.
  if(mode.includes('absolute'))packed.questions=Object.fromEntries(Object.entries(q).map(([n,v])=>[n,{...v,criteria:Object.fromEntries(Object.entries(v.criteria).map(([id,x])=>[id,typeof x==='object'?'JEV_JSON:'+JSON.stringify(x):x]))}]));
  assert.deepEqual(decodeJevQuestions(packed.questions),clean(q));assert.deepEqual(decodeJevState(packed.state),clean(wireContext));
  const out=await brain.post(`${c.jevUrl.replace(/\/$/,'')}/systemone`,c.jevKey,{model:c.jevModel,...packed},new AbortController().signal,[c.jevRate,0],c.selectorApiMs);
  const answers=structuredClone(out.answers),name=Object.keys(q)[0],choice=answers[name]?.choice,value:any=q[name].criteria[choice];
  calls.push({name,choice,questions:q,answers,usage:out.usage,wireBytes:Buffer.byteLength(JSON.stringify(packed)),selectedGroupInside:value?.values?.filter((p:any)=>inside(f,p)).length,selectedGroupSize:value?.values?.length,proposedInside:context.proposedArgument?inside(f,(context.proposedArgument as any).value.value):undefined});return answers;
 });rows.push({cohort:priorLines.has(f.root.line)?'prior':'additional',sample:fi,bot:f.bot,line:f.root.line,original:f.original,repeat,mode,result,calls,elapsedMs:Date.now()-start});writeFileSync(dir+'/rows.json',JSON.stringify(rows),{mode:0o600});
 }
}}finally{const costs=ledger.finish();const summary=Object.fromEntries(modes.map(mode=>{const xs=rows.filter(r=>r.mode===mode);return [mode,{n:xs.length,selected:xs.filter(r=>r.result.kind==='selected').length,outside:xs.filter(r=>r.result.value&&!inside(selected[r.sample],r.result.value)).length,withdrawn:xs.filter(r=>r.result.kind==='withdrawn').length,groupHasOutside:xs.filter(r=>r.calls[0].selectedGroupSize>r.calls[0].selectedGroupInside).length,proposedInside:xs.filter(r=>r.calls.at(-1).proposedInside).length,calls:xs.reduce((n,r)=>n+r.calls.length,0)}]}));writeFileSync(dir+'/summary.json',JSON.stringify({summary,costs}),{mode:0o600});console.log(JSON.stringify({dir,summary,costs}));}
