import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parsePlan,ApiBrain,Budget} from '../src/providers.js';
import {config} from '../src/config.js';
import {MockWorld} from '../src/mock.js';
import {executionOptions} from '../src/supervision.js';
import {intentSatisfied} from '../src/work-intent.js';
import {ExperienceMemory,followupWindows,type Episode} from '../src/experience-memory.js';
import {compact,changes,type ActionRecord} from '../src/planning.js';
import {Runtime} from '../src/runtime.js';
const intent={description:'Obtain basic tool supplies',desiredInventory:[{item:'cobblestone',count:8}],constraints:['Use observed opportunities']};
const plan=()=>parsePlan({goal:'Basic supplies',intent});
test('intent parsing does not require exact targets and rejects legacy spatial commands',()=>{
 assert.equal(plan().preferred,'look');
 assert.throws(()=>parsePlan({goal:'x',intent,mine:{}}),/JEV chooses/);
 assert.throws(()=>parsePlan({goal:'x',intent,proposals:[{goal:'x',preferred:'move',destination:{x:1,y:2,z:3}}]}),/proposal/);
 assert.throws(()=>parsePlan({goal:'x',intent:{...intent,desiredInventory:[{item:'stone',count:-1}]}}),/Invalid/);
});
test('observed options cover multiple block types and routes without LLM coordinates; no hidden/support targets',()=>{
 const s=new MockWorld().snapshot();s.navigationTargets=[{x:8,y:64,z:0},{x:-8,y:64,z:0}];
 s.vision!.blocks.push({name:'stone',position:{x:4,y:64,z:0},lastSeen:0},{name:'dirt',position:{x:0,y:63,z:0},lastSeen:0});
 s.places=[{name:'diamond_ore',position:{x:20,y:50,z:0},lastSeen:0}];
 const o=executionOptions(s,plan());assert.ok(o.some(x=>x.plan.mine?.expected==='stone'));assert.ok(o.some(x=>x.plan.mine?.expected==='oak_log'));
 assert.equal(o.filter(x=>x.action==='move').length,2);
 assert.ok(!o.some(x=>['dirt','diamond_ore'].includes(x.plan.mine?.expected??'')));
 s.inventory=[{name:'cobblestone',count:8,slot:9}];assert.ok(intentSatisfied(plan().intent,s));assert.ok(!executionOptions(s,plan()).some(x=>['mine','move','craft'].includes(x.action)));
});
test('block diversity is retained despite many near blocks of one kind; no unavailable recipe injection',()=>{
 const s=new MockWorld().snapshot();s.vision!.blocks=Array.from({length:30},(_,i)=>({name:'oak_log',position:{x:i+1,y:64,z:0},lastSeen:0}));
 s.vision!.blocks.push({name:'stone',position:{x:40,y:64,z:0},lastSeen:0});s.craftable=['oak_planks'];s.inventory=[];
 const o=executionOptions(s,plan());assert.ok(o.some(x=>x.plan.mine?.expected==='stone'));assert.deepEqual(o.filter(x=>x.action==='craft').map(x=>x.plan.craft?.item),['oak_planks']);
});
function record(food=5,afterFood=food,action:ActionRecord['decision']['action']='mine',at=1):ActionRecord{
 const s=new MockWorld().snapshot();s.food=food;const before=compact(s);s.food=afterFood;const after=compact(s);
 return {id:at,source:'selector',selectorKind:'jev',decision:{action,confidence:.4},decisionObserved:before,options:['mine','eat'],planVersion:0,goal:null,stepId:null,before,after,changes:changes(before,after),outcome:'succeeded',result:'observed',startedAt:at,endedAt:at+1};
}
test('delayed meals are subsequent evidence, not pointwise failure; no cross-session attribution',()=>{
 const a:Episode={id:'a',session:'one',record:record(),guidanceUsed:[]};
 const b:Episode={id:'b',session:'one',record:record(3,8,'eat',30),guidanceUsed:[]};
 assert.equal(followupWindows([a])[0].status,'pending');
 const f=followupWindows([a,b])[0];assert.equal(f.laterMeal?.episodeId,'b');assert.equal(f.healthLossObserved,0);assert.equal(f.emptyGaugeObserved,false);
 assert.equal(followupWindows([a,{...b,session:'two'}])[0].laterMeal,null);
 const dead=structuredClone(a),respawn=structuredClone(b);dead.record.before.lifeGeneration=1;respawn.record.before.lifeGeneration=2;assert.equal(followupWindows([dead,respawn])[0].laterMeal,null);
});
test('situational guidance survives reconnect and is revised using later outcomes',t=>{
 const dir=mkdtempSync(join(tmpdir(),'intent-memory-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const m=new ExperienceMemory(dir,'test'),a=m.add(record());
 const draft={id:'meal_timing',status:'active' as const,text:'Consider work progress before a meal.',uncertainty:'Single observed decision; later result pending.',scope:{species:[],equipment:[],health:[0,20] as [number,number],food:[0,6] as [number,number],hasFood:true,action:'eat' as const},support:[a],counterexamples:[] as string[]};
 m.apply(m.reflection(),[draft]);
 const b=m.add(record(3,8,'eat',30)),review=m.reflection();assert.ok(review.episodes.some(e=>e.id===a));assert.equal(review.followupWindows?.find(w=>w.decisionId===a)?.laterMeal?.episodeId,b);
 m.apply(review,[{...draft,text:'A later meal was observed after continued work; timing remains contextual.',support:[a,b]}]);
 const n=new ExperienceMemory(dir,'test'),s=new MockWorld().snapshot();s.food=5;s.foodAvailable=true;
 assert.equal(n.retrieve(s,['mine'])[0].version,2);s.food=20;assert.equal(n.retrieve(s).length,0);s.food=5;s.foodAvailable=false;assert.equal(n.retrieve(s).length,0);
});
test('medium API emits an intent while supervisor sees guidance, gauge semantics and concrete options',async()=>{
 const s=new MockWorld().snapshot();let payloads:any[]=[];
 const api=new ApiBrain({...config(),targetPolicy:'observed',llmKey:'test',jevKey:'test',mode:'jev'},new Budget(2,1),async(_url,init)=>{
 const body=JSON.parse(init!.body as string);payloads.push(body);
 return body.messages?Response.json({choices:[{message:{content:JSON.stringify({goal:'Supplies',intent})}}],usage:{prompt_tokens:10,completion_tokens:10}}):Response.json({answers:{action:{type:'choice',choice:'option_0',confidence:.2},review:{type:'choice',choice:'none',confidence:1}},usage:{input_tokens:10,output_tokens:0}});
 });
 const p=await api.plan(s,[],new AbortController().signal,null,{longTermGoal:'Survive'} as any);
 assert.ok(p.intent);assert.ok(!p.mine);assert.ok(!p.destination);
 assert.ok(JSON.parse(payloads[0].messages[1].content).allowedProposals.includes('place_table'));
 assert.throws(()=>parsePlan({goal:'x',intent,proposals:[{goal:'table',preferred:'build'}]}),/build is a parameter/);
 s.memoryGuidance=[{id:'fixture',version:1,updatedAt:1,model:'mock',status:'active',text:'Tentative fixture advice',uncertainty:'Synthetic test only',scope:{species:[],equipment:[],health:[0,20],action:'mine'},support:['fixture_episode'],counterexamples:[]}];
 await api.supervise(s,{options:executionOptions(s,p),execution:null,inbox:[],goal:'Survive',plan:p},new AbortController().signal);
 assert.equal(payloads[1].state.observation.vitalsSemantics.food.max,20);
 assert.equal(payloads[1].state.observation.memoryGuidance[0].id,'fixture');
 assert.ok(Object.values(payloads[1].questions.action.criteria).filter((x):x is string=>typeof x==='string').every(x=>!x.includes('"recommended":true')));
});
test('runtime notices intention completion and asks for review without requiring exact execution plan equality',()=>{
 const w=new MockWorld();w.state.inventory=[{name:'cobblestone',count:8,slot:9}];
 const r:any=new Runtime(w,{plan:async()=>plan(),choose:async()=>({action:'idle',confidence:1})},{planMs:5000,actionMs:1000,minConfidence:0},()=>{});
 r.plan=plan();r.checkStep(w.snapshot());assert.ok(r.planning.replanReasons.includes('intent_inventory_satisfied_review_next_work'));r.close();
});

test('snapshot before login does not access unavailable inventory for food',async()=>{
 const {MineflayerWorld}=await import('../src/mineflayer.js');
 const w=Object.create(MineflayerWorld.prototype) as any;
 Object.assign(w,{ready:false,bot:{},observe:()=>{},knownPlaces:()=>[],navigationTargets:()=>[],containers:[],incomingDamage:{snapshot:()=>[]},combatEvidence:{snapshot:()=>[]},enemies:()=>[],encounters:[],visible:[],recovery:{context:()=>({deaths:[]})},chatEvents:[],messages:[],recipeBook:{snapshot:()=>({initialized:false,unlocked:[]})}});
 assert.equal(w.snapshot().foodAvailable,false);assert.equal(w.snapshot().canEat,false);
});
