/** Read-only saved request audit; optional bounded API acceptance checks, no world connection. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import assert from 'node:assert/strict';
import {movementEvidence,decodeMovementBlocks} from '../src/move-context.js';
import {decodeJevQuestions,decodeJevState,jevLosslessRequest} from '../src/jev-state.js';
import {config} from '../src/config.js';import {ApiBrain} from '../src/providers.js';import {FunctionalLedger} from './functional-ledger.js';
const arg=(k:string)=>process.argv.find(x=>x.startsWith(k+'='))?.slice(k.length+1);
if(!arg('--input'))throw Error('Supply --input');
const es=readFileSync(arg('--input')!,'utf8').trim().split('\n').map(l=>JSON.parse(l));
const failed=new Set(es.filter(e=>e.event==='api_request'&&e.data.phase==='context_limit').map(e=>e.data.id));const frames:any[]=[];
for(let i=0;i<es.length;i++){
 const e=es[i];if(e.event!=='model_input'||!failed.has(es[i-1]?.data.id))continue;
 const old=e.data.context,data=structuredClone(old),points=decodeMovementBlocks(old.movementEvidence);
 data.movementEvidence=movementEvidence({places:points,vision:{yaw:0,pitch:0,blocks:points.filter((p:any)=>p.visibility==='current')},navigationTargets:old.movementEvidence.navigationHints});
 assert.deepEqual(decodeMovementBlocks(data.movementEvidence),points);
 const q=decodeJevQuestions(e.data.questions),packed=jevLosslessRequest(data,q),decoded=decodeJevState(packed.state);
 assert.deepEqual(decoded,data);assert.deepEqual(decodeJevQuestions(packed.questions),q);
 decoded.movementEvidence=old.movementEvidence;assert.deepEqual(decoded,old);
 frames.push({line:i+1,packed,oldBytes:Buffer.byteLength(JSON.stringify({state:e.data.wireState,questions:e.data.questions})),newBytes:Buffer.byteLength(JSON.stringify(packed))});
}
if(!frames.length)throw Error('No context-limit inputs');
const sizes={count:frames.length,oldMax:Math.max(...frames.map(f=>f.oldBytes)),newMax:Math.max(...frames.map(f=>f.newBytes)),oldMean:frames.reduce((n,f)=>n+f.oldBytes,0)/frames.length,newMean:frames.reduce((n,f)=>n+f.newBytes,0)/frames.length};console.log(JSON.stringify(sizes));
if(process.argv.includes('--with-api')){
 const c=config(),ledger=new FunctionalLedger('runs/functional-cost-ledger.json',8,.08,Number(arg('--authorized-total-usd')??5));const brain:any=new ApiBrain(c,ledger.budget),rows:any[]=[],dir=`runs/repack-context-${Date.now()}`;mkdirSync(dir,{recursive:true,mode:0o700});
 try{for(const i of [...new Set([0,Math.floor(frames.length/2),frames.length-1])]){const f=frames[i];const out=await brain.post(`${c.jevUrl.replace(/\/$/,'')}/systemone`,c.jevKey,{model:c.jevModel,...f.packed},new AbortController().signal,[c.jevRate,0],c.selectorApiMs);rows.push({line:f.line,inputTokens:out.usage?.input_tokens,answers:out.answers,newBytes:f.newBytes});}}
 finally{const costs=ledger.finish();writeFileSync(dir+'/summary.json',JSON.stringify({sizes,rows,costs}),{mode:0o600});console.log(JSON.stringify({dir,sizes,calls:rows.length,costs}));}
}
