import test from 'node:test';import assert from 'node:assert/strict';
import {taskReviewContract,validateTaskReview} from '../src/task-review.js';
import {planningFrames} from '../src/offline-evaluation.js';
const c:any={workIntent:{description:'record a place'},recentActions:[{id:7,outcome:'cancelled'}],placeMemoryReview:{recent:[{at:9,status:'applied'}]}};
test('task reviews cite supplied cancelled results and annotations without automatic completion',()=>{
 assert.deepEqual(taskReviewContract(c).allowedEvidenceIds,['current_observation','action:7','annotation:9']);
 const v={status:'completed',reason:'Confirmed gain despite cancellation',remaining:'',evidenceIds:['action:7']};
 assert.equal(validateTaskReview(v,c)?.status,'completed');
 assert.throws(()=>validateTaskReview({...v,evidenceIds:['action:8']},c),/Invalid/);
 assert.throws(()=>validateTaskReview({...v,remaining:'Still need the item'},c),/unfinished/);
 assert.throws(()=>validateTaskReview(undefined,c),/previous workIntent/);
 assert.equal(validateTaskReview(undefined,undefined),undefined);
 assert.throws(()=>validateTaskReview({...v,status:'deferred'},c),/unresolved/);
 assert.equal(validateTaskReview({...v,status:'continue',remaining:'Need physical confirmation'},c)?.status,'continue');
});
test('replay pairs interleaved calls by request id and never injects future evidence',()=>{
 const input=(id:string,n:number)=>[{event:'api_request',data:{id,phase:'dispatch'}},{event:'model_input',at:n,data:{context:{planning:{workIntent:{description:id}},allowedProposals:[],state:{inventory:{log:n}}}}}];
 const output=(id:string)=>[{event:'model_output',data:{content:{goal:id}}},{event:'api_request',data:{id,phase:'complete',elapsedMs:100}}];
 const es=[...input('a',1),...input('b',2),...output('b'),...output('a'),{event:'action_record',data:{future:true}}];
 const fs=planningFrames(es);assert.equal(fs.length,2);assert.equal(fs[1].output.goal,'a');assert.equal(fs[1].input.state.inventory.log,1);assert.equal(JSON.stringify(fs).includes('future'),false);
});

import {RecoveryMemory} from '../src/recovery.js';
import {Runtime} from '../src/runtime.js';import {MockWorld} from '../src/mock.js';import {MockBrain} from '../src/providers.js';
import {setTimeout as delay} from 'node:timers/promises';
test('applied medium review reaches next planning input without completing the long goal or executing a task',async()=>{
 const w=new MockWorld(),events:string[]=[];
 const next:any={goal:'Next work',preferred:'look',intent:{description:'Consider another observed landmark',desiredInventory:[],constraints:[]},taskReview:{status:'completed',reason:'Annotation applied',evidenceIds:['annotation:9'],remaining:''}};
 const r:any=new Runtime(w,{plan:async()=>next,choose:new MockBrain().choose},{planMs:30000,actionMs:1000,minConfidence:0,recovery:new RecoveryMemory()},(e)=>events.push(e));
 r.longGoal='Explore';r.plan={goal:'Record landmark',preferred:'look',intent:{description:'Record landmark',desiredInventory:[],constraints:[]}};
 try{r.refreshMedium(w.snapshot(),Date.now());await delay(0);assert.equal(r.planning.taskReviews.length,1);assert.equal(r.planning.taskReviews[0].description,'Record landmark');assert.equal(r.planning.workIntent.description,'Consider another observed landmark');assert.equal(r.planning.longTermGoal,'Explore');assert.equal(r.actionPending,false);assert.ok(events.includes('task_review'));}finally{r.close();}
});

test('freshness evidence distinguishes cached contents from a running inspection without deciding completion',()=>{
 const x=taskReviewContract({...c,activeExecution:{action:'inspect_container'}} as any,{containers:[{position:{x:1,y:2,z:3},observedAt:100,items:[]}]},120100);
 assert.equal(x.evidenceTiming.containerObservations[0].ageMs,120000);assert.equal(x.evidenceTiming.activeAction?.status,'running_not_completed');assert.equal((x as any).recommendedStatus,undefined);
});

import {bindWorkIntent} from '../src/task-review.js';
import {parseIntent} from '../src/work-intent.js';import {parsePlan,ApiBrain,Budget} from '../src/providers.js';import {config} from '../src/config.js';
import {validateGoalUpdates} from '../src/goals.js';
const freshTask=()=>bindWorkIntent({description:'Recheck chest contents',desiredInventory:[],constraints:['next: inspect chest','done: fresh contents observed after starting this task']});
test('task identity survives continuation and changes on replacement, with fixed completion criteria',()=>{
 const old=freshTask(),reword={description:'Refresh contents',desiredInventory:[],constraints:['done: merely see chest']};
 const inherited=bindWorkIntent(reword,old,{status:'continue'} as any);assert.equal(inherited.taskId,old.taskId);assert.deepEqual(inherited.completionCriteria,old.completionCriteria);assert.ok(inherited.continuationNote?.notAppliedDone);
 const kept=bindWorkIntent({...reword,constraints:old.constraints},old,{status:'continue'} as any);assert.equal(kept.taskId,old.taskId);assert.deepEqual(kept.completionCriteria,old.completionCriteria);
 const next=bindWorkIntent(reword,old,{status:'completed'} as any);assert.notEqual(next.taskId,old.taskId);assert.notEqual(next.completionCriteria![0].id,old.completionCriteria![0].id);
});
test('wrong task, old criterion, missing condition or unresolved condition cannot complete current work',()=>{
 const task=freshTask(),ctx={...c,workIntent:task};
 const review:any={taskId:task.taskId,status:'completed',reason:'Fresh inspection confirms contents',remaining:'',evidenceIds:['action:7'],criteriaEvidence:[{criterionId:task.completionCriteria![0].id,status:'satisfied',evidenceIds:['action:7'],explanation:'This receipt contains the requested fresh contents'}]};
 assert.equal(validateTaskReview(review,ctx)?.taskId,task.taskId);
 assert.throws(()=>validateTaskReview({...review,taskId:'old_survey'},ctx),/taskId/);
 assert.throws(()=>validateTaskReview({...review,criteriaEvidence:[]},ctx),/each supplied/);
 assert.throws(()=>validateTaskReview({...review,criteriaEvidence:[{...review.criteriaEvidence[0],criterionId:'old_survey:criterion:1'}]},ctx),/criterion/);
 assert.throws(()=>validateTaskReview({...review,criteriaEvidence:[{...review.criteriaEvidence[0],status:'unresolved'}]},ctx),/unresolved/);
 assert.throws(()=>validateTaskReview({...review,criteriaEvidence:[{...review.criteriaEvidence[0],evidenceIds:['action:future']}]},ctx),/criterion/);
});
test('misnested constraints relocate losslessly only when unambiguous, never accept conflicting copies',()=>{
 const raw={goal:'Chest',intent:{description:'Inspect',desiredInventory:[]},constraints:['done: contents known']};
 assert.deepEqual(parseIntent(raw,parsePlan).intent!.constraints,raw.constraints);assert.equal((raw.intent as any).constraints,undefined);
 assert.throws(()=>parseIntent({...raw,intent:{...raw.intent,constraints:['done: see chest']}},parsePlan),/ambiguous/);
});
test('output repair is bounded: compact, then same evidence, then rejection; transport errors are not retried',async()=>{
 for(const mode of ['fixed','invalid','transport']){
  const bodies:any[]=[];let count=0;const budget=new Budget(8,1),brain:any=new ApiBrain({...config(),llmKey:'fixture'},budget,async(_u,init)=>{bodies.push(JSON.parse(init!.body as string));count++;return Response.json({choices:[{message:{content:JSON.stringify({value:mode==='fixed'&&count===2?'ok':'bad'})}}],usage:{prompt_tokens:1,completion_tokens:1}});});
  const validate=(raw:any)=>{if(raw.value!=='ok')throw Error(mode==='transport'?'API transport':'Invalid value: expected ok');return raw;};
  const call=brain.generateValidated('test',{evidence:['unchanged']},new AbortController().signal,1000,100,validate);
  if(mode==='fixed'){assert.equal((await call).value,'ok');assert.equal(JSON.parse(bodies[1].messages[1].content).originalInput,undefined);}
  else{await assert.rejects(call);if(mode==='invalid')assert.deepEqual(JSON.parse(bodies[2].messages[1].content).originalInput,{evidence:['unchanged']});}
  assert.equal(count,mode==='transport'?1:mode==='fixed'?2:3);
 }
});
test('long goal length diagnostics name exact field without truncating intent',()=>{
 const raw={id:'goal',description:'x',reason:'x',successCriteria:'x'.repeat(494),status:'active',evidenceIds:['obs']};
 assert.throws(()=>validateGoalUpdates([raw]),/successCriteria length 494 exceeds 400/);assert.equal(raw.successCriteria.length,494);
});

test('a review for an old task cannot mutate the current task after asynchronous replacement',async()=>{
 const w=new MockWorld(),events:any[]=[];let resolve!:(p:any)=>void;
 const r:any=new Runtime(w,{plan:()=>new Promise(done=>{resolve=done;}),choose:new MockBrain().choose},{planMs:30000,actionMs:1000,minConfidence:0,recovery:new RecoveryMemory()},(e,d)=>events.push({e,d}));
 const old=freshTask(),other=freshTask();r.longGoal='Learn';r.plan={goal:'old',preferred:'look',intent:old};
 try{r.refreshMedium(w.snapshot(),Date.now());r.plan={goal:'new',preferred:'look',intent:other};resolve({goal:'stale',preferred:'look',intent:old});await delay(0);assert.equal(r.plan.intent.taskId,other.taskId);assert.equal(r.planning.taskReviews.length,0);assert.ok(events.some(x=>x.e==='plan_discarded'&&x.d.reason==='task changed during review'));}finally{r.close();}
});

test('resource outcome cannot silently change under continue; deferred creates matching new criteria',()=>{
 const old=bindWorkIntent({description:'Gather wood',desiredInventory:[{item:'oak_log',count:8}],constraints:['done: carry eight oak logs']});
 const next={description:'Gather wool',desiredInventory:[{item:'white_wool',count:6}],constraints:['done: carry six wool']};
 const kept=bindWorkIntent(next,old,{status:'continue'} as any);assert.deepEqual(kept.desiredInventory,old.desiredInventory);assert.deepEqual(kept.constraints.filter(c=>c.startsWith('done')),['done: carry eight oak logs']);assert.ok(kept.continuationNote?.notAppliedDesiredInventory);
 const newTask=bindWorkIntent(next,old,{status:'deferred'} as any);
 assert.notEqual(newTask.taskId,old.taskId);assert.equal(newTask.completionCriteria![0].text,next.constraints[0]);
 assert.equal(old.completionCriteria![0].text,'done: carry eight oak logs');
});
test('continue with a different outcome keeps the task contract and reports the unapplied fields',async()=>{
 const previous=bindWorkIntent({description:'Gather wood',desiredInventory:[{item:'oak_log',count:8}],constraints:['done: eight logs carried']});
 const next={description:'Gather wool',desiredInventory:[{item:'white_wool',count:6}],constraints:['next: approach sheep','done: six wool carried']};
 const applied=bindWorkIntent(next,previous,{status:'continue'} as any);
 assert.equal(applied.taskId,previous.taskId);assert.deepEqual(applied.desiredInventory,previous.desiredInventory);
 assert.deepEqual(applied.constraints,['next: approach sheep','done: eight logs carried']);
 assert.deepEqual(applied.continuationNote?.notAppliedDone,['done: six wool carried']);assert.deepEqual(applied.continuationNote?.notAppliedDesiredInventory,next.desiredInventory);
 const replaced=bindWorkIntent(next,previous,{status:'deferred'} as any);assert.notEqual(replaced.taskId,previous.taskId);assert.equal(replaced.completionCriteria![0].text,'done: six wool carried');assert.equal(replaced.continuationNote,undefined);
});

test('citation slips do not fail a plan: no-task reviews are dropped, unsupplied IDs removed, none left still fails',async()=>{
 const {validateTaskReview}=await import('../src/task-review.js');
 const review={status:'continue',reason:'still gathering',remaining:'two logs',evidenceIds:['current_observation','action:99']} as any;
 assert.equal(validateTaskReview(review,{} as any),undefined,'no previous workIntent: nothing to review');
 const c:any={workIntent:{taskId:'t1',description:'d',desiredInventory:[],constraints:[],completionCriteria:[]},recentActions:[]};
 const kept:any=validateTaskReview({...review,taskId:'t1',criteriaEvidence:[]},c);
 assert.deepEqual(kept.evidenceIds,['current_observation']);assert.deepEqual(kept.ignoredEvidenceIds,['action:99']);
 assert.throws(()=>validateTaskReview({...review,taskId:'t1',evidenceIds:['action:99'],criteriaEvidence:[]},c),/cite 1-8 of the supplied references: current_observation/);
 assert.throws(()=>validateTaskReview({...review,taskId:'t1',reason:'x'.repeat(401),criteriaEvidence:[]},c),/reason: required text of at most 400 characters \(received 401\)/);
});
