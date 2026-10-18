/** Saved-input diagnostic only. Never connects a Minecraft client. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {config} from '../src/config.js';import {ApiBrain} from '../src/providers.js';
import {parameterSupervise,type Ask} from '../src/parameter-supervisor.js';
import {separateWithdrawal} from '../src/withdrawal-contract.js';import {lookFeedbackRequest} from '../src/look-feedback.js';
import {jevLosslessRequest} from '../src/jev-state.js';import {FunctionalLedger} from './functional-ledger.js';
// A model observation omits historical places. This diagnostic cannot reconstruct
// complete alternative-action domains; require explicit acknowledgement of that limit.
if(!process.argv.includes('--partial-domains-diagnostic'))throw Error('Historical destination domain is unavailable: this replay is not a full execution comparison. Use captured destination questions for movement diagnosis; pass --partial-domains-diagnostic only to reproduce the limited look probe.');
const arg=(k:string)=>process.argv.find(x=>x.startsWith(k+'='))?.slice(k.length+1);
if(!process.argv.includes('--with-api')||!arg('--input'))throw Error('Explicit --with-api and --input required');
const es=readFileSync(arg('--input')!,'utf8').trim().split('\n').map(l=>JSON.parse(l));
const frames:any[]=[];
for(let i=0;i<es.length;i++){
 const e=es[i],c=e.data?.context;if(e.event!=='model_input'||!e.data.questions?.action||!c?.dialogue?.self)continue;
 const history=es.slice(0,i).filter(x=>x.bot===c.dialogue.self&&x.event==='action_record').map(x=>x.data.record).slice(-12);
 const last=history.at(-1),v=last?.changes?.view;
 if(last?.decision?.action!=='look'||!v||Math.max(Math.abs(v.camera.yawDeltaDegrees),Math.abs(v.camera.pitchDeltaDegrees))>1e-5||v.visibleBlocks.enteredCount||v.visibleBlocks.leftCount)continue;
 if(c.recentOutcome?.id!==last.id)throw Error('Unexpected stale original outcome');
 frames.push({line:i+1,context:c,history});
}
const samples:any[]=[];
for(const bot of [...new Set(frames.map(f=>f.context.dialogue.self))].sort()){
 const fs=frames.filter(f=>f.context.dialogue.self===bot);for(const i of [Math.floor(fs.length/2),fs.length-1])if(fs[i]&&!samples.includes(fs[i]))samples.push(fs[i]);
}
if(samples.length!==4)throw Error('Expected four late repeated-look inputs');
const modes=process.argv.includes('--ablation')?['semantics','history']:['original','feedback'];
const c=config(),ledger=new FunctionalLedger('runs/functional-cost-ledger.json',160,.45,Number(arg('--authorized-total-usd')??5));
const brain:any=new ApiBrain(c,ledger.budget),rows:any[]=[],diagnostics:any[]=[];ledger.budget.onDiagnostic=x=>diagnostics.push(x);
const dir=`runs/look-feedback-replay-${Date.now()}`;mkdirSync(dir,{recursive:true,mode:0o700});
try{
 for(let repeat=0;repeat<2;repeat++)for(let index=0;index<samples.length;index++)for(const mode of (index+repeat)%2?[...modes].reverse():modes){
  const s=samples[index],context=structuredClone(s.context),calls:any[]=[],start=Date.now(),usd=ledger.budget.usd;
  if(mode==='feedback'||mode==='history')context.recentLookResults=s.history.filter((r:any)=>r.decision.action==='look').slice(-6).map((r:any)=>({id:r.id,endedAt:r.endedAt,outcome:r.outcome,requested:r.executionPlan?.look,view:r.changes.view}));
  const transport:Ask=async(questions,selection)=>{
   const data={...context,...selection};let prepared:any=mode!=='original'?lookFeedbackRequest(questions,data):{questions,context:data};
   if(mode==='semantics')prepared.context.lookFeedback={semantics:prepared.context.lookFeedback.semantics};
   if(mode==='history'){prepared.questions=questions;delete prepared.context.lookFeedback.semantics;}
   const payload={model:c.jevModel,...jevLosslessRequest(prepared.context,prepared.questions)},at=Date.now();
   const out=await brain.post(`${c.jevUrl.replace(/\/$/,'')}/systemone`,c.jevKey,payload,new AbortController().signal,[c.jevRate,0],c.selectorApiMs);
   calls.push({questions:prepared.questions,context:prepared.context,answers:structuredClone(out.answers),elapsedMs:Date.now()-at});return out.answers;
  };
  const state={...context.observation,importantPlaces:context.rememberedPlaces};
  const result=await parameterSupervise(state,{...context,options:[],parameterSelection:true},separateWithdrawal(transport),'coordinated');
  const look=result.selected?.plan.look,old=state.vision;
  const rotation=look&&old?{yawDegrees:Math.abs(((look.yaw-old.yaw)*180/Math.PI+540)%360-180),pitchDegrees:Math.abs((look.pitch-old.pitch)*180/Math.PI)}:undefined;
  rows.push({sample:index,line:s.line,bot:context.dialogue.self,repeat,mode,result,rotation,calls,elapsedMs:Date.now()-start,usd:ledger.budget.usd-usd});
  writeFileSync(dir+'/rows.json',JSON.stringify(rows),{mode:0o600});
 }
}finally{
 const costs=ledger.finish();const summary=Object.fromEntries(modes.map(mode=>{
  const rs=rows.filter(r=>r.mode===mode);return [mode,{decisions:rs.length,selected:rs.filter(r=>r.result.selected).length,unresolved:rs.filter(r=>r.result.choice==='unresolved').length,actions:rs.map(r=>r.result.selected?.action??r.result.choice),lookBelow1Degree:rs.filter(r=>r.rotation&&Math.max(r.rotation.yawDegrees,r.rotation.pitchDegrees)<1).length,lookAtLeast1Degree:rs.filter(r=>r.rotation&&Math.max(r.rotation.yawDegrees,r.rotation.pitchDegrees)>=1).length,meanMs:rs.reduce((n,r)=>n+r.elapsedMs,0)/rs.length,calls:rs.reduce((n,r)=>n+r.calls.length,0),usd:rs.reduce((n,r)=>n+r.usd,0)}];
 }));writeFileSync(dir+'/summary.json',JSON.stringify({summary,costs,diagnostics}),{mode:0o600});console.log(JSON.stringify({dir,summary,costs}));
}
