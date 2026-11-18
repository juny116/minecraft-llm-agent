/** Bounded saved-input probe; never connects to Minecraft or alters runtime policy. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {config} from '../src/config.js';
import {ApiBrain} from '../src/providers.js';
import {selectValue,type Ask} from '../src/parameter-supervisor.js';
import {decodeJevQuestions,jevLosslessRequest} from '../src/jev-state.js';
import {reachedCell} from '../src/reach.js';
import {separateWithdrawal} from './withdrawal-contract.js';
import {FunctionalLedger} from './functional-ledger.js';

const arg=(key:string)=>process.argv.find(x=>x.startsWith(key+'='))?.slice(key.length+1);
if(!process.argv.includes('--with-api')||!arg('--input'))throw Error('Explicit --with-api and --input required');
const es=readFileSync(arg('--input')!,'utf8').trim().split('\n').map(l=>JSON.parse(l));
const inputs=new Map<string,any>(),frames:any[]=[];
for(let i=0;i<es.length;i++){
 const e=es[i];
 if(e.event==='model_input'&&es[i-1]?.event==='api_request')inputs.set(es[i-1].data.id,{...e.data,line:i+1});
 if(e.event==='api_request'&&e.data.phase==='complete'){
  const d=inputs.get(e.data.id),out=es[i-1]?.data?.content;
  if(!d||!d.questions?.destination||!out?.destination)continue;
  const questions=decodeJevQuestions(d.questions),q=questions.destination;
  const groups=Object.values(q.criteria).filter((v:any)=>v&&typeof v==='object'&&Array.isArray(v.values)) as any[];
  if(!groups.length)continue;
  // Only the first/root partition: subsequent group questions have fewer values.
  const values=groups.flatMap(v=>v.values);
  if(values.length>1024)throw Error('This probe expects a single root partition before leaf selection');
  frames.push({bot:d.context.dialogue?.self,line:d.line,context:d.context,values,originalChoice:out.destination.choice});
 }
}
const samples:any[]=[];
for(const bot of [...new Set(frames.map(x=>x.bot))].sort()){
 const declined=frames.filter(x=>x.bot===bot&&x.originalChoice==='revise');
 for(const i of [0,Math.floor(declined.length/2),declined.length-1])if(declined[i]&&!samples.includes(declined[i]))samples.push(declined[i]);
 const control=frames.find(x=>x.bot===bot&&x.originalChoice!=='revise');if(control)samples.push(control);
}
if(samples.length!==8)throw Error('Expected six declined and two control snapshots');
const c=config(),ledger=new FunctionalLedger('runs/functional-cost-ledger.json',180,.35,Number(arg('--authorized-total-usd')??5));
const brain:any=new ApiBrain(c,ledger.budget),diagnostics:any[]=[],rows:any[]=[];ledger.budget.onDiagnostic=x=>diagnostics.push(x);
const dir=`runs/withdrawal-replay-${Date.now()}`;mkdirSync(dir,{recursive:true,mode:0o700});
try{
 for(let repeat=0;repeat<2;repeat++)for(let index=0;index<samples.length;index++){
  const sample=samples[index];
  for(const mode of (index+repeat)%2?['separate','joint']:['joint','separate']){
   const calls:any[]=[],start=Date.now(),usd=ledger.budget.usd;
   const transport:Ask=async(q,context)=>{
    const payload={model:c.jevModel,...jevLosslessRequest({...sample.context,...context},q)},at=Date.now();
    const out=await brain.post(`${c.jevUrl.replace(/\/$/,'')}/systemone`,c.jevKey,payload,new AbortController().signal,[c.jevRate,0],c.selectorApiMs);
    calls.push({questions:q,context,answers:out.answers,usage:out.usage,elapsedMs:Date.now()-at});return out.answers;
   };
   const adapted=mode==='separate'?separateWithdrawal(transport):transport;
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
 const costs=ledger.finish();const summary=Object.fromEntries(['joint','separate'].map(mode=>{const xs=rows.filter(x=>x.mode===mode);return [mode,{attempts:xs.length,selected:xs.filter(x=>x.result.kind==='selected').length,outsideArrivalRadius:xs.filter(x=>x.result.outsideArrivalRadius).length,withdrawn:xs.filter(x=>x.result.kind==='withdrawn').length,calls:xs.reduce((n,x)=>n+x.calls.length,0),meanMs:xs.reduce((n,x)=>n+x.elapsedMs,0)/xs.length,usd:xs.reduce((n,x)=>n+x.usd,0)}]}));
 writeFileSync(dir+'/summary.json',JSON.stringify({summary,costs,diagnostics}),{mode:0o600});console.log(JSON.stringify({dir,summary,costs}));
}
