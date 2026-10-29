import test from 'node:test';import assert from 'node:assert/strict';
import {planningGrounding} from '../src/planning-grounding.js';import {MockWorld} from '../src/mock.js';
import {bindWorkIntent} from '../src/task-review.js';import {selectorContext} from '../src/selector-context.js';import {referenceRequest,decodeReferenceRequest} from '../src/jev-references.js';
test('historical fresh wording never supplies current visibility; observation must match type and cell',()=>{
 const s=new MockWorld().snapshot();s.importantPlaces=[{id:'tree',position:{x:1,y:64,z:1},registeredBlock:'oak_log',lastSeen:123,reason:'Freshly observed oak log',status:'historical'}] as any;s.vision!.blocks=[];
 assert.equal(planningGrounding(s).landmarkVisibility[0].presentInCurrentPanorama,false);
 s.vision!.blocks=[{name:'oak_leaves',position:{x:1,y:64,z:1},lastSeen:200}];assert.equal(planningGrounding(s).landmarkVisibility[0].presentInCurrentPanorama,false);
 s.vision!.blocks[0].name='oak_log';assert.equal(planningGrounding(s).landmarkVisibility[0].presentInCurrentPanorama,true);
});
test('new task and exact completion criteria survive production selector context and wire encoding',()=>{
 const old=bindWorkIntent({description:'Get wood',constraints:['done: eight logs carried'],desiredInventory:[{item:'oak_log',count:8}]});
 const next=bindWorkIntent({description:'Get wool',constraints:['next: gather wool','done: six wool carried'],desiredInventory:[{item:'white_wool',count:6}]},old,{status:'deferred'} as any);
 const s=new MockWorld().snapshot(),input:any={options:[],execution:null,inbox:[],goal:'shelter',parameterSelection:true,plan:{goal:'wool',preferred:'mine',intent:next}};
 const c=selectorContext(s,input,{}),r=referenceRequest(c,{action:{criteria:{mine:'Mine'}}}),decoded=decodeReferenceRequest(r.state,r.questions);
 assert.deepEqual(decoded.context.plan.intent,next);assert.ok(!JSON.stringify(decoded.context.plan).includes('eight logs'));
});
test('large block options expose names and coordinates while preserving all metadata',()=>{
 const values=Array.from({length:40},(_,i)=>({name:i===27?'oak_log':'oak_leaves',position:{x:i,y:64,z:3},lastSeen:1000+i}));
 const q={block:{criteria:Object.fromEntries(values.map((value,i)=>['value_'+i,{description:'Use this block for mine.',value}]))}};
 const r=referenceRequest({blocks:values},q);assert.equal(r.questions.block.criteria.value_27,'oak_log at (27,64,3)');
 assert.deepEqual(decodeReferenceRequest(r.state,r.questions),{context:{blocks:values},questions:q});
});

test('compressed archived panorama omission is unknown, never evidence of invisibility',()=>{
 const s=new MockWorld().snapshot();s.perception={} as any;s.vision!.blocks=[];s.spatial={near:{currentObservation:[],omitted:500}} as any;
 s.importantPlaces=[{id:'tree',position:{x:1,y:64,z:1},registeredBlock:'oak_log',lastSeen:123}] as any;
 assert.equal(planningGrounding(s).landmarkVisibility[0].presentInCurrentPanorama,null);
 assert.equal(planningGrounding(s,true).landmarkVisibility[0].presentInCurrentPanorama,false);
});
