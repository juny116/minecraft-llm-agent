import test from 'node:test';import assert from 'node:assert/strict';
import {parseThreatResponse,threatView,uncovered} from '../src/threat-response.js';
import {parsePlan} from '../src/providers.js';
import {selectorContext} from '../src/selector-context.js';
import {MockWorld} from '../src/mock.js';

const policy={rules:[{enemies:['zombie'],response:'fight',when:'health above 8 with a sword',note:'zombies keep following, flight rarely ends a chase'},{enemies:['creeper'],response:'avoid'},{enemies:['skeleton','spider'],response:'retreat',when:'at night'}],retreatTo:{x:166,y:94,z:187,label:'bed'},basis:'iron armor and sword'};

test('the task layer policy is validated and carried by an intent plan',()=>{
 const p=parsePlan({goal:'Gather wood',intent:{description:'Collect logs',desiredInventory:[],constraints:['next: mine a log']},threatResponse:policy});
 assert.equal(p.threatResponse!.rules[0].response,'fight');assert.deepEqual(p.threatResponse!.retreatTo,{x:166,y:94,z:187,label:'bed'});
 assert.throws(()=>parseThreatResponse({rules:[{enemies:['zombie'],response:'run'}]}),/response must be one of/);
 assert.throws(()=>parseThreatResponse({rules:[]}),/1-8/);
});
test('JEV sees only rules for visible hostiles, without notes or basis; nothing when no hostile is visible',()=>{
 const t=parseThreatResponse(policy);
 assert.equal(threatView(t,[]),undefined);
 const v:any=threatView(t,['zombie']);
 assert.deepEqual(v.rules,[{enemies:['zombie'],response:'fight',when:'health above 8 with a sword'}]);assert.equal(JSON.stringify(v).includes('flight rarely'),false);assert.equal(JSON.stringify(v).includes('iron armor'),false);
 assert.deepEqual(uncovered(t,['zombie','enderman']),['enderman']);assert.deepEqual(uncovered(undefined,['zombie']),['zombie']);
 const s=new MockWorld().snapshot();s.enemies=[{id:1,kind:'zombie',position:{x:3,y:64,z:0},distance:3}];
 const c:any=selectorContext(s,{plan:{goal:'g',preferred:'look',intent:{description:'d',desiredInventory:[],constraints:[]},threatResponse:t}} as any,{});
 assert.equal(c.threatPlan.rules[0].response,'fight');assert.equal(c.plan.threatResponse,undefined);
});

test('a near hostile without a prepared rule asks the task layer once per uncovered set; a covering rule asks nothing',async()=>{
 const {Runtime}=await import('../src/runtime.js');const {MockBrain}=await import('../src/providers.js');
 for(const prepared of [false,true]){
  const w=new MockWorld(),events:string[]=[];w.state.enemies=[{id:1,kind:'zombie',position:{x:5,y:64,z:0},distance:5}];
  const r=new Runtime(w,{plan:()=>new Promise(()=>{}),choose:new MockBrain().choose,supervise:async()=>({choice:'continue',confidence:1,review:'none',routes:{}})} as any,{planMs:30000,actionMs:5000,minConfidence:0,selectorMs:1000},(e)=>events.push(e));const x=r as any;x.lastReady=true;x.lastLifeKey='true';
  if(prepared)r.plan={...r.plan,threatResponse:parseThreatResponse(policy)};
  await r.tick();await r.tick();r.close();
  assert.equal(events.filter(e=>e==='threat_plan_requested').length,prepared?0:1);
 }
});

test('policy basis ignores unchanged state and reports what changed',async()=>{
 const {threatBasis,basisChanges}=await import('../src/threat-response.js');
 const s=new MockWorld().snapshot();s.equipment=[{slot:'chest',name:'iron_chestplate'}];s.inventory=[{name:'iron_sword',count:1,slot:36} as any];s.health=20;s.time={phase:'day'} as any;
 const a=threatBasis(s,[{id:'g',version:1}]);
 assert.deepEqual(basisChanges(a,threatBasis({...s,health:18},[{id:'g',version:1}])),[]);
 assert.deepEqual(basisChanges(a,threatBasis({...s,time:{phase:'night'} as any},[{id:'g',version:2}])),['phase','guidance']);
 assert.deepEqual(basisChanges(undefined,a),['no policy yet']);
});
test('combat facts use the best carried weapon and worn armor; full iron takes 1.38 per zombie hit',async()=>{
 const {snapshotCombatFacts,combatFacts}=await import('../src/combat-facts.js');
 const s=new MockWorld().snapshot();s.health=20;s.enemies=[{id:1,kind:'zombie',position:{x:5,y:64,z:0},distance:5}];
 s.equipment=['head:iron_helmet','chest:iron_chestplate','legs:iron_leggings','feet:iron_boots','hand:wooden_axe'].map(x=>({slot:x.split(':')[0],name:x.split(':')[1]}));
 s.inventory=[{name:'iron_sword',count:1,slot:37} as any];
 const f:any=snapshotCombatFacts(s);
 assert.equal(f.weapon,'iron_sword');assert.equal(f.armorPoints,15);
 assert.deepEqual(f.enemies[0],{kind:'zombie',yourHitsToKill:4,secondsToKillAtFullSwing:2.5,healthLostPerHitTaken:1.38,hitsYouCanTakeNow:14});
 assert.equal(snapshotCombatFacts({...s,enemies:[]}),undefined);
 assert.equal((snapshotCombatFacts({...s,enemies:[]},true) as any).enemies.length,4);
 assert.equal((combatFacts(['zombie'],undefined,[],20) as any).enemies[0].yourHitsToKill,20);
});

test('a fight rule for a near visible hostile is attached to attack and flee; far or non-fight hostiles add nothing',async()=>{
 const {fightRuleCriteria}=await import('../src/threat-response.js');
 const t=parseThreatResponse(policy);const facts={enemies:[{kind:'zombie',yourHitsToKill:4,secondsToKillAtFullSwing:2.5,hitsYouCanTakeNow:14}]};
 const c=fightRuleCriteria(t,[{id:9,kind:'zombie',distance:3.3},{id:4,kind:'creeper',distance:2}],facts)!;
 assert.match(c.attack,/FIGHT for zombie #9 at 3.3 blocks \(when: health above 8 with a sword\)\. combatFacts for zombie: you kill it in 4 hits \(~2.5 s\) and can take 14/);
 assert.match(c.flee,/fight, not flight, for zombie/);
 assert.equal(fightRuleCriteria(t,[{id:9,kind:'zombie',distance:20}],facts),undefined);
 assert.equal(fightRuleCriteria(t,[{id:4,kind:'creeper',distance:2}],facts),undefined);
 assert.equal(fightRuleCriteria(undefined,[{id:9,kind:'zombie',distance:3}],facts),undefined);
});

test('readiness lists time, tools by type and material, armor, food, beds',async()=>{
 const {readinessFacts}=await import('../src/readiness.js');
 const s=new MockWorld().snapshot();s.time={phase:'day',minutesUntilNight:3} as any;
 s.inventory=[{name:'wooden_pickaxe',count:1,slot:36},{name:'stone_sword',count:1,slot:37},{name:'bread',count:4,slot:38},{name:'white_bed',count:1,slot:39},{name:'oak_planks',count:12,slot:40}] as any;
 s.edibleItems=['bread'];s.placeableItems=['oak_planks','white_bed'];s.equipment=[{slot:'head',name:'iron_helmet'}];
 const r:any=readinessFacts(s);
 assert.deepEqual(r.weaponsAndTools,{pickaxe:['wooden'],sword:['stone']});assert.equal(r.foodItems,4);assert.equal(r.bedsCarried,1);assert.equal(r.placeableBlocks,12);assert.deepEqual(r.armorWorn,['iron_helmet']);assert.equal(r.time.minutesUntilNight,3);
});

test('during a prepared fight, continue and stop carry the rule and facts; other targets add nothing',async()=>{
 const {runningFightCriteria}=await import('../src/threat-response.js');
 const t=parseThreatResponse(policy),facts={enemies:[{kind:'zombie',yourHitsToKill:5,hitsYouCanTakeNow:4}]};
 const c=runningFightCriteria(t,{id:3,kind:'zombie',distance:1},facts)!;
 assert.match(c.continue,/FIGHT for this zombie .*kill it in 5 hits and can take 4/);assert.match(c.stop,/forfeits landed hits/);
 assert.equal(runningFightCriteria(t,{id:4,kind:'creeper',distance:1},facts),undefined);assert.equal(runningFightCriteria(t,undefined,facts),undefined);
});
