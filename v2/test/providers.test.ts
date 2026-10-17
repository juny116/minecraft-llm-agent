import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { ApiBrain, Budget, parsePlan } from '../src/providers.js';
import { MockWorld } from '../src/mock.js';
const signal = () => new AbortController().signal;
const c = () => ({ ...config(), llmKey: 'test-only-key', jevKey: 'test-only-jev', mode: 'jev' as const });

test('JEV uses choice criteria and parses the documented answer, rejecting unknown actions', async () => {
  let choice = 'mine';
  const transport = (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    assert.equal(body.questions.action.type, 'choice');
    assert.deepEqual(Object.keys(body.questions.action.criteria), ['idle', 'mine']);
    assert.equal(init.headers.Authorization, 'Bearer test-only-jev');
    return Response.json({ answers: { action: { type: 'choice', choice, confidence: 0.9 } }, usage: { input_tokens: 100, output_tokens: 0 } });
  }) as typeof fetch;
  const brain = new ApiBrain(c(), new Budget(10, 2), transport);
  const args = [new MockWorld().snapshot(), { goal: 'wood', preferred: 'mine' as const }, ['idle', 'mine'] as ('idle' | 'mine')[], signal()] as const;
  assert.equal((await brain.choose(...args)).action, 'mine');
  choice = 'teleport'; await assert.rejects(brain.choose(...args), /Invalid JEV/);
});

test('planner sends authenticated bounded JSON request and validates its output', async () => {
  const transport = (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    assert.equal(init.headers.Authorization, 'Bearer test-only-key');
    assert.equal(body.response_format.type, 'json_object'); assert.ok(body.max_completion_tokens > 0); assert.equal(body.max_tokens, undefined); assert.equal(body.reasoning_effort, 'none');
    return Response.json({ choices: [{ message: { content: '{"goal":"wood","preferred":"mine","mine":{"position":{"x":1,"y":64,"z":0},"expected":"oak_log"}}' } }], usage: { prompt_tokens: 100, completion_tokens: 10 } });
  }) as typeof fetch;
  const budget = new Budget(2, 2); const brain = new ApiBrain({ ...c(), llmUrl: 'https://api.openai.com/v1', llmModel: 'gpt-6-luna' }, budget, transport);
  assert.equal((await brain.plan(new MockWorld().snapshot(), [], signal())).preferred, 'mine');
  assert.equal(budget.input, 100); assert.equal(budget.calls, 1);
  assert.throws(() => parsePlan({ goal: 'bad', preferred: 'exec_shell' }));
});

test('call reservations prevent concurrent requests exceeding the shared cap', async () => {
  let called = 0;
  const transport = (async () => { called++; return Response.json({ choices: [{ message: { content: '{"goal":"wait","preferred":"idle"}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }); }) as typeof fetch;
  const brain = new ApiBrain(c(), new Budget(1, 2), transport);
  const results = await Promise.allSettled([brain.plan(new MockWorld().snapshot(), [], signal()), brain.plan(new MockWorld().snapshot(), [], signal())]);
  assert.equal(called, 1); assert.equal(results.filter(x => x.status === 'rejected').length, 1);
});

test('provider failure never echoes body or key; unknown usage stops further calls', async () => {
  const budget = new Budget(10, 2);
  const brain = new ApiBrain(c(), budget, (async () => new Response('secret response body', { status: 500 })) as typeof fetch);
  await assert.rejects(brain.plan(new MockWorld().snapshot(), [], signal()), /^Error: API HTTP 500$/);
  assert.ok(budget.exhausted);
});

test('preflight refusal is unbilled, not an unknown dispatched request',async()=>{let called=0;const b=new Budget(10,.000001),brain=new ApiBrain(c(),b,(async()=>{called++;throw Error('must not dispatch');}) as typeof fetch);await assert.rejects(brain.plan(new MockWorld().snapshot(),[],signal()),/preflight/);assert.equal(called,0);assert.equal(b.calls,0);assert.equal(b.unknownUsage,0);assert.equal(b.reservedUsd,0);});
test('reservations account for in-flight costs and release after actual usage',async()=>{const b=new Budget(10,.1);b.reserve(.06);assert.throws(()=>b.reserve(.05),/preflight/);assert.equal(b.calls,1);b.record({input_tokens:100,output_tokens:10},.1,.5);b.release(.06);assert.equal(b.reservedUsd,0);assert.equal(b.unknownUsage,0);});
test('successful API call reconciles estimate to reported usage without retaining reservation',async()=>{const b=new Budget(2,1),brain=new ApiBrain(c(),b,(async()=>Response.json({choices:[{message:{content:'{"goal":"wait","preferred":"idle"}'}}],usage:{prompt_tokens:100,completion_tokens:10}})) as typeof fetch);await brain.plan(new MockWorld().snapshot(),[],signal());assert.equal(b.reservedUsd,0);assert.equal(b.calls,1);assert.ok(b.usd>0&&b.usd<.01);});
test('empty steps is a valid waiting plan rather than a retry loop',()=>{const p=parsePlan({goal:'Wait for Alice report',preferred:'idle',steps:[]});assert.deepEqual(p.steps,[]);});

test('contextual planner accepts waiting without steps but requires steps for work',async()=>{
 let result:any={longTermGoal:'Wait for further cooperation',goal:'Waiting',preferred:'idle',steps:[]};
 const brain=new ApiBrain(c(),new Budget(5,2),(async()=>Response.json({choices:[{message:{content:JSON.stringify(result)}}],usage:{prompt_tokens:100,completion_tokens:20}})) as typeof fetch);
 const context:any={longTermGoal:'Wait',mediumTerm:{summary:'Wait',steps:[],activeStep:0},replanReasons:[],recentActions:[],olderSummary:{count:0,byAction:{},inventoryNet:{},healthNet:0},failureStreak:0};
 assert.deepEqual((await brain.plan(new MockWorld().snapshot(),[],signal(),null,context)).steps,[]);
 delete result.steps;assert.equal((await brain.plan(new MockWorld().snapshot(),[],signal(),null,context)).preferred,'idle');
 result={longTermGoal:'Eat',goal:'Eat',preferred:'eat',steps:[]};
 await assert.rejects(brain.plan(new MockWorld().snapshot(),[],signal(),null,context),/actionable steps/);
});
