import {readFileSync,writeFileSync} from 'node:fs';
import {ApiBrain,Budget} from '../src/providers.js';import {config} from '../src/config.js';
if(!process.argv.includes('--api'))throw Error('This comparison calls the paid API; pass --api explicitly.');
const [file,out]=process.argv.slice(2).filter(x=>!x.startsWith('--'));if(!file||!out)throw Error('Usage: private-trace.jsonl private-output.json');
const es=readFileSync(file,'utf8').trim().split('\n').map(x=>JSON.parse(x)),pending=new Map(),frames:any[]=[];
for(let i=0;i<es.length;i++){const e=es[i],d=e.data;
 if(e.event==='model_input'&&d.questions?.action?.criteria?.stop){if(es[i-1]?.data?.phase!=='dispatch')throw Error('Uncorrelated input');pending.set(es[i-1].data.id,d);}
 if(e.event==='api_request'&&d.phase==='complete'&&pending.has(d.id)&&es[i-1]?.event==='model_output'&&es[i-1].data.content?.answers?.action?.choice==='stop')frames.push(pending.get(d.id));
}
// Some trace writers log answers directly rather than wrapping them.
if(!frames.length)for(let i=1;i<es.length;i++){const e=es[i];if(e.event==='api_request'&&e.data.phase==='complete'&&pending.has(e.data.id)&&es[i-1]?.data?.content?.action?.choice==='stop')frames.push(pending.get(e.data.id));}
const c=config(),b=new Budget(20,.25),brain:any=new ApiBrain(c,b),rows:any[]=[];
for(let rep=0;rep<2;rep++)for(const index of [0,Math.floor(frames.length/3),Math.floor(frames.length*2/3),frames.length-1]){
 if(index<0)continue;const f=frames[index];
 for(const variant of rep%2?['updated','baseline']:['baseline','updated']){
  const q=structuredClone(f.questions);if(variant==='updated')q.action.criteria.stop='Stop immediately without replacement, when continuing during selection is undesirable. To switch tasks, choose the replacement action directly; its arguments are prepared while current work runs, then the executor switches. stop is NOT a prerequisite for switching.';
  const start=Date.now();try{const out=await brain.post(c.jevUrl.replace(/\/$/,'')+'/systemone',c.jevKey,{model:c.jevModel,state:f.wireState,questions:q},new AbortController().signal,[c.jevRate,0],30000);rows.push({index,rep,variant,ms:Date.now()-start,answers:out.answers});}catch(e){rows.push({index,rep,variant,error:e instanceof Error?e.message:'failure'});}
  writeFileSync(out,JSON.stringify({historicalStops:frames.length,calls:b.calls,usd:b.usd,rows},null,2));
 }
}
console.log(JSON.stringify({historicalStops:frames.length,calls:b.calls,usd:b.usd,rows:rows.map(r=>({index:r.index,rep:r.rep,variant:r.variant,choice:r.answers?.action?.choice,error:r.error}))}));
