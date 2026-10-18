import {writeFileSync} from 'node:fs';
import {config} from '../src/config.js';
import {ApiBrain} from '../src/providers.js';
import {MockWorld} from '../src/mock.js';
import {candidates,type Plan} from '../src/types.js';
import {executionOptions,type Option} from '../src/supervision.js';
import {FunctionalLedger} from '../scripts/functional-ledger.js';
if(!process.argv.includes('--with-jev'))throw Error('Explicit --with-jev required');
const c=config();c.mode='jev';
const s=new MockWorld().snapshot();s.canEat=true;s.inventory=[{name:'bread',count:3,slot:9},{name:'wooden_pickaxe',count:1,slot:10}];
s.vision!.blocks=['oak_log','stone','dirt'].map((name,i)=>({name,position:{x:i+2,y:64,z:0},lastSeen:0}));
s.navigationTargets=[{x:8,y:64,z:0},{x:-8,y:64,z:0}];
const cases=[
{name:'wood',goal:'Gather wood for basic supplies.',expected:'mine:oak_log'},
{name:'stone',goal:'Gather cobblestone to upgrade wooden tools.',expected:'mine:stone'},
{name:'dirt',goal:'Gather dirt as temporary construction material.',expected:'mine:dirt'},
{name:'east',goal:'Rendezvous with Alice at her observed position.',expected:'move:8',peer:8},
{name:'west',goal:'Rendezvous with Alice at her observed position.',expected:'move:-8',peer:-8},
{name:'hunger',goal:'Gather wood for basic supplies.',expected:'eat',food:5}
];
const ledger=new FunctionalLedger('runs/functional-cost-ledger.json',18,.10,15),brain=new ApiBrain(c,ledger.budget),rows:any[]=[];
try{
for(let round=0;round<3;round++)for(const t of cases){
const state=structuredClone(s);state.food=t.food??20;
if(t.peer)state.nearbyPlayers=[{name:'Alice',position:{x:t.peer,y:64,z:0}}];
const base:Plan={goal:t.goal,preferred:'look'};
const opts:Option[]=[];
const add=(action:Option['action'],plan:Plan)=>{if(candidates(state,plan).includes(action))opts.push({id:'',action,plan});};
for(const b of state.vision!.blocks)add('mine',{...base,preferred:'mine',mine:{position:b.position,expected:b.name}});
for(const destination of state.navigationTargets!)add('move',{...base,preferred:'move',destination});
add('eat',{...base,preferred:'eat'});
// Rotate and reverse options; IDs encode no target or expected answer.
const shift=round*2;let ordered=[...opts.slice(shift),...opts.slice(0,shift)];if(round===1)ordered.reverse();
ordered=ordered.map((o,i)=>({...o,id:'option_'+i}));
const started=Date.now();
const answer=await brain.supervise(state,{options:ordered,execution:null,inbox:[],goal:t.goal},AbortSignal.timeout(30000));
const selected=ordered.find(o=>o.id===answer.choice);
const key=selected?.action==='mine'?'mine:'+selected.plan.mine!.expected:selected?.action==='move'?'move:'+selected.plan.destination!.x:selected?.action??answer.choice;
rows.push({case:t.name,round,expected:t.expected,selected:key,pass:key===t.expected,ms:Date.now()-started,confidence:answer.confidence,legacyMineChoices:executionOptions(state,base).filter(o=>o.action==='mine').length});
}
}finally{
const cost=ledger.finish();const report={scope:'Synthetic API decision probe only; no game connection or LLM calls. Six hand-authored cases, three orderings each. Not an autonomous gameplay benchmark.',model:c.jevModel,rows,cost};
writeFileSync('runs/target-choice-probe-results.json',JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));
}
