import test from 'node:test';import assert from 'node:assert/strict';
import {MockWorld} from '../src/mock.js';import {actionDomains} from '../src/action-domains.js';
import {actionAvailability,offeredArgumentView} from '../src/selection-facts.js';
import {currentModelState,feedbackView} from '../src/selector-context.js';
import {parameterSupervise} from '../src/parameter-supervisor.js';import {directSelection} from '../src/direct-selection.js';import {planningInput} from '../src/planning-input.js';
function scene(){const s=new MockWorld().snapshot();s.position={x:.5,y:64,z:.5};s.perception={mode:'panorama',range:48};s.places=[];s.vision!.blocks=[];for(let x=-12;x<=12;x++)for(let z=-12;z<=12;z++)s.vision!.blocks.push({name:'grass_block',position:{x,y:63,z},lastSeen:1});s.vision!.blocks.push({name:'oak_log',position:{x:11,y:64,z:0},lastSeen:1});s.craftable=['white_carpet'];s.inventoryCraftable=['white_carpet'];s.inventory=[{name:'white_wool',count:3,slot:36}];return s;}
const input={options:[],execution:null,inbox:[],goal:'Obtain one white bed'};
test('scope facts distinguish known outside logs from every offered block without changing domains',()=>{
 const s=scene(),before=structuredClone(s),d=actionDomains(s),a=actionAvailability(s);
 assert.ok(!d.mine.values.some(b=>b.name==='oak_log'));assert.ok(d.mine.outside.some(b=>b.name==='oak_log'));
 assert.equal(a.mine.selectable.count,d.mine.values.length);assert.equal(a.mine.knownOutsideScope.count,d.mine.outside.length);
 assert.match(JSON.stringify(a.mine.knownOutsideScope),/oak_log/);assert.doesNotMatch(JSON.stringify(a.mine.selectable),/oak_log/);
 assert.deepEqual(a.craft.recipeOutputs,['white_carpet']);assert.deepEqual(s,before);
 const projected=currentModelState(s);assert.deepEqual(projected.actionAvailability,a);assert.deepEqual(currentModelState(projected),projected);
});
test('withdrawal preserves exact offered candidates and bound values; unchanged versus changed domain is factual',async()=>{
 const s=scene();let calls=0;
 const out=await parameterSupervise(s,input,directSelection(async(q,c)=>{calls++;if(!c.argumentName){assert.ok(q.action.criteria.craft);return {action:{type:'choice',choice:'craft',confidence:.4},review:{type:'choice',choice:'none',confidence:1}};}return {recipeOutput:{type:'choice',choice:'revise',confidence:.8}};}),'coordinated');
 assert.equal(calls,2);assert.equal(out.choice,'unresolved');assert.deepEqual(out.attempt?.offeredArguments,[{name:'recipeOutput',values:['white_carpet']}]);
 const feedback=JSON.stringify({reason:out.reason,attempt:out.attempt}),status={current:{id:1,at:1,status:'unreviewed',feedback}};
 let v=feedbackView(status,undefined,s);assert.deepEqual(v.entries[0].offeredArguments[0].offered.values,['white_carpet']);assert.equal(v.entries[0].offeredArguments[0].sameCandidatesNow,true);
 s.craftable=['white_bed'];v=feedbackView(status,undefined,s);assert.equal(v.entries[0].offeredArguments[0].sameCandidatesNow,false);
 const p=planningInput({selectorFeedback:feedback,selectorFeedbackStatus:{...status,history:[],total:1,omittedHistoryCount:0}} as any)!;
 assert.deepEqual(JSON.parse(p.selectorFeedback!).attempt.offeredArguments[0].candidates.values,['white_carpet']);assert.equal(JSON.parse(feedback).attempt.offeredArguments[0].values[0],'white_carpet');
});
test('a batched withdrawal retains both candidate questions and earlier recipe binding',async()=>{
 const s=scene();s.craftable=['white_bed'];s.inventoryCraftable=[];s.vision!.blocks.push({name:'crafting_table',position:{x:2,y:64,z:0},lastSeen:1});
 const out=await parameterSupervise(s,input,directSelection(async(q,c)=>!c.argumentName?{action:{type:'choice',choice:'craft',confidence:1},review:{type:'choice',choice:'none',confidence:1}}:Object.fromEntries(Object.keys(q).map(n=>[n,{type:'choice',choice:n==='workstation'?'revise':'value_0',confidence:1}]))),'coordinated');
 assert.equal(out.choice,'unresolved');assert.equal(out.attempt?.boundArguments.recipeOutput,'white_bed');assert.deepEqual(out.attempt?.offeredArguments?.map(o=>o.name),['recipeExecutions','workstation']);
});
test('large receipt distinguishes coordinates but groups clock-only reobservations as unchanged',()=>{
 const s=scene(),values=structuredClone(actionDomains(s).mine.values);assert.equal(offeredArgumentView({name:'block',values},s).sameCandidatesNow,true);
 s.vision!.blocks.forEach(b=>b.lastSeen=20);assert.equal(offeredArgumentView({name:'block',values},s).sameCandidatesNow,true);
 s.vision!.blocks.find(b=>b.position.x===0&&b.position.z===0)!.name='stone';assert.equal(offeredArgumentView({name:'block',values},s).sameCandidatesNow,false);
});

test('an entity is never interpreted as a matching block/drop by procedure preview',async()=>{
 const {inspectProcedureOffer}=await import('../src/procedure.js');const s=scene();s.inventory=[];s.animals=[{id:99,kind:'sheep',position:{x:1,y:64,z:0},distance:1}];
 const p:any={goal:'Obtain materials',preferred:'mine',procedure:{version:1,maxActions:8,maxMs:30000,steps:[{id:'wool',action:'mine',item:'white_wool',area:{center:{x:0,y:64,z:0},radius:6},targetCount:3}]}};
 const v=inspectProcedureOffer(p,s,()=>[]);assert.equal(v.available,false);assert.equal(v.blockedStep?.item,'white_wool');assert.equal(v.blockedStep?.visibleMatchingBlocks,0);assert.equal(v.blockedStep?.observedMatchingDrops,0);
 s.vision!.blocks.push({name:'white_wool',position:{x:2,y:64,z:0},lastSeen:1});assert.equal(inspectProcedureOffer(p,s,()=>[]).available,true);
});

test('current combat target joins observed animal identity without inventing health or preferring another target',async()=>{
 const {executionTargetObservation}=await import('../src/selection-facts.js');const s=scene();s.animals=[{id:7,kind:'sheep',position:{x:3,y:64,z:0},distance:3,health:8} as any];
 const e={action:'attack',plan:{targetEntityId:7}},a=executionTargetObservation(s,e)!;assert.equal(a.source,'visible_animal');assert.equal(a.kind,'sheep');assert.equal('health'in a,false);
 s.animals=[];const unknown=executionTargetObservation(s,e)!;assert.equal(unknown.entityId,7);assert.equal(unknown.source,'not_currently_visible');assert.equal('position'in unknown,false);assert.equal(executionTargetObservation(s,{action:'craft',plan:{}}),undefined);
});
test('execution identity is joined in both selector and procedure context while explicit stop remains selectable',async()=>{
 const {selectorContext}=await import('../src/selector-context.js');const {procedureSituation}=await import('../src/procedure-supervision.js');
 const s=scene();s.animals=[{id:7,kind:'sheep',position:{x:3,y:64,z:0},distance:3}];
 const i:any={...input,procedure:{id:'finished',status:'completed',stepIndex:1,completedSteps:['wood'],definition:{steps:[]}},execution:{id:2,action:'attack',plan:{goal:'Observe result',preferred:'attack',targetEntityId:7},elapsedMs:500}};
 const c=selectorContext(s,i,{});assert.equal(c.execution?.targetObservation?.source,'visible_animal');assert.deepEqual(procedureSituation(s,i)?.currentExecution?.targetObservation,c.execution?.targetObservation);
 const r=await parameterSupervise(s,i,directSelection(async q=>{assert.ok(q.action.criteria.stop);assert.ok(q.action.criteria.attack);assert.ok(q.action.criteria.continue);return {action:{type:'choice',choice:'stop',confidence:.1},review:{type:'choice',choice:'none',confidence:1}};}),'coordinated');assert.equal(r.choice,'stop');
});
