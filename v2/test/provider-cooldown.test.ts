import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiBrain,Budget} from '../src/providers.js';
import {MockWorld} from '../src/mock.js';
import {config} from '../src/config.js';
test('transient overload backs off without dispatch or cost and recovers within the monetary ceiling',async(t)=>{
 let now=Date.now(),calls=0;t.mock.method(Date,'now',()=>now);const b=new Budget(10,1);
 const brain=new ApiBrain({...config(),llmKey:'test'},b,(async()=>++calls<=2?new Response('',{status:529}):Response.json({choices:[{message:{content:'{"goal":"Wait","preferred":"idle"}'}}],usage:{prompt_tokens:1,completion_tokens:1}})) as typeof fetch);
 const run=()=>brain.plan(new MockWorld().snapshot(),[],new AbortController().signal);
 await assert.rejects(run(),/529/);const cost=b.usd;await assert.rejects(run(),/cooldown/);assert.equal(calls,2);assert.equal(b.usd,cost);
 now+=2500;await run();assert.equal(calls,3);assert.equal(b.invalidResponses,0);assert.equal(b.exhausted,false);
 b.boundUnknown(.01);b.boundUnknown(.01);assert.equal(b.exhausted,false);assert.throws(()=>b.reserve(1),/preflight/);assert.equal(b.exhausted,true);
});
