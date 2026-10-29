import test from 'node:test';import assert from 'node:assert/strict';
import {StuckGuard,WITHDRAW_REPEATS} from '../src/stuck-guard.js';
import {actionDomains} from '../src/action-domains.js';
import {MockWorld} from '../src/mock.js';

test('three non-progress attempts at one cell exclude it for a while; success clears the count',()=>{
 const g=new StuckGuard(),p={x:-461.2,y:71,z:233.7};
 g.recordResult('mine',p,'cancelled',0);g.recordResult('mine',p,'succeeded',1);g.recordResult('mine',p,'failed',2);g.recordResult('mine',p,'cancelled',3);
 assert.equal(g.excludedTargets(4).length,0,'success reset the count');
 g.recordResult('mine',p,'failed',5);
 assert.deepEqual(g.excludedTargets(6).map(t=>[t.action,t.position]),[['mine',{x:-462,y:71,z:233}]]);
 assert.equal(g.excludedTargets(6+300001).length,0,'exclusion expires');
});
test('the same action withdrawn repeatedly from the same candidates is suppressed; a changed offer restarts the count',()=>{
 const g=new StuckGuard();
 for(let i=0;i<WITHDRAW_REPEATS-1;i++)g.recordWithdrawal('place_block',[{site:1}],i);
 g.recordWithdrawal('place_block',[{site:2}],10);
 for(let i=0;i<WITHDRAW_REPEATS-2;i++)g.recordWithdrawal('place_block',[{site:2}],11+i);
 assert.equal(g.suppressedActions(30).length,0);
 g.recordWithdrawal('place_block',[{site:2}],31);
 assert.deepEqual(g.suppressedActions(32).map(a=>a.action),['place_block']);assert.match(g.view(32)!.meaning,/Temporarily removed/);
});
test('excluded cells disappear from the mine domain offered to JEV',()=>{
 const s=new MockWorld().snapshot();s.position={x:0.5,y:64,z:0.5};s.vision={yaw:0,pitch:0,blocks:[{name:'oak_log',position:{x:2,y:64,z:0}},{name:'oak_log',position:{x:3,y:64,z:0}}]} as any;
 const before=actionDomains(s).mine.values.map((b:any)=>b.position.x);
 s.stuck={excludedTargets:[{action:'mine',position:{x:2,y:64,z:0},until:9e15,reason:'r',secondsLeft:1}],suppressedActions:[],meaning:''} as any;
 const after=actionDomains(s).mine.values.map((b:any)=>b.position.x);
 assert.ok(before.includes(2));assert.ok(!after.includes(2));assert.ok(after.includes(3));
});

test('own placed blocks leave the default per-type mine pick but stay in the exact list; empty domains are reported',async()=>{
 const {mineTargets}=await import('../src/move-targets.js');const {emptyActions}=await import('../src/action-domains.js');
 const s=new MockWorld().snapshot();s.position={x:0.5,y:64,z:0.5};
 const wall={name:'cobblestone',position:{x:1,y:64,z:0}},far={name:'cobblestone',position:{x:4,y:64,z:0}};
 s.ownPlacedBlocks=[wall];
 const t=mineTargets(s,[wall,far]);
 assert.deepEqual(t.filter(x=>x.kind==='block_type').map(x=>x.block!.position),[far.position]);assert.match(t.at(-1)!.meaning!,/placed yourself/);
 const e=new MockWorld().snapshot();e.visibleItems=[];e.enemies=[];e.animals=[];e.nearbyPlayers=[];e.edibleItems=[];
 const empty=emptyActions(e);for(const a of ['pickup','sleep','attack','flee','eat','follow','give'])assert.ok(empty.includes(a),a);
});
test('a goal without progress for five minutes forces a review that rejects keeping it',async()=>{
 const {Runtime}=await import('../src/runtime.js');const {GoalBook}=await import('../src/goals.js');const {MockBrain}=await import('../src/providers.js');
 const goals=new GoalBook(),review=goals.review(new MockWorld().snapshot(),null);goals.apply(review,[{id:'wall',description:'Close the wall',reason:'r',evidenceIds:[review.observationId],status:'active',successCriteria:'closed'}],'wall');
 const events:string[]=[];const w=new MockWorld();
 const r=new Runtime(w,{plan:()=>new Promise(()=>{}),choose:new MockBrain().choose} as any,{planMs:30000,actionMs:5000,minConfidence:0,goals},(e)=>events.push(e));
 const x=r as any;x.lastProgressAt=0;x.checkGoalStall(1000);x.checkGoalStall(1000+5*60000+1);
 assert.ok(events.includes('goal_stalled'));assert.equal(goals.reviewState.trigger,'stalled');assert.equal(x.stalledGoalId,'wall');r.close();
});
test('the block under the feet is not the default nearest pick but stays in the exact list',async()=>{
 const {mineTargets}=await import('../src/move-targets.js');
 const s=new MockWorld().snapshot();s.position={x:0.5,y:64,z:0.5};
 const floor={name:'stone',position:{x:0,y:63,z:0}},side={name:'stone',position:{x:2,y:64,z:0}};
 const t=mineTargets(s,[floor,side]);
 assert.deepEqual(t.filter(x=>x.kind==='block_type').map(x=>x.block!.position),[side.position]);assert.equal(t.at(-1)!.kind,'other_block');
});
test('equipment changes that would change nothing are not offered',async()=>{
 const {equipmentChoices}=await import('../src/equipment.js');
 const inv=[{slot:36,name:'wooden_axe'},{slot:37,name:'stone_pickaxe'},{slot:6,name:'iron_chestplate'}];
 const eq=[{slot:'hand',name:'wooden_axe'},{slot:'chest',name:'iron_chestplate'}];
 const c=equipmentChoices(inv,eq).map(x=>JSON.stringify(x));
 assert.ok(!c.includes(JSON.stringify([36,'wooden_axe','default'])),'held axe to hand');
 assert.ok(!c.includes(JSON.stringify([6,'iron_chestplate','default'])),'worn chestplate to torso');
 assert.ok(c.includes(JSON.stringify([37,'stone_pickaxe','default'])));assert.ok(!c.includes(JSON.stringify([-1,null,'head'])),'nothing to remove from head');
 assert.ok(c.includes(JSON.stringify([-1,null,'torso'])));
});
