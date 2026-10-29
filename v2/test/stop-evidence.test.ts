import test from 'node:test';import assert from 'node:assert/strict';
import {combat,COMBAT_BUDGET_MS,type CombatProgress,type CombatPort} from '../src/combat.js';
import {capturePlanBasis,planFreshness} from '../src/plan-freshness.js';
import {ProcedureWorld,scriptedBrain,until,woodPlan} from './fixtures/procedure.js';
import {Runtime} from '../src/runtime.js';import {compact,changes} from '../src/planning.js';
import {parameterSupervise} from '../src/parameter-supervisor.js';import {selectorContext} from '../src/selector-context.js';
import {MineflayerWorld} from '../src/mineflayer.js';
test('combat reports approach and initial swing delay, preserves immediate cancellation and does not infer hits',async()=>{
 let now=0;const progress:CombatProgress[]=[],swings:number[]=[];const abort=new AbortController();
 const enemy={id:22,kind:'sheep',position:{x:5,y:0,z:0},distance:5};
 const port:CombatPort={observe:()=>({health:20,position:{x:0,y:0,z:0},enemies:[enemy]}),equipWeapon:async()=>{},cooldownMs:()=>1250,approach:()=>{enemy.distance=2;},strike:async()=>{swings.push(now);return true;},retreat:()=>true,stop:()=>{},wait:async ms=>{now+=ms;if(now>=400)abort.abort();},now:()=>now,progress:p=>progress.push(p)};
 await assert.rejects(combat(port,'attack',abort.signal,{targetId:22,modelSelected:true}));
 assert.equal(progress[0].mode,'approach');assert.ok(progress.some(p=>p.mode==='cooldown'&&p.nextSwingInMs===1150));
 assert.equal(progress.at(-1)?.outcome,'cancelled');assert.equal(progress.at(-1)?.attacksSent,0);assert.deepEqual(swings,[]);
 assert.ok(progress.every(p=>!('health' in p)&&!('position' in p)));
});
test('combat progress hides lost-target distance, counts own sent swings and returns its time limit',async()=>{
 let now=0;const seen:CombatProgress[]=[];let visible=true;const enemy={id:22,kind:'sheep',position:{x:1,y:0,z:0},distance:1};
 const port:CombatPort={observe:()=>({health:20,position:{x:0,y:0,z:0},enemies:visible?[enemy]:[]}),equipWeapon:async()=>{},cooldownMs:()=>700,approach:()=>{},strike:async()=>true,retreat:()=>true,stop:()=>{},faceLastSeen:async()=>{},wait:async ms=>{now+=ms;visible=now<800||now>=1000;},now:()=>now,progress:p=>seen.push(p)};
 const result=await combat(port,'attack',new AbortController().signal,{targetId:22,modelSelected:true});
 assert.equal(result.attacksSent,Math.floor((COMBAT_BUDGET_MS-1)/700));assert.equal(result.outcome,'time_limit');assert.equal(seen.at(-1)?.attacksSent,Math.floor((COMBAT_BUDGET_MS-1)/700));
 const hidden=seen.find(p=>p.mode==='reobserve')!;assert.ok(hidden);assert.equal(hidden.targetVisible,false);assert.equal(hidden.distance,undefined);
 const w=Object.create(MineflayerWorld.prototype) as any;w.motor={phase:'tracking',at:Date.now(),blockBroken:false,combat:seen[0]};const view=w.executionProgress();view.combat.attacksSent=99;assert.equal(w.motor.combat.attacksSent,0);
});
test('completed procedure is not described as suspended and does not remove stop or alternatives',async()=>{
 const w=new ProcedureWorld();const input:any={options:[],execution:{id:4,action:'attack',plan:{goal:'wool',preferred:'attack',targetEntityId:22},elapsedMs:180},inbox:[],goal:'bed',plan:woodPlan,procedure:{id:'old',status:'completed',completedSteps:['boards'],stepIndex:2,resumeAvailable:false,definition:woodPlan.procedure}};
 const out=await parameterSupervise(w.snapshot(),input,async(q)=>{
  assert.equal(selectorContext(w.snapshot(),input,{}).lastProcedure!.status,'completed');assert.equal(selectorContext(w.snapshot(),input,{}).procedure,undefined);assert.doesNotMatch(q.action.criteria.attack as string,/stays suspended/);
  assert.ok(q.action.criteria.stop);assert.ok(q.action.criteria.continue);assert.ok(q.action.criteria.move);assert.equal(q.action.criteria.resume_procedure,undefined);
  return {action:{type:'choice',choice:'stop',confidence:.01},review:{type:'choice',choice:'none',confidence:.5}};
 });assert.equal(out.choice,'stop');
});
test('plan chronology exposes finished work without changing the proposed intention or marking task complete',()=>{
 const w=new ProcedureWorld();w.set('oak_log',1);const before=w.snapshot();
 const c:any={activeExecution:{id:2,action:'craft'},procedure:{id:'p',status:'running',completedSteps:[]},recentActions:[]};const basis=capturePlanBasis(before,c,100);
 w.set('oak_log',0);w.set('oak_planks',4);const after=w.snapshot();
 const record:any={id:1,decision:{action:'craft'},outcome:'succeeded',endedAt:110,changes:changes(compact(before),compact(after))};
 const f=planFreshness({...basis,appliedAt:150},after,{activeExecution:null,procedure:{...c.procedure,status:'completed',completedSteps:['boards']},recentActions:[record]},160)!;
 assert.deepEqual(f.inventoryChanges,[{item:'oak_log',atRequest:1,now:0},{item:'oak_planks',atRequest:0,now:4}]);assert.equal(f.procedureChanged,true);assert.equal(f.executionChanged,true);assert.equal(f.ageMs,60);assert.equal(f.resultsSinceRequest[0].outcome,'succeeded');assert.equal(basis.procedure!.status,'running');
 const input:any={options:[],execution:null,inbox:[],goal:'bed',plan:woodPlan,planFreshness:f};assert.deepEqual(selectorContext(after,input,{}).planFreshness,f);assert.deepEqual(input.plan,woodPlan);
});
test('late medium response retains request time and exposes subsequent completion; it requests review without forcing action',async()=>{
 const w=new ProcedureWorld();w.set('oak_log',1);let release!:(p:any)=>void;
 const brain=scriptedBrain();brain.plan=()=>new Promise(r=>release=r);
 const r=new Runtime(w,brain,{workflowMode:'procedural',planMs:45000,actionMs:2000,minConfidence:.5},()=>{});const rt=r as any;
 try{rt.options.goals=undefined;rt.longGoal='Make bed';rt.activeAction='craft';rt.actionPending=true;rt.executionPlan={goal:'boards',preferred:'craft'};rt.executionId=2;rt.executionStarted=Date.now();
  rt.refreshMedium(w.snapshot(),Date.now());assert.ok(release);w.set('oak_log',0);w.set('oak_planks',4);rt.actionPending=false;rt.activeAction=undefined;rt.latestSnapshot=w.snapshot();
  release({goal:'Bed',preferred:'look',intent:{description:'After the plank result, acquire missing wool then craft bed',desiredInventory:[{item:'white_bed',count:1}],constraints:[]}});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(r.planning.planFreshness!.executionAtRequest!.action,'craft');assert.equal(r.planning.planFreshness!.currentExecution,null);assert.equal(r.planning.planFreshness!.inventoryChanges.length,2);assert.ok(r.planning.replanReasons.includes('execution_evidence_changed_during_plan'));assert.equal(w.starts.length,0);
 }finally{r.close();}
});
test('supervisor stop remains effective and its origin reaches both later selector and planner',async()=>{
 const w=new ProcedureWorld();w.waitMs=1000;w.state.animals=[{id:22,kind:'sheep',position:{x:2,y:64,z:0},distance:2}];let stop=false;
 const inputs:any[]=[];let done=false;const b=scriptedBrain(async(_s,i)=>{inputs.push(i);return done?{choice:'unresolved',confidence:.5,review:'none',routes:{}}:i.execution&&stop?{choice:'stop',confidence:.01,review:'none',routes:{}}:{choice:'selected',confidence:.5,review:'none',routes:{},selected:{id:'a',action:'attack',plan:{goal:'wool',preferred:'attack',modelSelected:true,targetEntityId:22}}};});
 const r=new Runtime(w,b,{workflowMode:'procedural',selectorMs:0,planMs:45000,actionMs:2000,minConfidence:.5},()=>{});
 try{await until(()=>r.executionStatus.actionPending,()=>r.tick());await r.tick();assert.equal(w.starts.length,1);assert.equal(r.executionStatus.actionPending,true);stop=true;await r.tick();await new Promise(resolve=>setTimeout(resolve,5));
  const rec=r.planning.recentActions.at(-1)!;assert.equal(rec.outcome,'cancelled');assert.equal(rec.interruption?.source,'supervisor');assert.equal(rec.interruption?.choice,'stop');
  const input:any={options:[],execution:null,inbox:[],goal:'bed',recentOutcome:rec};const c=selectorContext(w.snapshot(),input,{});assert.deepEqual(c.recentOutcome!.interruption,rec.interruption);assert.equal(c.recentOutcome!.target!.entityId,22);done=true;await r.tick();assert.equal(inputs.at(-1).recentResults.at(-1).interruption.choice,'stop');
 }finally{r.close();}
});
