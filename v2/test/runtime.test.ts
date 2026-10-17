import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Runtime } from '../src/runtime.js';
import { MockWorld } from '../src/mock.js';
import { MockBrain } from '../src/providers.js';
import type { Brain, Plan } from '../src/types.js';
const options = { planMs: 30000, actionMs: 1000, minConfidence: 0.55 };
const flush = () => delay(0);

test('late plan cannot overwrite state after invalidation', async () => {
  let finish!: (p: Plan) => void;
  const brain: Brain = { plan: () => new Promise(resolve => { finish = resolve; }), choose: new MockBrain().choose };
  const r = new Runtime(new MockWorld(), brain, options, () => {});
  const pending = r.refreshPlan(); r.invalidate('new player instruction');
  finish({ goal: 'stale', preferred: 'mine',mine:{position:{x:1,y:64,z:0},expected:'oak_log'} }); await pending;
  assert.notEqual(r.plan.goal, 'stale'); r.close();
});

test('changed action preconditions discard an in-flight decision', async () => {
  let finish!: (d: { action: 'mine'; confidence: number }) => void;
  const world = new MockWorld();
  const brain: Brain = { plan: async () => ({ goal: 'wood', preferred: 'mine',mine:{position:{x:1,y:64,z:0},expected:'oak_log'} }),
    choose: () => new Promise(resolve => { finish = resolve; }) };
  const events: string[] = [];
  const r = new Runtime(world, brain, options, e => events.push(e));
  const pending = r.tick(); await flush(); world.state.canMine = false;
  finish({ action: 'mine', confidence: 1 }); await pending;
  assert.equal(world.state.logs, 0); assert.ok(events.includes('decision_discarded')); r.close();
});

test('hungry bot preempts work and does not repeatedly interrupt eating', async () => {
  const world = new MockWorld(); const r = new Runtime(world, new MockBrain(), options, () => {});
  await r.tick();
  const work = r.tick(); await delay(10); world.state.food = 10;
  await r.tick(); await work;
  const eating = r.tick(); await delay(10); await r.tick(); await eating;
  assert.equal(world.state.food, 20); r.close();
});

test('two independent bots gather and deposit into a shared mock chest with zero API calls', async () => {
  const shared = { logs: 0 };
  const bots = [0, 1].map(() => new Runtime(new MockWorld(shared), new MockBrain(), options, () => {}));
  for (let i = 0; i < 9; i++) await Promise.all(bots.map(r => r.tick()));
  assert.ok(shared.logs >= 8); assert.notEqual(bots[0].history, bots[1].history);
  bots.forEach(r => r.close());
});

test('close prevents a pending planner from sending chat', async () => {
  let finish!: (p: Plan) => void; const world = new MockWorld();
  const brain: Brain = { plan: () => new Promise(resolve => { finish = resolve; }), choose: new MockBrain().choose };
  const r = new Runtime(world, brain, options, () => {}); const p = r.refreshPlan(); r.close();
  finish({ goal: 'late', preferred: 'idle', say: 'late chat' }); await p;
  assert.equal(world.state.messages.length, 0);
});

test('new conversation discards a pending choice without treating it as an executed action',async()=>{let finish!:(d:{action:'idle';confidence:number})=>void;const w=new MockWorld();const events:string[]=[];const brain:Brain={plan:async()=>({goal:'wait',preferred:'idle'}),choose:()=>new Promise(resolve=>{finish=resolve;})};const r=new Runtime(w,brain,options,e=>events.push(e));const pending=r.tick();await flush();w.state.messages=['Alice: wait, I am using the chest'];await r.tick();finish({action:'idle',confidence:1});await pending;assert.ok(events.includes('decision_discarded'));assert.ok(!r.planning.recentActions.some(a=>a.outcome==='succeeded'));r.close();});
test('unchanged idle state reuses short wait without another selector call; new chat wakes it',async()=>{let choices=0;const w=new MockWorld(),r=new Runtime(w,{plan:async()=>({goal:'wait',preferred:'idle',steps:[]}),choose:async()=>{choices++;return {action:'idle',confidence:1};}},options,()=>{});await r.tick();await flush();await r.tick();const before=choices;await r.tick();assert.equal(choices,before);w.state.messages=['Alice: crafted the items'];await r.tick();assert.ok(choices>before);r.close();});
