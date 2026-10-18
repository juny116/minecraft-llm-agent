/** Saved failure inputs through the current API adapter. Never connects to Minecraft. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import assert from 'node:assert/strict';
import {ApiBrain,Budget} from '../src/providers.js';import {config} from '../src/config.js';
import {decodeReferenceRequest} from '../src/jev-references.js';import {moveDomain} from '../src/action-contracts.js';
import {decodeMovementBlocks} from '../src/move-context.js';import {FunctionalLedger} from './functional-ledger.js';
const arg=(k:string)=>process.argv.find(x=>x.startsWith(k+'='))?.slice(k.length+1);
if(!arg('--input'))throw Error('Supply --input');
const es=readFileSync(arg('--input')!,'utf8').trim().split('\n').map(l=>JSON.parse(l)),requests=new Map<string,any>(),frames:any[]=[];
for(let i=0;i<es.length;i++){
 const e=es[i];if(e.event==='model_input')requests.set(es[i-1].data.id,e);
 if(e.event==='api_request'&&e.data.phase==='context_limit')frames.push(requests.get(e.data.id));
}
assert.ok(frames.length,'No context-limit inputs');const rows:any[]=[],c=config();
for(const frame of frames){
 const old=frame.data.context,s={...old.observation,social:old.dialogue,importantPlaces:old.rememberedPlaces,places:decodeMovementBlocks(old.movementEvidence)},payloads:any[]=[];
 const input={...old,options:[],parameterSelection:true};
 const brain=new ApiBrain({...c,mode:'jev',targetPolicy:'observed',argumentContract:'coordinated',withdrawalMode:'proposal',jevKey:'offline-placeholder'},new Budget(20,1),async(_url,init)=>{
  const wire=JSON.parse(String(init?.body));payloads.push(wire);const decoded=decodeReferenceRequest(wire.state,wire.questions);
  assert.equal(decoded.context.movementEvidence,undefined);assert.equal(decoded.context.observation.places,undefined);
  assert.deepEqual(decoded.context.rememberedPlaces,s.importantPlaces);
  assert.deepEqual(decoded.context.observation.vision,s.vision);
  const answers=Object.fromEntries(Object.entries(wire.questions).map(([key,q]:any)=>[key,{type:'choice',confidence:1,choice:key==='action'?'move':key==='review'?'none':key==='bindingDecision'?'bind':Object.keys(q.criteria).find(k=>k.startsWith('group_')||k.startsWith('value_'))}]));
  return Response.json({answers,usage:{input_tokens:0,output_tokens:0}});
 });
 const result=await brain.supervise(s,input,new AbortController().signal);assert.ok(result.selected?.plan.destination);
 const root=payloads.find(p=>p.questions.destination);assert.ok(root);const decoded=decodeReferenceRequest(root.state,root.questions);
 const values=Object.values(decoded.questions.destination.criteria).flatMap((v:any)=>typeof v==='object'?v.values??[v.value]:[]);
 assert.deepEqual(values,moveDomain(s).eligible);
 rows.push({oldBytes:Buffer.byteLength(JSON.stringify({model:frame.data.model,state:frame.data.wireState,questions:frame.data.questions})),newBytes:Buffer.byteLength(JSON.stringify(root)),visible:s.vision.blocks.length,landmarks:s.importantPlaces.length,destinations:values.length,wire:root});
}
const dir=`runs/context-efficiency-${Date.now()}`;mkdirSync(dir,{recursive:true,mode:0o700});
const report={frames:rows.length,oldMeanBytes:rows.reduce((n,r)=>n+r.oldBytes,0)/rows.length,newMeanBytes:rows.reduce((n,r)=>n+r.newBytes,0)/rows.length,maxNewBytes:Math.max(...rows.map(r=>r.newBytes)),invariants:'Every current visible block and curated place retained; root values equal the complete new current/landmark destination domain; no strategic ranking or forced action.'};
writeFileSync(dir+'/offline.json',JSON.stringify({report,rows}),{mode:0o600});console.log(JSON.stringify({dir,...report}));
if(process.argv.includes('--with-api')){
 const ledger=new FunctionalLedger('runs/functional-cost-ledger.json',12,.08,Number(arg('--authorized-total-usd')??5)),brain:any=new ApiBrain(c,ledger.budget),results:any[]=[];
 try{for(const i of [...new Set([0,Math.floor(rows.length/2),rows.length-1])]){
  const out=await brain.post(`${c.jevUrl.replace(/\/$/,'')}/systemone`,c.jevKey,rows[i].wire,new AbortController().signal,[c.jevRate,0],c.selectorApiMs);
  const answer=out.answers?.destination;assert.ok(answer&&Object.hasOwn(rows[i].wire.questions.destination.criteria,answer.choice));
  results.push({index:i,usage:out.usage,choice:answer.choice});
 }}finally{const costs=ledger.finish();writeFileSync(dir+'/api.json',JSON.stringify({results,costs}),{mode:0o600});console.log(JSON.stringify({results,costs}));}
}
