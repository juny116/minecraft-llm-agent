import test from 'node:test';
import assert from 'node:assert/strict';
import {candidates} from '../src/types.js';
import {ApiBrain,Budget,selectorObservation} from '../src/providers.js';
import {MockWorld} from '../src/mock.js';
import {config} from '../src/config.js';
test('prompt truncation cannot revoke an observed movement target; internal index is not sent to models',async()=>{
 const s=new MockWorld().snapshot();s.position={x:0,y:64,z:0};s.places=[];s.navigationTargets=[];s.observedDestinationKeys=['8,64,0'];
 assert.ok(candidates(s,{goal:'Explore',preferred:'move',destination:{x:8,y:64,z:0}}).includes('move'));
 assert.equal(candidates(s,{goal:'Explore',preferred:'move',destination:{x:9,y:64,z:0}}).includes('move'),false);
 assert.equal('observedDestinationKeys' in selectorObservation(s),false);
 const brain=new ApiBrain({...config(),llmKey:'test'},new Budget(2,1),(async(_url,init)=>{assert.equal(String(init?.body).includes('observedDestinationKeys'),false);return Response.json({choices:[{message:{content:'{"goal":"Observe","preferred":"idle"}'}}],usage:{prompt_tokens:1,completion_tokens:1}});}) as typeof fetch);
 await brain.plan(s,[],new AbortController().signal);
});
