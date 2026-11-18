import test from 'node:test';
import assert from 'node:assert/strict';
import {RetryPolicy} from '../src/retry-policy.js';
import {MockWorld} from '../src/mock.js';
import {selectorPlan} from '../src/providers.js';
import type {Plan} from '../src/types.js';
const p:Plan={goal:'resources',preferred:'mine',mine:{position:{x:1,y:64,z:0},expected:'oak_log'}};
test('replanning and rotating do not unlock two unchanged failed interactions; repositioning does',()=>{
 const r=new RetryPolicy(),s=new MockWorld().snapshot();r.record('mine',p,s,true,'occluded');assert.equal(r.blocked('mine',p,s),false);r.record('mine',p,s,true,'occluded');
 const revised={...p,goal:'new wording',activeStepId:'new-step'};s.vision!.yaw=2;s.vision!.blocks=[];
 assert.equal(r.blocked('mine',revised,s),true);assert.equal(r.blocked('look',revised,s),false);
 s.position.x+=1;assert.equal(r.blocked('mine',revised,s),false);assert.equal(r.context()[0].attempts,2);
});
test('different target, changed inventory and successful execution allow retry',()=>{
 const r=new RetryPolicy(),s=new MockWorld().snapshot();r.record('mine',p,s,true,'failed');r.record('mine',p,s,true,'failed');
 assert.equal(r.blocked('mine',{...p,mine:{...p.mine!,position:{x:2,y:64,z:0}}},s),false);
 s.inventory=[{name:'wooden_pickaxe',count:1,slot:9}];assert.equal(r.blocked('mine',p,s),false);
 r.record('mine',p,s,false,'broken');assert.equal(r.context().length,0);
 assert.equal(selectorPlan(p).preferred,'mine');
});

test('runtime excludes an unchanged failed target after a fresh plan, without blocking other actions',async()=>{
 const {Runtime}=await import('../src/runtime.js');const w=new MockWorld();let offered:string[]=[];
 w.execute=async()=>{throw Error('Block is occluded');};
 const r=new Runtime(w,{plan:async()=>({...p}),choose:async(_s,_p,options)=>{offered=options;return {action:'idle',confidence:.1};}},{planMs:60000,actionMs:1000,minConfidence:.5},()=>{}) as any;
 r.lastReady=true;r.plan={...p};
 await r.run({action:'mine',confidence:.8},['mine'],'selector');await r.run({action:'mine',confidence:.8},['mine'],'selector');
 await r.refreshPlan();await r.tick();
 assert.ok(!offered.includes('mine'));assert.ok(offered.includes('look'));assert.ok(offered.includes('idle'));assert.equal(r.planning.blockedInteractions.length,1);r.close();
});

test('turning away from a planned target requests fresh planning rather than indefinite look/idle',async()=>{
 const {Runtime}=await import('../src/runtime.js');const w=new MockWorld();let reasons:string[]=[];
 w.state.vision!.blocks=[];
 const r=new Runtime(w,{plan:async(_s,_h,_sig,_goal,c)=>{reasons=c!.replanReasons;return {goal:'inspect current surroundings',preferred:'look'};},choose:async()=>({action:'idle',confidence:1})},{planMs:60000,actionMs:1000,minConfidence:0},()=>{}) as any;
 r.lastReady=true;r.plan={...p};r.reasons.clear();r.lastPlan=Date.now();await r.tick();
 assert.ok(reasons.includes('planned_action_no_longer_available_in_current_observation'));r.close();
});

test('a remembered mining target permits an approach attempt without a mandatory move first',async()=>{
 const {Runtime}=await import('../src/runtime.js');const w=new MockWorld();w.state.vision!.blocks=[];w.state.places=[{name:'oak_log',position:p.mine!.position,lastSeen:1}];
 const r=new Runtime(w,{plan:async()=>({...p}),choose:async()=>({action:'idle',confidence:1})},{planMs:60000,actionMs:1000,minConfidence:0},()=>{});
 await r.refreshPlan();assert.equal(r.plan.preferred,'mine');assert.equal(r.planning.plannerFeedback,undefined);assert.ok(!r.planning.replanReasons.includes('planner_error'));r.close();
});

test('increasing a failed craft quantity does not evade retry protection; fewer crafts and changed feasibility can',()=>{
 const r=new RetryPolicy(),s=new MockWorld().snapshot(),plan:Plan={goal:'craft',preferred:'craft',craft:{item:'stick',count:2}};
 r.record('craft',plan,s,true,'Insufficient ingredients');r.record('craft',plan,s,true,'Insufficient ingredients');
 assert.equal(r.blocked('craft',{...plan,craft:{item:'stick',count:3}},s),true);
 assert.equal(r.blocked('craft',{...plan,craft:{item:'stick',count:1}},s),false);
 s.craftable=['stick'];assert.equal(r.blocked('craft',plan,s),false);
});

test('blocked preferred action does not starve JEV of legal observation choices during replan backoff',async()=>{
 const {Runtime}=await import('../src/runtime.js');const w=new MockWorld();w.state.vision!.blocks=[];let chosen=0;
 const r=new Runtime(w,{plan:async()=>({...p}),choose:async(_s,_p,options)=>{assert.ok(!options.includes('mine'));assert.ok(options.includes('look'));chosen++;return {action:'look',confidence:.1};}},{planMs:60000,actionMs:1000,minConfidence:.5},()=>{}) as any;
 r.lastReady=true;await r.refreshPlan();await r.tick();assert.equal(chosen,1);assert.equal(r.planning.recentActions.at(-1).decision.action,'look');r.close();
});

test('craft retries ignore unrelated dropped entities and slot reorder but allow table observation',()=>{
 const r=new RetryPolicy(),s=new MockWorld().snapshot(),plan:Plan={goal:'tools',preferred:'craft',craft:{item:'wooden_axe',count:1}};
 r.record('craft',plan,s,true,'Missing table');r.record('craft',plan,s,true,'Missing table');s.position.x+=.6;s.visibleItems=[{id:99,name:'stick',count:1,position:{x:10,y:64,z:10}}];
 assert.equal(r.blocked('craft',plan,s),true);s.vision!.blocks.push({name:'crafting_table',position:{x:1,y:64,z:0},lastSeen:1});assert.equal(r.blocked('craft',plan,s),false);
});

test('unrelated hand items cannot reset a visibility failure',()=>{
 const r=new RetryPolicy(),s=new MockWorld().snapshot();r.record('mine',p,s,true,'Block not in view');s.equipment=[{slot:'hand',name:'stick'}];r.record('mine',p,s,true,'Block not in view');s.equipment=[{slot:'hand',name:'bread'}];assert.equal(r.blocked('mine',p,s),true);s.position.x+=1;assert.equal(r.blocked('mine',p,s),false);
});

test('missing table retries depend on a visible table, not wood gains or smaller quantity',()=>{
 const r=new RetryPolicy(),s=new MockWorld().snapshot(),p:Plan={goal:'tools',preferred:'craft',craft:{item:'wooden_axe',count:2}};
 s.vision!.blocks=[];r.record('craft',p,s,true,'Missing visible crafting table for wooden_axe');r.record('craft',p,s,true,'Missing visible crafting table for wooden_axe');
 s.inventory=[{name:'oak_planks',count:20,slot:9}];s.craftable=['stick'];s.position.x+=5;
 assert.equal(r.blocked('craft',p,s),true);assert.equal(r.blocked('craft',{...p,craft:{item:'wooden_axe',count:1}},s),true);
 s.vision!.blocks.push({name:'crafting_table',position:{x:1,y:64,z:0},lastSeen:1});assert.equal(r.blocked('craft',p,s),false);
});
