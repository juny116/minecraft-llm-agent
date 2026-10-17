import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeGoalUpdates,validateGoalUpdates} from '../src/goals.js';
import {RetryPolicy} from '../src/retry-policy.js';
import {MockWorld} from '../src/mock.js';
test('optional null pause reason normalizes without accepting a paused goal missing reason',()=>{
 const g={id:'a',description:'Explore',reason:'Current evidence',evidenceIds:['obs'],status:'active',successCriteria:'Learn about surroundings',pauseReason:null};
 validateGoalUpdates(normalizeGoalUpdates([g]));assert.equal(g.pauseReason,null);
 assert.throws(()=>validateGoalUpdates(normalizeGoalUpdates([{...g,status:'paused'}])));
});
test('missing ingredient retry guard ignores view and unrelated inventory changes',()=>{
 const r=new RetryPolicy(),s=new MockWorld().snapshot();s.inventory=[{name:'cobblestone',count:2,slot:9}];
 const p={goal:'Craft',preferred:'craft' as const,craft:{item:'stone_pickaxe',count:1}},why='Missing ingredients for stone_pickaxe: cobblestone x1; table visible';
 r.record('craft',p,s,true,why);r.record('craft',p,s,true,why);
 s.craftable=['stick'];s.vision={yaw:0,pitch:0,blocks:[]};s.inventory.push({name:'dirt',count:3,slot:10});assert.equal(r.blocked('craft',p,s),true);
 s.inventory[0].count=3;assert.equal(r.blocked('craft',p,s),false);
});

test('failed pickup route is not unblocked by camera visibility, gear or unrelated inventory',()=>{
 const r=new RetryPolicy(),s=new MockWorld().snapshot();s.position={x:4.5,y:64,z:4.4};
 const p={goal:'Collect',preferred:'pickup' as const,pickup:{entityId:1,expected:'cobblestone'}},why=JSON.stringify({detail:'Destination not reached: no observed route after local scan'});
 r.record('pickup',p,s,true,why);r.record('pickup',p,s,true,why);s.visibleItems=[];s.equipment=[{slot:'hand',name:'bread'}];s.inventory=[{name:'dirt',count:5,slot:9}];s.position.z+=.1;
 assert.equal(r.blocked('pickup',p,s),true);s.position.x+=2;assert.equal(r.blocked('pickup',p,s),false);
});

test('display truncation cannot change classification of a long structured failure',()=>{
 const r=new RetryPolicy(),s=new MockWorld().snapshot(),p={goal:'Collect',preferred:'pickup' as const,pickup:{entityId:1,expected:'cobblestone'}};
 const why=JSON.stringify({kind:'pickup',attribution:'Observed outcome only. '.repeat(20),detail:'Destination not reached: no observed route after local scan'});
 r.record('pickup',p,s,true,why);r.record('pickup',p,s,true,why);assert.equal(r.blocked('pickup',p,s),true);assert.ok(r.context()[0].reason.length<=240);
 s.visibleItems=[];s.equipment=[{slot:'hand',name:'bread'}];assert.equal(r.blocked('pickup',p,s),true);
});

test('changing tool or maxMs does not bypass a blocked line of sight for the same block',()=>{
 const r=new RetryPolicy(),s=new MockWorld().snapshot(),p={goal:'Mine',preferred:'mine' as const,mine:{position:{x:2,y:64,z:0},expected:'stone',tool:'stone_pickaxe',maxMs:30000}};
 const why=JSON.stringify({kind:'mining',attribution:'Evidence only. '.repeat(30),detail:'Block not in view'});
 r.record('mine',p,s,true,why);r.record('mine',p,s,true,why);
 assert.equal(r.blocked('mine',{...p,mine:{position:p.mine.position,expected:'stone'}},s),true);
 assert.equal(r.blocked('mine',{...p,mine:{...p.mine,maxMs:120000,tool:'wooden_pickaxe'}},s),true);
 s.position.x+=2;assert.equal(r.blocked('mine',p,s),false);
});
