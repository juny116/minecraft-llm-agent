import test from 'node:test';import assert from 'node:assert/strict';
import {ProgressTracker} from '../src/progress.js';import {MockWorld} from '../src/mock.js';import {executionIdentity,executionOptions} from '../src/supervision.js';
test('progress is independent per bot and repeated view/chat is not progress',()=>{
 const a=new ProgressTracker(),b=new ProgressTracker(),w=new MockWorld(),s=w.snapshot();a.observe(s,0);b.observe(s,0);s.messages.push('hello');
 assert.equal(a.observe(s,31000).noProgressMs,31000);assert.equal(a.review(31000),'medium');assert.equal(a.review(32000),null);
 const moved={...s,position:{...s.position,x:s.position.x+3}};b.observe(moved,40000);assert.equal(b.context(40000).noProgressMs,0);assert.equal(a.review(91000),'long');
 a.observe({...s,inventory:[{name:'oak_log',count:1,slot:36}]},92000);assert.equal(a.context(92000).noProgressMs,0);
});
test('execution identity ignores unrelated parameters and plan prose',()=>{
 const p:any={goal:'old',preferred:'mine',mine:{position:{x:1,y:64,z:0},expected:'oak_log'},craft:{item:'stick',count:1}};
 assert.equal(executionIdentity('mine',p),executionIdentity('mine',{...p,goal:'new',craft:undefined}));
 assert.notEqual(executionIdentity('mine',p),executionIdentity('mine',{...p,mine:{...p.mine,tool:'wooden_axe'}}));
});
test('holding a table alone does not offer unsolicited table placement',()=>{
 const s=new MockWorld().snapshot();s.canPlaceTable=true;
 assert.ok(!executionOptions(s,{goal:'Observe',preferred:'look'}).some(o=>o.action==='place_table'));
 assert.ok(executionOptions(s,{goal:'Use a table here',preferred:'place_table'}).some(o=>o.action==='place_table'));
});

test('same mine target with reordered coordinates and implicit default budget is not a new execution',()=>{
 const a:any={goal:'A',preferred:'mine',mine:{position:{x:1,y:2,z:3},expected:'stone'}};
 const b:any={goal:'B',preferred:'mine',mine:{maxMs:30000,expected:'stone',position:{z:3,x:1,y:2}}};
 assert.equal(executionIdentity('mine',a),executionIdentity('mine',b));
});

test('resource spending candidates follow plans rather than enumerating unrelated feasible recipes',()=>{
 const s=new MockWorld().snapshot();s.craftable=['birch_button','crafting_table'];s.inventory=[];
 const p:any={goal:'Wood',preferred:'mine',mine:{position:{x:1,y:64,z:0},expected:'oak_log'}};
 const options=executionOptions(s,p);assert.ok(!options.some(o=>o.action==='craft'));assert.ok(options.filter(o=>o.action==='mine').every(o=>o.plan.mine?.expected==='oak_log'));
 assert.ok(executionOptions(s,{goal:'Table needed',preferred:'craft',craft:{item:'crafting_table',count:1}}).some(o=>o.action==='craft'));
});

test('backtracking through the same visited cells does not hide prolonged lack of progress',()=>{
 const tracker=new ProgressTracker(),s=new MockWorld().snapshot();tracker.observe(s,0);
 tracker.observe({...s,position:{...s.position,x:s.position.x+4}},1000);
 for(let i=2;i<=40;i++)tracker.observe({...s,position:{...s.position,x:s.position.x+(i%2?4:0)}},i*1000);
 assert.equal(tracker.context(40000).noProgressMs,39000);assert.equal(tracker.review(40000),'medium');
 tracker.observe({...s,position:{...s.position,x:s.position.x+8}},41000);assert.equal(tracker.context(41000).noProgressMs,0);
 tracker.reset();tracker.observe(s,42000);assert.equal(tracker.context(42000).noProgressMs,0);
});
