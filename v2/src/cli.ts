import {RecoveryMemory} from './recovery.js';
import {GoalBook} from './goals.js';
import {SocialMemory} from './social.js';
import {botMemoryLocation,openBotMemory} from './experience-memory.js';
import { mkdirSync, appendFileSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { applyCommand } from './control.js';
import { join } from 'node:path';
import { config } from './config.js';
import { ApiBrain, Budget, LayeredMockBrain } from './providers.js';
import { MockWorld } from './mock.js';
import { Runtime } from './runtime.js';
import type { Log, World } from './types.js';

async function main() {
  const mode = process.argv[2];
  if (!['--mock', '--live', '--api-check'].includes(mode)) throw new Error('Use --mock, --live, or --api-check');
  const c = config();
  if (mode !== '--mock' && (!c.llmKey || (c.mode === 'jev' && !c.jevKey)))
    throw new Error('Set LLM_API_KEY and (for jev mode) JEV_API_KEY in v2/.env');
  if(mode==='--mock'&&c.workflowMode==='procedural')throw Error('Use pnpm procedure:mock for the v2.5 offline fixture, or WORKFLOW_MODE=direct for the legacy demo');
  const budget = new Budget(c.maxCalls, c.maxUsd);
  const brain = mode === '--mock' ? new LayeredMockBrain() : new ApiBrain(c, budget);
  if (mode === '--api-check') {
    const state = new MockWorld().snapshot(); const signal = AbortSignal.timeout(c.apiMs * 2);
    const plan = await brain.plan(state, [], signal);
    const decision = await brain.choose(state, plan, ['idle', 'mine'], signal);
    console.log(JSON.stringify({ check: 'passed', plan, decision, budget })); return;
  }
  const dir = join('runs', new Date().toISOString().replace(/[:.]/g, '-') + `-${process.pid}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ workflowMode:c.workflowMode,agentTrack:'A',actionInterface:'skills-v2-container',observationInterface:'geometric-visible-v1',mode, names: c.names, decisionMode: c.mode,
    llmModel: c.llmModel, jevModel: c.jevModel, runSeconds: c.runSeconds,
    tickMs: c.tickMs, planMs: c.planMs, actionMs: c.actionMs,
    rates: { input: c.inputRate, output: c.outputRate, jev: c.jevRate },
    maxCalls: c.maxCalls, maxUsd: c.maxUsd }, null, 2), { mode: 0o600 });
  mkdirSync('runs/memory', { recursive: true, mode: 0o700 });
  const runtimes: Runtime[] = []; const shared = { logs: 0 }; let stopped = false;
  const logging = (bot: string): Log => (event, fields = {}) => {
    const line = JSON.stringify({ at: new Date().toISOString(), bot, event, ...fields });
    appendFileSync(join(dir, 'events.jsonl'), line + '\n', { mode: 0o600 });
    console.log(line);
  };
  for (const name of c.names) {
    const log = logging(name);
    const experience=openBotMemory(mode,name,c);
    const world: World = mode === '--mock' ? new MockWorld(shared)
      : new (await import('./mineflayer.js')).MineflayerWorld(name, c, log);
    const runtime = new Runtime(world, brain, { workflowMode:c.workflowMode,selectorMs:c.tickMs,longPlanMs:c.longPlanMs,reflectionMs:c.reflectionMs,socialMs:c.socialMs,recovery:new RecoveryMemory(join(botMemoryLocation(mode,name,c).dir,'recovery.json')),planMs: c.planMs, actionMs: c.actionMs, minConfidence: c.minConfidence, goals:new GoalBook(join(botMemoryLocation(mode,name,c).dir,'goals.json'),botMemoryLocation(mode,name,c).profile), social:new SocialMemory(name,join(botMemoryLocation(mode,name,c).dir,'social.json')),memory:experience,selectorKind:mode==='--mock'?'mock':c.mode }, log);
    const memory = join('runs/memory', `${mode.slice(2)}-${name}.json`);
    if (existsSync(memory)) {
      try { const old = JSON.parse(readFileSync(memory, 'utf8')); runtime.history = Array.isArray(old) ? old.filter(x => typeof x === 'string').slice(-20) : []; }
      catch { log('memory_read_error'); }
    }
    runtimes.push(runtime);
  }
  const input = createInterface({ input: process.stdin });
  input.on('line', line => {
    if (stopped) return;
    try {
      console.log(applyCommand(line, new Map(c.names.map((name, i) => [name, runtimes[i]]))));
      for (const r of runtimes) void r.tick().catch(() => stop('runtime error'));
    } catch { console.log('Use /goal Alice <text>, /clear Alice, /goal * <text>, or /clear *'); }
  });
  console.log('No assigned user goal. Live commands: /goal Alice <text>, /clear Alice (* = all bots).');
  const start = Date.now();
  const stop = (reason: string) => {
    if (stopped) return; stopped = true; clearInterval(timer); input.close();
    runtimes.forEach((r, i) => {
      r.close(); writeFileSync(join('runs/memory', `${mode.slice(2)}-${c.names[i]}.json`), JSON.stringify(r.history), { mode: 0o600 });
      writeFileSync(join(dir, `${c.names[i]}-planning.json`), JSON.stringify(r.planning), {mode:0o600});
    });
    writeFileSync(join(dir, 'summary.json'), JSON.stringify({ reason, mode, budget, mockSharedLogs: mode === '--mock' ? shared.logs : undefined }, null, 2), { mode: 0o600 });
    console.log(`Stopped: ${reason}. Logs: ${dir}`);
  };
  const timer = setInterval(() => {
    if (Date.now() - start >= c.runSeconds * 1000 || budget.exhausted) { stop('time or API budget limit'); return; }
    for (const r of runtimes) void r.tick().catch(() => stop('runtime error'));
    writeFileSync(join(dir, 'status.json'), JSON.stringify({ mode, budget, bots: runtimes.map((r, i) => ({ name: c.names[i], state: r.world.snapshot(), userGoal: r.userGoal, plan: r.plan, planning: r.planning })) }, null, 2), { mode: 0o600 });
  }, c.tickMs);
  process.once('SIGINT', () => stop('SIGINT')); process.once('SIGTERM', () => stop('SIGTERM'));
  console.log(`Mode=${mode}; bots=${c.names.join(',')}; run=${dir}; no keys are logged.`);
}
main().catch(e => { console.error(e instanceof Error ? e.message : 'Startup failed'); process.exitCode = 1; });
