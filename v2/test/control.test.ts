import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand } from '../src/control.js';
import { Runtime } from '../src/runtime.js';
import { MockWorld } from '../src/mock.js';
import { MockBrain } from '../src/providers.js';
import type { Brain, Plan } from '../src/types.js';

test('operator can assign, replace and clear independent goals without restart', () => {
  const goals: Record<string, string | null> = { Alice: null, Bob: null };
  const bots = new Map(Object.keys(goals).map(name => [name, { setGoal: (g: string | null) => { goals[name] = g; } }]));
  applyCommand('/goal Alice bring wood', bots);
  assert.deepEqual(goals, { Alice: 'bring wood', Bob: null });
  applyCommand('/goal * wait here', bots);
  assert.deepEqual(goals, { Alice: 'wait here', Bob: 'wait here' });
  applyCommand('/clear Alice', bots);
  assert.deepEqual(goals, { Alice: null, Bob: 'wait here' });
  assert.throws(() => applyCommand('/goal Unknown hi', bots));
  assert.throws(() => applyCommand('/goal Bob', bots));
});

test('goal change discards pending plans and passes nullable current goal to planner', async () => {
  let finish!: (p: Plan) => void;
  const received: (string | null | undefined)[] = [];
  const brain: Brain = { plan: (_s, _h, _signal, goal) => {
    received.push(goal); return new Promise(resolve => { finish = resolve; });
  }, choose: new MockBrain().choose };
  const r = new Runtime(new MockWorld(), brain, { planMs: 30000, actionMs: 1000, minConfidence: 0.55 }, () => {});
  const initial = r.refreshPlan();
  r.setGoal('follow me');
  finish({ goal: 'old wood task', preferred: 'mine',mine:{position:{x:1,y:64,z:0},expected:'oak_log'} }); await initial;
  assert.equal(r.plan.preferred, 'idle');
  const changed = r.refreshPlan();
  finish({ goal: 'approach player', preferred: 'follow' }); await changed;
  r.setGoal(null);
  const cleared = r.refreshPlan();
  finish({ goal: 'observe', preferred: 'idle' }); await cleared;
  assert.deepEqual(received, [null, 'follow me', null]);
  r.close();
});
