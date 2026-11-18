import test from 'node:test';import assert from 'node:assert/strict';
import {evidenceAliases} from '../src/evidence-aliases.js';
import {validateReflectionUpdates} from '../src/experience-memory.js';
import {validatePlaceUpdates} from '../src/important-places.js';
import {ApiBrain,Budget} from '../src/providers.js';import {config} from '../src/config.js';
const id='long-original-episode-uuid';const input:any={revision:1,through:1,episodes:[{id}],guides:[]};
const guide=(support=id)=>({id:'guide',status:'active',text:'Check observed inventory gains.',uncertainty:'Tentative.',scope:{species:[],equipment:[],health:[0,20],action:'mine'},support:[support],counterexamples:[]});
test('evidence aliases roundtrip exactly, avoid existing labels and do not correct unknown references',()=>{
 const raw={...input,note:'E1',guides:[{support:[id]}]};const c=evidenceAliases(raw);assert.equal(c.input.episodes[0].id,'E2');assert.equal(c.input.guides[0].support[0],'E2');assert.deepEqual(c.decode(c.input),raw);assert.equal(c.decode({id:'E999'}).id,'E999');assert.equal(raw.episodes[0].id,id);
});
test('guideline errors identify every oversized field and preserve the supplied drafts',()=>{
 const g={...guide(),text:'x'.repeat(265),uncertainty:'y'.repeat(190)};
 assert.throws(()=>validateReflectionUpdates(input,[g]),e=>String(e).includes('updates[0].text: 265')&&String(e).includes('updates[0].uncertainty: 190'));assert.equal(g.text.length,265);
});
test('a form error is repaired from the response alone, then from the same aliased evidence, restoring persistent IDs',async()=>{
 for(const fixedAt of [2,3,0]){
  const bodies:any[]=[];const brain=new ApiBrain({...config(),mode:'jev',llmKey:'fixture'},new Budget(5,1),async(_u,init)=>{
   const b=JSON.parse(init!.body as string),payload=JSON.parse(b.messages[1].content);bodies.push(payload);
   if(bodies.length===1)assert.equal(payload.episodes[0].id,'E1');
   if(bodies.length===2){assert.equal(payload.originalInput,undefined);assert.match(payload.responseRepair.error,/updates\[0\].uncertainty: 172/);assert.equal(payload.responseRepair.invalidResponse.updates[0].support[0],'E1');}
   if(bodies.length===3){assert.equal(payload.originalInput.episodes[0].id,'E1');assert.match(payload.responseRepair.error,/updates\[0\].uncertainty: 172/);}
   const g={...guide('E1'),uncertainty:bodies.length===fixedAt?'Tentative.':'x'.repeat(172)};
   return Response.json({choices:[{message:{content:JSON.stringify({updates:[g]})}}],usage:{prompt_tokens:1,completion_tokens:1}});
  });
  if(fixedAt){const r=await brain.reflect(input,new AbortController().signal);assert.equal(r[0].support[0],id);}else await assert.rejects(brain.reflect(input,new AbortController().signal),/Invalid guideline/);
  assert.equal(bodies.length,fixedAt===2?2:3);
 }
});
test('evidence errors go straight to the full repair input',async()=>{
 const bodies:any[]=[];const brain:any=new ApiBrain({...config(),mode:'jev',llmKey:'fixture'},new Budget(5,1),async(_u,init)=>{
  bodies.push(JSON.parse(JSON.parse(init!.body as string).messages[1].content));
  return Response.json({choices:[{message:{content:JSON.stringify({ok:bodies.length})}}],usage:{prompt_tokens:1,completion_tokens:1}});
 });
 const out=await brain.generateValidated('test',{a:1},new AbortController().signal,1000,100,(raw:any)=>{if(raw.ok===1)throw Error('Invalid goal evidence reference: copy IDs');return raw;});
 assert.equal(out.ok,2);assert.equal(bodies.length,2);assert.deepEqual(bodies[1].originalInput,{a:1});
});
test('place citation preflight repairs wrong aliases without applying or discarding annotations',async()=>{
 const evidence:any=[{id:'long-place-id',name:'stone',position:{x:0,y:0,z:0},dimension:'overworld',lastSeen:1}];let calls=0;
 const brain:any=new ApiBrain({...config(),llmKey:'fixture'},new Budget(4,1),async()=>{calls++;return Response.json({choices:[{message:{content:JSON.stringify({placeUpdates:[{evidenceId:calls===1?'E999':'E1',label:'Stone',reason:'Observed material'}]})}}],usage:{prompt_tokens:1,completion_tokens:1}});});
 const out=await brain.generateValidated('test',{placeCitationContract:{allowedEvidenceIds:['long-place-id']},memory:{placeEvidence:evidence}},new AbortController().signal,1000,100,(raw:any)=>{validatePlaceUpdates(raw.placeUpdates,evidence);return raw;});
 assert.equal(calls,2);assert.equal(out.placeUpdates[0].evidenceId,'long-place-id');assert.deepEqual(evidence[0].position,{x:0,y:0,z:0});
});
