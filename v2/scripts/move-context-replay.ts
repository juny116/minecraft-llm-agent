/** Bounded saved-input probe; never connects to Minecraft or alters runtime policy. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {config} from '../src/config.js';
import {ApiBrain} from '../src/providers.js';
import {selectValue,type Ask} from '../src/parameter-supervisor.js';
import {decodeJevQuestions,jevLosslessRequest} from '../src/jev-state.js';
import {moveContextRequest,movementEvidence} from '../src/move-context.js';
import {reachedCell} from '../src/reach.js';
import {proposalWithdrawal} from '../src/proposal-withdrawal.js';
import {separateWithdrawal} from './withdrawal-contract.js';
import {FunctionalLedger} from './functional-ledger.js';

const arg=(key:string)=>process.argv.find(x=>x.startsWith(key+'='))?.slice(key.length+1);
if(!process.argv.includes('--with-api')||!arg('--input'))throw Error('Explicit --with-api and --input required');
const es=readFileSync(arg('--input')!,'utf8').trim().split('\n').map(l=>JSON.parse(l));
const inputs=new Map<string,any>(),frames:any[]=[],rootPending=new Map<string,boolean>(),observed=new Map<string,Map<string,any>>();
for(let i=0;i<es.length;i++){
 const e=es[i];
 if(e.event==='model_input'&&es[i-1]?.event==='api_request'){
  const d=e.data,bot=d.context?.dialogue?.self;
  if(bot&&d.context?.observation?.vision){const seen=observed.get(bot)??new Map();for(const b of d.context.observation.vision.blocks)seen.set(JSON.stringify(b.position),b);observed.set(bot,seen);}
  if(d.questions?.action)rootPending.set(bot,true);
  const domain=d.context?.bindingDomain;
  if(domain?.name==='destination'&&rootPending.get(bot)){
   rootPending.set(bot,false);inputs.set(es[i-1].data.id,{...d,line:i+1,observed:[...(observed.get(bot)?.values()??[])]});
  }
 }
 if(e.event==='api_request'&&e.data.phase==='complete'){
  const d=inputs.get(e.data.id),out=es[i-1]?.data?.content;if(!d||!out?.bindingDecision)continue;
  const domain=d.context.bindingDomain;
  const values=Object.values(domain.criteria).flatMap((v:any)=>v.values??[v.value]);
  if(values.some(v=>!v||!Number.isFinite(v.x)))throw Error('Captured domain cannot be restored exactly');
  frames.push({observed:d.observed,bot:d.context.dialogue.self,line:d.line,context:Object.fromEntries(Object.entries(d.context).filter(([k])=>k!=='bindingDomain')),values,originalChoice:out.bindingDecision.choice});
 }
}
const samples:any[]=[];
for(const bot of [...new Set(frames.map(x=>x.bot))].sort()){
 const declined=frames.filter(x=>x.bot===bot&&x.originalChoice==='withdraw');
 for(const i of [Math.floor(declined.length/2),declined.length-1])if(declined[i]&&!samples.includes(declined[i]))samples.push(declined[i]);
 const control=frames.find(x=>x.bot===bot&&x.originalChoice==='bind');if(control)samples.push(control);
}
if(samples.length!==6)throw Error('Expected four declined and two binding control inputs');
const modes=process.argv.includes('--proposal')?['grounded','proposal']:process.argv.includes('--grounding')?['approach','grounded']:['original','approach'];
const c=config(),ledger=new FunctionalLedger('runs/functional-cost-ledger.json',180,.35,Number(arg('--authorized-total-usd')??5));
const brain:any=new ApiBrain(c,ledger.budget),diagnostics:any[]=[],rows:any[]=[];ledger.budget.onDiagnostic=x=>diagnostics.push(x);
const dir=`runs/move-context-replay-${Date.now()}`;mkdirSync(dir,{recursive:true,mode:0o700});
try{
 for(let repeat=0;repeat<2;repeat++)for(let index=0;index<samples.length;index++){
  const sample=samples[index];
  for(const mode of (index+repeat)%2?[...modes].reverse():modes){
   const calls:any[]=[],start=Date.now(),usd=ledger.budget.usd;
   const transport:Ask=async(q,context)=>{
    const data={...sample.context,...context};if(!context.bindingDomain)delete data.bindingDomain;
    if(mode==='grounded'||mode==='proposal')data.movementEvidence=movementEvidence({...sample.context.observation,places:sample.observed});
    const prepared=mode!=='original'?moveContextRequest(q,data):{questions:q,context:data};
    const payload={model:c.jevModel,...jevLosslessRequest(prepared.context,prepared.questions)},at=Date.now();
    const out=await brain.post(`${c.jevUrl.replace(/\/$/,'')}/systemone`,c.jevKey,payload,new AbortController().signal,[c.jevRate,0],c.selectorApiMs);
    calls.push({questions:prepared.questions,context:prepared.context,answers:structuredClone(out.answers),usage:out.usage,elapsedMs:Date.now()-at});return out.answers;
   };
   const adapted=mode==='proposal'?proposalWithdrawal(transport):separateWithdrawal(transport);
   const ask:Ask=async(q,context)=>{
    const changed=structuredClone(q);
    for(const question of Object.values(changed)){
     delete question.criteria.none;question.criteria.revise='Withdraw the selected action and return to action selection; no replacement is forced';
     question.instructions=question.instructions.replace(/none[^.]*\./gi,'').trim()+' You selected move. Bind this argument consistently with boundArguments. These are values to use, not truth claims. Select revise only to withdraw this action. No value is preferred.';
    }
    const out=structuredClone(await adapted(changed,context));
    for(const name of Object.keys(q))if(out[name]?.choice==='revise')out[name]={...out[name],choice:'none'};
    return out;
   };
   let result:any;
   try{const destination=await selectValue('destination',sample.values,ask,sample.context);result={kind:'selected',destination,inDomain:sample.values.some((p:any)=>JSON.stringify(p)===JSON.stringify(destination)),outsideArrivalRadius:!reachedCell(sample.context.observation.position,destination as any,2)};}
   catch(e){if(e instanceof Error&&e.message==='No suitable destination')result={kind:'withdrawn'};else throw e;}
   rows.push({sample:index,bot:sample.bot,line:sample.line,originalChoice:sample.originalChoice,domainSize:sample.values.length,repeat,mode,result,calls,elapsedMs:Date.now()-start,usd:ledger.budget.usd-usd});
   writeFileSync(dir+'/rows.json',JSON.stringify(rows),{mode:0o600});
  }
 }
}finally{
 const costs=ledger.finish();const summary=Object.fromEntries(modes.map(mode=>{const xs=rows.filter(x=>x.mode===mode);return [mode,{attempts:xs.length,selected:xs.filter(x=>x.result.kind==='selected').length,outsideArrivalRadius:xs.filter(x=>x.result.outsideArrivalRadius).length,withdrawn:xs.filter(x=>x.result.kind==='withdrawn').length,calls:xs.reduce((n,x)=>n+x.calls.length,0),meanMs:xs.reduce((n,x)=>n+x.elapsedMs,0)/xs.length,usd:xs.reduce((n,x)=>n+x.usd,0)}]}));
 writeFileSync(dir+'/summary.json',JSON.stringify({summary,costs,diagnostics}),{mode:0o600});console.log(JSON.stringify({dir,summary,costs}));
}
