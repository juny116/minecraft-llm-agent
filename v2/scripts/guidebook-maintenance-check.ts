/** Synthetic memory maintenance probe; no game connection or production memories. */
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';import assert from 'node:assert/strict';
import {ExperienceMemory,type GuideDraft} from '../src/experience-memory.js';import {MockWorld} from '../src/mock.js';import {compact,changes,type ActionRecord} from '../src/planning.js';
import {ApiBrain} from '../src/providers.js';import {config} from '../src/config.js';import {FunctionalLedger} from './functional-ledger.js';
if(!process.argv.includes('--with-api'))throw Error('Explicit --with-api required');
const limit=Number(process.argv.find(a=>a.startsWith('--authorized-total-usd='))?.split('=')[1]??5);
const dir=`runs/guidebook-check-${Date.now()}`;mkdirSync(dir,{recursive:true,mode:0o700});const memory=new ExperienceMemory(dir,'synthetic-functional-guidebook');
const before=compact(new MockWorld().snapshot()),after={...before,position:{x:8,y:64,z:0}};
const record:ActionRecord={id:1,decision:{action:'move',confidence:1},options:['move'],decisionObserved:before,source:'selector',selectorKind:'jev',planVersion:1,goal:'Observe nearby terrain',stepId:null,before,after,changes:changes(before,after),outcome:'succeeded',result:'Approached observed point',startedAt:1000,endedAt:2000};
const a=memory.add(record),b=memory.add({...record,id:2,startedAt:3000,endedAt:4000}),counter=memory.add({...record,id:3,after:before,changes:changes(before,before),outcome:'failed',result:'No observed route',startedAt:5000,endedAt:6000});
const draft=(id:string,support:string):GuideDraft=>({id,status:'active',text:'A remembered destination is a navigation reference, not proof that a traversable route still exists.',uncertainty:'Two successful approaches and one route failure; no universal reachability claim.',scope:{action:'move',health:[0,20],species:[],equipment:[]},support:[support],counterexamples:[counter]});
memory.apply(memory.reflection(),[draft('route_a',a),draft('route_b',b)],'fixture');
const rawBefore=JSON.parse(readFileSync(dir+'/memory.json','utf8')),input={...memory.reflection(),maintenance:true};
const ledger=new FunctionalLedger('runs/functional-cost-ledger.json',3,.04,limit),brain=new ApiBrain(config(),ledger.budget);
let result:any;
try{const updates=await brain.reflect(input,new AbortController().signal);writeFileSync(dir+'/updates.json',JSON.stringify(updates),{mode:0o600});memory.apply(input,updates,brain.reflectionModel);
 const rawAfter=JSON.parse(readFileSync(dir+'/memory.json','utf8'));assert.deepEqual(rawAfter.episodes,rawBefore.episodes);assert.deepEqual(rawAfter.revisions.slice(0,rawBefore.revisions.length),rawBefore.revisions);
 const restored=new ExperienceMemory(dir,'synthetic-functional-guidebook');assert.deepEqual(restored.retrieve(),memory.retrieve());
 result={updates,activeBefore:2,activeAfter:restored.retrieve().length,rawEpisodesPreserved:true,restartVerified:true};
}finally{const costs=ledger.finish();writeFileSync(dir+'/result.json',JSON.stringify({result,costs}),{mode:0o600});console.log(JSON.stringify({dir,result,costs}));}
