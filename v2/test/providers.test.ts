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

test('transient HTTP failures are bounded, redacted and retried once', async () => {
 const budget=new Budget(10,2),brain=new ApiBrain(c(),budget,(async()=>new Response('secret response body',{status:500})) as typeof fetch);
 await assert.rejects(brain.plan(new MockWorld().snapshot(),[],signal()),/API http 500/);
 assert.equal(budget.calls,2);assert.equal(budget.boundedUnknownUsage,2);assert.equal(budget.unsettledUsage,0);assert.ok(budget.usd>0);assert.equal(budget.usd,budget.unknownUsd);assert.equal(budget.reservedUsd,0);assert.ok(!JSON.stringify(budget.diagnostics).includes('secret response'));
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

test('social API distinguishes intended from running work and repairs wrong language within one extra call',async()=>{
 let calls=0;const speech={to:'all',kind:'chat',text:'Привет'};
 const transport=(async(_url:any,init:any)=>{calls++;const body=JSON.parse(init.body),data=JSON.parse(body.messages[1].content);if(calls===1){assert.equal(data.execution.activeAction,null);assert.ok(data.allowedActions.includes('mine'));assert.match(body.messages[0].content,/never translated prose/);assert.match(body.messages[0].content,/NOT execution/);}return Response.json({choices:[{message:{content:JSON.stringify({speech:{...speech,text:calls===1?speech.text:'안녕, 주변을 살펴볼게.'}})}}],usage:{prompt_tokens:10,completion_tokens:5}});}) as typeof fetch;
 const b=new ApiBrain(c(),new Budget(3,1),transport);const result=await b.communicate(new MockWorld().snapshot(),{goal:'gather',preferred:'mine'},signal(),{activeAction:null,planPending:false});assert.match(result!.text,/살펴/);assert.equal(calls,2);
});
test('wrong language after bounded repair is not sent',async()=>{
 let calls=0;const transport=(async()=>{calls++;return Response.json({choices:[{message:{content:JSON.stringify({speech:{to:'all',kind:'chat',text:'Привет'}})}}],usage:{prompt_tokens:1,completion_tokens:1}});}) as typeof fetch;
 const b=new ApiBrain(c(),new Budget(3,1),transport);await assert.rejects(b.communicate(new MockWorld().snapshot(),{goal:'wait',preferred:'idle'},signal()),/Korean/);assert.equal(calls,2);
});

const ok=()=>Response.json({choices:[{message:{content:'{"goal":"wait","preferred":"idle"}'}}],usage:{prompt_tokens:10,completion_tokens:2}});
test('timeout retry succeeds with first request ceiling retained',async()=>{
 let calls=0;const b=new Budget(10,1),brain=new ApiBrain({...c(),apiMs:5},b,(async(_u:any,init:any)=>{if(++calls===1)return await new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason)));return ok();}) as typeof fetch);
 const keepAlive=setTimeout(()=>{},1000);try{await brain.plan(new MockWorld().snapshot(),[],signal());}finally{clearTimeout(keepAlive);}
 assert.equal(calls,2);assert.equal(b.boundedUnknownUsage,1);assert.ok(b.usd>b.unknownUsd);assert.ok(b.diagnostics.some(x=>x.kind==='timeout'));assert.equal(b.reservedUsd,0);
});
test('already cancelled request never dispatches or charges',async()=>{const b=new Budget(5,1),a=new AbortController();a.abort();const brain=new ApiBrain(c(),b,(async()=>{throw Error('must not dispatch');}) as typeof fetch);await assert.rejects(brain.plan(new MockWorld().snapshot(),[],a.signal));assert.equal(b.calls,0);assert.equal(b.usd,0);});
test('in-flight cancellation charges ceiling but never retries',async()=>{const b=new Budget(5,1),a=new AbortController();let calls=0;const brain=new ApiBrain(c(),b,(async()=>{calls++;a.abort();throw Error('private network details');}) as typeof fetch);await assert.rejects(brain.plan(new MockWorld().snapshot(),[],a.signal),/cancelled/);assert.equal(calls,1);assert.equal(b.boundedUnknownUsage,1);assert.equal(b.reservedUsd,0);});
test('missing usage charges each attempt and third unknown opens circuit',async()=>{const b=new Budget(10,1),brain=new ApiBrain(c(),b,(async()=>Response.json({})) as typeof fetch);await assert.rejects(brain.plan(new MockWorld().snapshot(),[],signal()),/missing_usage/);await assert.rejects(brain.plan(new MockWorld().snapshot(),[],signal()),/missing_usage/);assert.equal(b.calls,3);assert.equal(b.boundedUnknownUsage,3);assert.equal(b.exhausted,true);});
test('HTTP 429 is retried with no unknown charge, auth errors stop without retry',async()=>{let calls=0;const b=new Budget(5,1),brain=new ApiBrain(c(),b,(async()=>++calls===1?new Response('',{status:429}):ok()) as typeof fetch);await brain.plan(new MockWorld().snapshot(),[],signal());assert.equal(calls,2);assert.equal(b.unknownUsd,0);const fatal=new Budget(5,1);await assert.rejects(new ApiBrain(c(),fatal,(async()=>new Response('',{status:401})) as typeof fetch).plan(new MockWorld().snapshot(),[],signal()),/401/);assert.equal(fatal.calls,1);assert.ok(fatal.exhausted);});

// Match the JSON-mode endpoint contract rather than accepting every mock request.
test('separate long-goal request explicitly asks for JSON without relying on observation text',async()=>{
 const transport=(async(_url:any,init:any)=>{const body=JSON.parse(init.body);assert.equal(body.response_format.type,'json_object');assert.match(body.messages[0].content,/json/i);return Response.json({choices:[{message:{content:JSON.stringify({goalUpdates:[],activeGoalId:null})}}],usage:{prompt_tokens:10,completion_tokens:10}});}) as typeof fetch;
 const b=new ApiBrain(c(),new Budget(2,1),transport);
 const context:any={longTermGoal:null,mediumTerm:{summary:'',steps:[],activeStep:0},replanReasons:[],recentActions:[],olderSummary:{count:0,byAction:{},inventoryNet:{},healthNet:0},failureStreak:0};
 assert.equal((await b.reviewGoals(new MockWorld().snapshot(),context,signal())).activeGoalId,null);
});

test('reflection reserves its actual larger output ceiling and identifies truncated output',async()=>{
 const c={...config(),llmKey:'test',maxOutput:512};const budget=new Budget(3,1);let truncate=false;
 const brain=new ApiBrain(c,budget,(async(_url:any,init:any)=>{const req=JSON.parse(init.body);const limit=req.max_completion_tokens??req.max_tokens;assert.equal(limit,2048);assert.ok(budget.reservedUsd>=limit*c.outputRate/1e6);return Response.json({choices:[{finish_reason:truncate?'length':'stop',message:{content:'{"updates":[]}'}}],usage:{prompt_tokens:10,completion_tokens:10}});}) as typeof fetch);
 const input={revision:0,through:0,episodes:[],guides:[],feedback:'Invalid guideline uncertainty: max 300 characters'};
 assert.deepEqual(await brain.reflect(input,new AbortController().signal),[]);truncate=true;await assert.rejects(brain.reflect(input,new AbortController().signal),/truncated/);assert.equal(budget.reservedUsd,0);
});
