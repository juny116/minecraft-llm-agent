import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {planningFrames,planningRubric} from '../src/offline-evaluation.js';
import {MEDIUM_WORK_PROMPT,AUTOMATIC_OBSERVATION_CONTRACT} from '../src/medium-work-prompt.js';
import {PLACE_MEMORY_PROMPT} from '../src/important-places.js';
import {taskReviewContract,validateTaskReview} from '../src/task-review.js';
import {ApiBrain,Budget,parsePlan} from '../src/providers.js';import {parseIntent} from '../src/work-intent.js';import {config} from '../src/config.js';
const [source,outDir,baselineFile]=process.argv.slice(2).filter(x=>!x.startsWith('--'));
if(!source||!outDir)throw Error('Usage: trace.jsonl output-dir [baseline-prompt.ts] [--api]. Outputs contain private trace data; keep under ignored runs/.');
const events=readFileSync(source,'utf8').trim().split('\n').map(x=>JSON.parse(x)),frames=planningFrames(events);
mkdirSync(outDir,{recursive:true});writeFileSync(resolve(outDir,'frames.json'),JSON.stringify({rubric:planningRubric,frames},null,2));
console.log(JSON.stringify({frames:frames.length,mode:process.argv.includes('--api')?'bounded API replay':'extraction only'}));
if(process.argv.includes('--api')){
 if(!baselineFile)throw Error('Paired replay requires a baseline prompt module');
 const old=(await import(pathToFileURL(resolve(baselineFile)).href)).MEDIUM_WORK_PROMPT;
 const c=config(),budget=new Budget(20,.5),brain:any=new ApiBrain({...c,maxOutput:2200,apiMs:120000},budget);
 const chosen=(process.argv.includes('--freshness-cases')?[45,75]:[10,25,45,75]).filter(i=>i<frames.length),rows:any[]=[];
 for(let rep=0;rep<2;rep++)for(const index of chosen)for(const variant of process.argv.includes('--updated-only')?['updated']:rep%2?['updated','baseline']:['baseline','updated']){
  const f=frames[index],input=structuredClone(f.input);
  if(variant==='updated')input.taskReviewContract=taskReviewContract(input.planning,{containers:input.memory?.containers},f.at);
  const start=Date.now(),before=budget.usd;let row:any={index,rep,variant,prior:input.planning.workIntent?.description};
  try{
   const output=await brain.generate((variant==='updated'?MEDIUM_WORK_PROMPT:old)+AUTOMATIC_OBSERVATION_CONTRACT+PLACE_MEMORY_PROMPT,input,new AbortController().signal,120000,2200);
   row.output=output;parseIntent(output,parsePlan);if(variant==='updated')validateTaskReview(output.taskReview,input.planning);row.contractValid=true;
  }catch(e){row.error=e instanceof Error?e.message:'failure';row.contractValid=false;}
  row.elapsedMs=Date.now()-start;row.usd=budget.usd-before;rows.push(row);
  writeFileSync(resolve(outDir,'comparison.json'),JSON.stringify({rubric:planningRubric,calls:budget.calls,usd:budget.usd,rows},null,2));
  console.log(JSON.stringify({index,rep,variant,valid:row.contractValid,ms:row.elapsedMs,usd:row.usd,status:row.output?.taskReview?.status,error:row.error}));
 }
}
