import {emptyActions} from '../src/action-domains.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {parameterSupervise,cameraArgumentEffect,type Ask} from '../src/parameter-supervisor.js';
import {actions,type Plan} from '../src/types.js';
import type {SupervisorInput} from '../src/supervision.js';
import {MockWorld} from '../src/mock.js';
import {ApiBrain,Budget,modelPlanView,parsePlan} from '../src/providers.js';
import {config} from '../src/config.js';
import {decodeJevState} from '../src/jev-state.js';

const input:SupervisorInput={options:[],execution:null,inbox:[],goal:'Choose your own activity',parameterSelection:true};
const intent=()=>parsePlan({goal:'Observe the area',intent:{description:'Choose an activity from current observations',desiredInventory:[],constraints:[]},proposals:[]});
function fixture(){
 const s=new MockWorld().snapshot();
 s.inventory=[{name:'oak_planks',count:3,slot:9}];s.placeableItems=['oak_planks'];
 s.placementSites=[{position:{x:2,y:65,z:0},reference:{x:2,y:64,z:0}}];
 return s;
}
function answers(action:string,review='none',argument='revise'):Ask{
 return async(q,c)=>Object.fromEntries(Object.keys(q).map(k=>[k,{type:'choice',choice:c.argumentName?(argument==='value_0'&&!q[k].criteria.value_0?'group_0':argument):k==='action'?action:review,confidence:.01}]));
}

test('coordinated separates planning from action and offers every non-idle action that has targets',async()=>{
 let menu:string[]=[];const s=fixture();s.craftable=['oak_slab'];
 const d=await parameterSupervise(s,input,async(q,c)=>{
  if(!c.argumentName){menu=Object.keys(q.action.criteria);assert.ok(q.review);assert.match(q.action.instructions,/does not suspend action selection/);}
  return answers('look','medium','value_0')(q,c);
 },'coordinated');
 assert.deepEqual(menu,actions.filter(a=>a!=='idle'&&!emptyActions(s).includes(a)));
 assert.equal(d.selected?.action,'look');assert.equal(d.selected?.plan.waitMs,undefined);
 assert.equal(d.review,'medium');assert.deepEqual(d.selectionControl,{action:'look',review:'medium'});
});

test('coordinated allows continue and stop only for existing execution',async()=>{
 const running={...input,execution:{id:1,action:'mine' as const,plan:{goal:'work',preferred:'mine' as const},elapsedMs:10}};
 const d=await parameterSupervise(fixture(),running,async(q,c)=>{
  assert.ok(q.action.criteria.continue);assert.ok(q.action.criteria.stop);assert.ok(!q.action.criteria.reconsider);
  return answers('continue','long')(q,c);
 },'coordinated');
 assert.equal(d.choice,'continue');assert.equal(d.review,'long');
});

test('argument withdrawal preserves independent review choice including no review and long review',async()=>{
 for(const review of ['none','medium','long'] as const){
  const d=await parameterSupervise(fixture(),input,answers('place_block',review),'coordinated');
  assert.equal(d.choice,'unresolved');assert.equal(d.selected,undefined);assert.equal(d.review,review);
  assert.deepEqual(d.selectionControl,{action:'place_block',review,argumentOutcome:'withdrawn'});
  assert.equal(d.attempt?.unresolvedArgument?.name,'blockItem');
 }
});

test('removed wait is rejected and empty argument domains do not synthesize planning requests',async()=>{
 await assert.rejects(parameterSupervise(fixture(),input,answers('wait'),'coordinated'),/Invalid parameter selection/);
 const s=fixture();s.placeableItems=[];
 await assert.rejects(parameterSupervise(s,input,answers('place_block'),'coordinated'),/Invalid parameter selection/,'an empty-domain action is not offered');
});

test('legacy and explicit preserve their previous reconsider contract for comparisons',async()=>{
 for(const contract of ['legacy','explicit'] as const){
  const d=await parameterSupervise(fixture(),input,async(q,c)=>{
   assert.ok(q.action.criteria.reconsider);return answers('reconsider','none')(q,c);
  },contract);
  assert.equal(d.choice,'unresolved');assert.equal(d.review,'medium');assert.equal(d.selectionControl,undefined);
 }
});

test('coordinated does not filter or rank any argument value from explicit',async()=>{
 const collect=async(contract:'explicit'|'coordinated')=>{
  const calls:any[]=[];
  const d=await parameterSupervise(fixture(),input,async(q,c)=>{
   calls.push({q,c});
   if(!c.argumentName)return answers('place_block')(q,c);
   const name=Object.keys(q)[0];return {[name]:{type:'choice',choice:Object.keys(q[name].criteria).find(k=>k!=='revise'),confidence:.01}};
  },contract);
  return {calls,d};
 };
 const a=await collect('explicit'),b=await collect('coordinated');
 assert.deepEqual(a.d.selected,b.d.selected);
 assert.deepEqual(a.calls.slice(1).map(x=>x.q),b.calls.slice(1).map(x=>x.q));
});

test('outgoing intent view removes only synthetic look preference without mutating the plan',()=>{
 const p=intent();const before=structuredClone(p);const view=modelPlanView(p);
 assert.ok(view&&!('preferred' in view));assert.deepEqual(p,before);assert.equal(p.preferred,'look');
 assert.deepEqual(view,{goal:p.goal,intent:p.intent,proposals:p.proposals,steps:p.steps,placeUpdates:undefined});
 for(const actual of [{...p,modelSelected:true},{...p,look:{yaw:0,pitch:0}},{goal:'look',preferred:'look'}] as Plan[])
  assert.equal(modelPlanView(actual)?.preferred,'look');
});

test('coordinated API input carries lifecycle evidence and removes synthetic preference',async()=>{
 const captured:any[]=[];
 const planningState={planVersion:3,appliedAt:10,ageMs:20,medium:{pending:true,queuedReasons:['new observation']}};
 const selectionFeedbackStatus={history:[],total:0,omittedHistoryCount:0};
 const b=new ApiBrain({...config(),mode:'jev',targetPolicy:'observed',argumentContract:'coordinated',jevKey:'test',llmKey:'test'},new Budget(10,1),(async(_url:any,init:any)=>{
  const body=JSON.parse(init.body);captured.push(body);
  return Response.json({answers:await answers('look','none','value_0')(body.questions,decodeJevState(body.state)),usage:{input_tokens:1,output_tokens:0}});
 }) as typeof fetch);
 await b.supervise(fixture(),{...input,plan:intent(),planningState,selectionFeedbackStatus},new AbortController().signal);
 const state=decodeJevState(captured[0].state);
 assert.deepEqual(state.planningState,planningState);assert.equal(state.selectionFeedbackStatus.total,0);assert.deepEqual(state.selectionFeedbackStatus.entries,[]);
 assert.ok(!('preferred' in state.plan));assert.ok(!('reconsider' in captured[0].questions.action.criteria));
});

test('dialogue LLM receives an intention without synthetic action preference only in coordinated mode',async()=>{
 for(const argumentContract of ['explicit','coordinated'] as const){
  let supplied:any;
  const b=new ApiBrain({...config(),mode:'jev',targetPolicy:'observed',argumentContract,jevKey:'test',llmKey:'test'},new Budget(10,1),(async(_url:any,init:any)=>{
   const body=JSON.parse(init.body);supplied=JSON.parse(body.messages[1].content);
   return Response.json({choices:[{message:{content:'{"speech":null}'}}],usage:{input_tokens:1,output_tokens:1}});
  }) as typeof fetch);
  await b.communicate(fixture(),intent(),new AbortController().signal);
  assert.equal(supplied.plan.preferred,argumentContract==='coordinated'?undefined:'look');
 }
});

test('camera annotations use wrap-aware signed yaw and direct pitch differences',()=>{
 assert.equal(cameraArgumentEffect('yawDegrees',1,{yaw:359,pitch:0})?.deltaDegrees,2);
 assert.equal(cameraArgumentEffect('yawDegrees',359,{yaw:1,pitch:0})?.deltaDegrees,-2);
 assert.equal(cameraArgumentEffect('pitchDegrees',-30,{yaw:0,pitch:10})?.deltaDegrees,-40);
 assert.deepEqual(cameraArgumentEffect('yawDegrees',273,{yaw:272.9999999999942,pitch:0}),{fromDegrees:272.9999999999942,toDegrees:273,deltaDegrees:0,maintainsAxis:true});
 assert.equal(cameraArgumentEffect('count',3,{yaw:0,pitch:0}),undefined);
});

test('coordinated camera choice exposes same-direction consequence without excluding it or any angle',async()=>{
 const s=fixture();s.vision={yaw:273*Math.PI/180,pitch:0,blocks:[]};const calls:any[]=[];
 const d=await parameterSupervise(s,input,async(q,c)=>{
  calls.push({q,c});
  if(!c.argumentName)return answers('look')(q,c);
  const name=Object.keys(q)[0],criteria=q[name].criteria;
  const choice=name==='yawDegrees'?(Object.hasOwn(criteria,'group_6')?'group_6':'value_273'):'value_90';
  return {[name]:{type:'choice',choice,confidence:.01}};
 },'coordinated');
 assert.deepEqual(d.selected?.plan.look,{yaw:273*Math.PI/180,pitch:0});
 const group=calls.find(x=>x.q.yawDegrees?.criteria.group_6);
 assert.deepEqual(Object.entries(group.q.yawDegrees.criteria).filter(([k])=>k.startsWith('group_')).flatMap(([,v]:any)=>v.values),Array.from({length:360},(_,i)=>i));
 const yaw=calls.find(x=>x.q.yawDegrees?.criteria.value_273);
 assert.match(yaw.q.yawDegrees.criteria.value_273,/yaw=273deg; delta=0deg; keeps this axis/);
 const pitch=calls.find(x=>x.q.pitchDegrees);
 assert.deepEqual(Object.entries(pitch.q.pitchDegrees.criteria).filter(([k])=>k.startsWith('value_')).map(([,v]:any)=>Number(/^pitch=(-?\d+)deg/.exec(v)![1])),Array.from({length:181},(_,i)=>i-90));
 assert.match(pitch.q.pitchDegrees.criteria.value_90,/delta=0deg; keeps this axis/);
 assert.ok(pitch.q.pitchDegrees.criteria.revise);
 assert.match(pitch.c.argumentSemantics.changeMeaning,/not a recommendation/);
});

test('craft is not offered when nothing is craftable, and returns when an output becomes craftable',async()=>{
 const menu=async(craftable:string[])=>{let m:string[]=[];const s=fixture();s.craftable=craftable;await parameterSupervise(s,input,async(q,c)=>{if(!c.argumentName)m=Object.keys(q.action.criteria);return answers('look','none','value_0')(q,c);},'coordinated');return m;};
 assert.ok(!(await menu([])).includes('craft'));assert.ok((await menu(['stick'])).includes('craft'));
});

test('a suppressed action is not offered unless it is the running execution',async()=>{
 const s=fixture();s.stuck={excludedTargets:[],suppressedActions:[{action:'place_block',until:9e15,reason:'r',secondsLeft:90}],meaning:''} as any;
 let menu:string[]=[];
 await parameterSupervise(s,input,async(q,c)=>{if(!c.argumentName)menu=Object.keys(q.action.criteria);return answers('look','none','value_0')(q,c);},'coordinated');
 assert.ok(!menu.includes('place_block'));assert.ok(menu.includes('mine'));
});
