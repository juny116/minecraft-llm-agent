/** Offline-world paid API comparison. No Minecraft connection or execution. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {createHash} from 'node:crypto';
import {config} from '../src/config.js';import {ApiBrain} from '../src/providers.js';
import {decodeReferenceRequest,referenceRequest} from '../src/jev-references.js';
import {directSelection} from '../src/direct-selection.js';import {selectLookArguments,type LookBinding} from '../src/look-arguments.js';
import type {Ask} from '../src/parameter-supervisor.js';import {FunctionalLedger} from './functional-ledger.js';
const arg=(k:string)=>process.argv.find(x=>x.startsWith(k+'='))?.slice(k.length+1);
if(!process.argv.includes('--with-api')||!arg('--input'))throw Error('Require --with-api and --input');
const es=readFileSync(arg('--input')!,'utf8').trim().split('\n').map(l=>JSON.parse(l));
const frames:any[]=[];
for(let i=0;i<es.length;i++){
 const e=es[i];if(e.event!=='model_input'||!e.data?.questions?.action||!e.data.context?.dialogue?.self)continue;
 const bot=e.data.context.dialogue.self;
 const response=es.slice(i+1).find(x=>x.bot===bot&&x.event==='supervisor_response');
 if(response?.data?.selectionControl?.action!=='look')continue;
 const decoded=decodeReferenceRequest(e.data.context,e.data.questions);
 const questions=structuredClone(decoded.questions);delete questions.action.criteria.wait;
 questions.action.instructions=questions.action.instructions.replace('Waiting is intentional.','Intentional idle/wait is not offered.').replace('Choose wait when you intend to wait; no game action is required.','Intentional idle/wait is not offered.').replace('Use wait, continue or stop at this action decision when appropriate.','Continue maintains running work; stop cancels it without timed waiting.');
 if(questions.action.criteria.stop)questions.action.criteria.stop='Cancel the running execution and reassess; no timed waiting';
 frames.push({line:i+1,bot,context:decoded.context,questions});
}
const samples:any[]=[];
for(const bot of [...new Set(frames.map(f=>f.bot))].sort()){
 const fs=frames.filter(f=>f.bot===bot);for(const index of [0,Math.floor(fs.length/2),fs.length-1])if(fs[index]&&!samples.includes(fs[index]))samples.push(fs[index]);
}
if(samples.length!==6)throw Error('Expected six observed historical look frames');
if(process.argv.includes('--angle-probes')){
 const source=structuredClone(samples[0]);samples.length=0;
 for(const [yaw,pitch] of [[359,-37],[46,23],[179,89]]){
  const f=structuredClone(source);f.expected={yawDegrees:yaw,pitchDegrees:pitch};
  const task='Controlled camera diagnostic: set absolute yaw '+yaw+' degrees and absolute pitch '+pitch+' degrees. This is a requested motor orientation, not a claim about unseen terrain.';
  f.context.goal=task;f.context.plan={goal:task,intent:{description:task,desiredInventory:[],constraints:['Complete when the requested camera orientation has been applied.']}};
  samples.push(f);
 }
}

const c=config(),dir=`runs/look-binding-${Date.now()}`;mkdirSync(dir,{recursive:true,mode:0o700});
const ledger=new FunctionalLedger('runs/look-binding-cost-ledger.json',140,.5,5),brain:any=new ApiBrain(c,ledger.budget),rows:any[]=[],diagnostics:any[]=[];ledger.budget.onDiagnostic=x=>diagnostics.push(x);
const save=()=>writeFileSync(dir+'/rows.json',JSON.stringify(rows),{mode:0o600});
writeFileSync(dir+'/samples.json',JSON.stringify(samples),{mode:0o600});
try{
 const comparison:LookBinding=process.argv.includes('--relative-branches')?'relative-branches':process.argv.includes('--parallel-branches')?'parallel-branches':'batched';
 for(let repeat=0;repeat<2;repeat++)for(let sample=0;sample<samples.length;sample++)for(const mode of ((sample+repeat)%2?[comparison,'sequential']:['sequential',comparison]) as LookBinding[]){
  const f=samples[sample],context=structuredClone(f.context),calls:any[]=[],start=Date.now(),cost=ledger.budget.usd;
  const transport:Ask=async(questions,selection)=>{
   const payload={model:c.jevModel,...referenceRequest({...context,...selection},questions)},at=Date.now();
   const out=await brain.post(`${c.jevUrl.replace(/\/$/,'')}/systemone`,c.jevKey,payload,new AbortController().signal,[c.jevRate,0],c.selectorApiMs);
   calls.push({keys:Object.keys(questions),elapsedMs:Date.now()-at,usage:out.usage,answers:out.answers,requestBytes:Buffer.byteLength(JSON.stringify(payload))});return out.answers;
  };
  let result:any;
  try{
   const a=await transport(f.questions,{}),action=a?.action;
   if(action?.type!=='choice'||!Object.hasOwn(f.questions.action.criteria,action.choice))throw Error('Invalid action response');
   result={action:action.choice};
   if(action.choice==='look')result.angles=await selectLookArguments(context.observation,directSelection(transport),mode);
   const old=context.observation.vision;
   if(result.angles&&old)result.change={yaw:((result.angles.yawDegrees-old.yaw*180/Math.PI+540)%360)-180,pitch:result.angles.pitchDegrees-old.pitch*180/Math.PI};
  }catch(e){result={error:e instanceof Error?e.message:'error'};}
  rows.push({sample,expected:f.expected,line:f.line,bot:f.bot,repeat,mode,inputHash:createHash('sha256').update(JSON.stringify([context,f.questions])).digest('hex'),result,calls,elapsedMs:Date.now()-start,usd:ledger.budget.usd-cost});save();
  console.log(JSON.stringify({sample,repeat,mode,result,ms:rows.at(-1).elapsedMs,usd:rows.at(-1).usd}));
  if(ledger.budget.unsettledUsage||ledger.budget.exhausted)throw Error('Budget/usage stop');
 }
}finally{
 const costs=ledger.finish();writeFileSync(dir+'/summary.json',JSON.stringify({costs,diagnostics,rows:rows.length,model:c.jevModel,rate:c.jevRate}),{mode:0o600});console.log(JSON.stringify({dir,costs,rows:rows.length}));
}
