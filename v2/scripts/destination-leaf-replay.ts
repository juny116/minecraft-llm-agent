/** Fixed-leaf geometry representation probe. Does not execute actions. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {config} from '../src/config.js';import {ApiBrain} from '../src/providers.js';import {FunctionalLedger} from './functional-ledger.js';
import {decodeJevQuestions,decodeJevState,jevLosslessRequest} from '../src/jev-state.js';import {reachedCell} from '../src/reach.js';
const arg=(k:string)=>process.argv.find(x=>x.startsWith(k+'='))?.slice(k.length+1);
if(!arg('--input')||!arg('--audit'))throw Error('Require --input and --audit');
const es=readFileSync(arg('--input')!,'utf8').trim().split('\n').map(x=>JSON.parse(x)),samples=JSON.parse(readFileSync(arg('--audit')!,'utf8')).samples;
const frames=samples.map((s:any)=>{const e=es.slice(s.line-1).find(e=>e.event==='model_input'&&e.data.context?.dialogue?.self===s.bot&&e.data.questions?.destination&&!Object.keys(e.data.questions.destination.criteria).some(k=>k.startsWith('group_')));assert(e);return {...s,data:e.data};});
const prepared=frames.map((f:any)=>{
 const q=decodeJevQuestions(f.data.questions),geometry=structuredClone(q),position=f.data.context.argumentSemantics.currentPosition;
 for(const value of Object.values(geometry.destination.criteria) as any[]){const p=value.value;const d=Math.hypot(...(['x','y','z'].map(k=>Math.floor(position[k])-Math.floor(p[k]))));value.distanceBetweenFlooredCells=d;value.arrivalRadiusBlocks=2;value.resultOfAttempt=reachedCell(position,p,2)?'No move execution starts: destination is already reached.':'Requests a movement attempt; path availability is unverified.';}
 for(const variant of [q,geometry]){const packed=jevLosslessRequest(f.data.context,variant);assert.deepEqual(decodeJevQuestions(packed.questions),variant);assert.deepEqual(decodeJevState(packed.state),f.data.context);}
 assert.deepEqual(jevLosslessRequest(f.data.context,q),{state:f.data.wireState,questions:f.data.questions});
 return {...f,q,geometry};
});
console.log(JSON.stringify({samples:frames.length,baselineExact:true}));if(!process.argv.includes('--with-api'))process.exit(0);
const arrivalLabel=process.argv.includes('--arrival-label'),variantName=arrivalLabel?'arrival_label':'geometry';
const c=config(),ledger=new FunctionalLedger('runs/functional-cost-ledger.json',40,.12,Number(arg('--authorized-total-usd')??5)),brain:any=new ApiBrain(c,ledger.budget),rows:any[]=[];
const dir=`runs/destination-leaf-${Date.now()}`;mkdirSync(dir,{recursive:true,mode:0o700});
try{for(let repeat=0;repeat<2;repeat++)for(let sample=0;sample<prepared.length;sample++)for(const mode of (sample+repeat)%2?[variantName,'original']:['original',variantName]){
 const f=prepared[sample],q=mode==='geometry'?f.geometry:f.q,context=structuredClone(f.data.context);
 if(mode==='arrival_label'){const points=context.argumentSemantics.alreadyWithinArrivalRadius;context.argumentSemantics.alreadyWithinArrivalRadius={meaning:'These are already reached coordinates: move execution does not start for them. This is a no-movement fact list, not a recommended destination list.',coordinates:points};const restored=structuredClone(context);restored.argumentSemantics.alreadyWithinArrivalRadius=restored.argumentSemantics.alreadyWithinArrivalRadius.coordinates;assert.deepEqual(restored,f.data.context);}
 const packed=jevLosslessRequest(context,q);assert.deepEqual(decodeJevState(packed.state),context);const out=await brain.post(`${c.jevUrl.replace(/\/$/,'')}/systemone`,c.jevKey,{model:c.jevModel,...packed},new AbortController().signal,[c.jevRate,0],c.selectorApiMs);
 const value=q.destination.criteria[out.answers.destination.choice]?.value;if(!value)throw Error('Invalid proposed coordinate');rows.push({sample,bot:f.bot,line:f.line,repeat,mode,value,inside:reachedCell(f.data.context.argumentSemantics.currentPosition,value,2),answers:out.answers,usage:out.usage});writeFileSync(dir+'/rows.json',JSON.stringify(rows),{mode:0o600});
}}finally{const costs=ledger.finish();const summary=Object.fromEntries(['original',variantName].map(m=>[m,{n:rows.filter(r=>r.mode===m).length,outside:rows.filter(r=>r.mode===m&&!r.inside).length}]));writeFileSync(dir+'/summary.json',JSON.stringify({summary,costs}),{mode:0o600});console.log(JSON.stringify({dir,summary,costs}));}
