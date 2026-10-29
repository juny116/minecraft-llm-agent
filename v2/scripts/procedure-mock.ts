// Deterministic plumbing verification. Neither LLM/JEV quality nor live physics is measured.
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {Runtime} from '../src/runtime.js';
import {carried} from '../src/procedure.js';
import {ProcedureWorld,scriptedBrain,until} from '../test/fixtures/procedure.js';
const dir=process.argv[2]??join('runs','procedure-mock-'+new Date().toISOString().replace(/[:.]/g,'-'));
mkdirSync(dir,{recursive:true,mode:0o700});
const events:any[]=[],world=new ProcedureWorld();
const runtime=new Runtime(world,scriptedBrain(),{workflowMode:'procedural',planMs:45000,actionMs:2000,minConfidence:.55,selectorMs:0},(event,fields)=>events.push({at:Date.now(),evidence:'scripted-offline-mock',event,...fields}));
try{
 await until(()=>runtime.executionStatus.procedure?.status==='completed',()=>runtime.tick());
 const report={evidence:'scripted-offline-mock',apiCalls:0,usd:0,liveServer:false,procedure:runtime.executionStatus.procedure,actions:world.starts,inventory:world.state.inventory,maxConcurrentExecutors:world.maxActive,passed:carried(world.state,'oak_planks')===8&&world.maxActive===1};
 writeFileSync(join(dir,'report.json'),JSON.stringify(report,null,2),{mode:0o600});
 writeFileSync(join(dir,'events.jsonl'),events.map(e=>JSON.stringify(e)).join('\n')+'\n',{mode:0o600});
 console.log(JSON.stringify({passed:report.passed,actions:report.actions.map(x=>x.action),planks:carried(world.state,'oak_planks'),apiCalls:0,usd:0,dir}));
 if(!report.passed)process.exitCode=1;
}finally{runtime.close();}
