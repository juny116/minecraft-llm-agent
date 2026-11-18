import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ExperienceMemory,type GuideDraft,type Reflection} from '../src/experience-memory.js';
import {compact,changes,type ActionRecord} from '../src/planning.js';
import {MockWorld} from '../src/mock.js';
import {Runtime} from '../src/runtime.js';
import {ApiBrain,Budget} from '../src/providers.js';
import {config} from '../src/config.js';
function fixture(t:any){const dir=mkdtempSync(join(tmpdir(),'mc-memory-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return {dir,m:new ExperienceMemory(dir,'Bob/test')};}
function record():ActionRecord{const s=compact(new MockWorld().snapshot());return {id:1,source:'selector',selectorKind:'jev',decision:{action:'attack',confidence:.1},options:['attack','flee','idle'],decisionObserved:s,planVersion:0,goal:null,stepId:null,before:s,after:s,changes:changes(s,s),outcome:'partial',result:'time_limit',startedAt:1,endedAt:2};}
function draft(id:string):GuideDraft{return {id:'zombie_spacing',status:'active',text:'Try maintaining room to retreat; this episode alone does not establish a best tactic.',uncertainty:'Single encounter; tentative.',scope:{species:['zombie'],equipment:['iron_sword'],health:[0,20],action:'flee'},support:[id],counterexamples:[]};}
function visible(){const s=new MockWorld().snapshot();s.enemies=[{id:1,kind:'zombie',position:{x:3,y:0,z:0},distance:3}];s.equipment=[{slot:'hand',name:'iron_sword'}];return s;}
test('restart restores facts and scoped guidance with session identity isolated',t=>{
 const {dir,m}=fixture(t),id=m.add(record());m.apply(m.reflection(),[draft(id)],'fake-llm');const n=new ExperienceMemory(dir,'Bob/test');
 assert.notEqual(n.session,m.session);assert.equal(n.retrieve(visible())[0].support[0],id);assert.equal(n.retrieve(visible())[0].model,'fake-llm');
 const s=visible();s.enemies=[];assert.equal(n.retrieve(s).length,1);s.enemies=visible().enemies;s.equipment=[];assert.equal(n.retrieve(s).length,1);
 assert.throws(()=>new ExperienceMemory(dir,'Alice/test'),/Invalid experience memory/);
});
test('revisions preserve counterexamples, immutable evidence and historical versions',t=>{
 const {dir,m}=fixture(t),a=m.add(record());m.apply(m.reflection(),[draft(a)]);
 const b=m.add({...record(),outcome:'failed'}),input=m.reflection(),g={...draft(a),counterexamples:[b],uncertainty:'Conflicting encounter; avoid generalizing.'};
 // scope action must match to retrieve existing guide into reflection; this guide concerns flee.
 // Include guide explicitly from an input generated after a flee episode.
 m.add({...record(),decision:{action:'flee',confidence:.2}});
 const context=m.reflection();m.apply(context,[g]);assert.equal(m.retrieve(visible())[0].version,2);
 m.add({...record(),decision:{action:'flee',confidence:1}});assert.throws(()=>m.apply(m.reflection(),[draft(a)]),/counterexamples/);
 const d=JSON.parse(readFileSync(join(dir,'memory.json'),'utf8'));assert.equal(d.revisions.length,2);assert.equal(d.episodes[0].id,a);
 const retired={...g,status:'retired' as const};m.apply(m.reflection(),[retired]);assert.equal(m.retrieve(visible()).length,0);
});
test('unknown evidence, duplicate IDs and stale updates reject atomically',t=>{
 const {dir,m}=fixture(t),id=m.add(record()),input=m.reflection(),before=readFileSync(join(dir,'memory.json'),'utf8');
 assert.throws(()=>m.apply(input,[draft('invented')]));assert.equal(readFileSync(join(dir,'memory.json'),'utf8'),before);
 assert.throws(()=>m.apply(input,[draft(id),draft(id)]));m.apply(input,[]);assert.throws(()=>m.apply(input,[draft(id)]),/Stale/);
});
test('corrupt memory is preserved and rejected rather than silently reset',t=>{
 const {dir}=fixture(t);writeFileSync(join(dir,'memory.json'),'broken');assert.throws(()=>new ExperienceMemory(dir,'Bob/test'));assert.equal(readFileSync(join(dir,'memory.json'),'utf8'),'broken');
});
test('reflection batches do not skip pending history',t=>{
 const {m}=fixture(t);for(let i=0;i<20;i++)m.add(record());const a=m.reflection();assert.equal(a.through,8);m.apply(a,[]);assert.equal(m.pending(),12);const b=m.reflection();assert.equal(b.through,16);assert.notEqual(a.episodes[0].id,b.episodes[0].id);
});
test('runtime saves actions, reflects with a fake LLM, and supplies restored relevant guidance to selector',async t=>{
 const {dir,m}=fixture(t),w=new MockWorld();w.state=visible();w.execute=async()=> 'ok';let input:Reflection|undefined;
 const brain={reflectionModel:'fake-model',plan:()=>new Promise<any>(()=>{}),choose:async()=>({action:'flee' as const,confidence:.01}),reflect:async(i:Reflection)=>{input=i;return [draft(i.episodes[0].id)];}};
 const r=new Runtime(w,brain,{planMs:30000,actionMs:5000,minConfidence:.55,memory:m},()=>{});await r.tick();await r.reflectMemory(true);assert.ok(input?.episodes.length);r.close();
 const restored=new ExperienceMemory(dir,'Bob/test'),other=new MockWorld();other.state=visible();let received=0;
 const r2=new Runtime(other,{plan:()=>new Promise<any>(()=>{}),choose:async s=>{received=s.memoryGuidance?.length??0;return {action:'idle',confidence:.1};}},{planMs:30000,actionMs:5000,minConfidence:.55,memory:restored},()=>{});
 await r2.tick();r2.close();assert.equal(received,1);
 const data=JSON.parse(readFileSync(join(dir,'memory.json'),'utf8'));assert.equal(data.episodes.at(-1).guidanceUsed[0].version,1);
});
test('reflection uses shared API budget and fake HTTP only',async t=>{
 const {m}=fixture(t),id=m.add(record()),budget=new Budget(1,1);let calls=0;
 const api=new ApiBrain({...config(),llmKey:'fake',mode:'jev'},budget,(async(_u:any,init:any)=>{calls++;const body=JSON.parse(init.body);assert.ok(body.messages[0].content.includes('counterexamples'));assert.equal(JSON.parse(body.messages[1].content).episodes[0].id,"E1");return Response.json({choices:[{message:{content:JSON.stringify({updates:[draft("E1")]})}}],usage:{prompt_tokens:2,completion_tokens:2}});}) as typeof fetch);
 const ctx=m.reflection();m.apply(ctx,await api.reflect(ctx,new AbortController().signal),api.reflectionModel);assert.equal(calls,1);assert.equal(budget.calls,1);
 await assert.rejects(()=>api.reflect(ctx,new AbortController().signal));assert.equal(calls,1);
});

test('late reflection after close cannot update durable guidance',async t=>{
 const {m}=fixture(t);m.add(record());let resolve!:(v:unknown)=>void;
 const r=new Runtime(new MockWorld(),{plan:()=>new Promise<any>(()=>{}),choose:async()=>({action:'idle',confidence:1}),reflect:()=>new Promise(r=>{resolve=r;})},{planMs:30000,actionMs:1000,minConfidence:.55,memory:m},()=>{});
 const pending=r.reflectMemory(true);r.close();resolve([draft(m.reflection().episodes[0].id)]);await pending;assert.equal(m.retrieve(visible()).length,0);assert.equal(m.pending(),1);
});
test('guidebook includes every active guideline with scope preserved for model judgment',t=>{
 const {m}=fixture(t),id=m.add(record());m.apply(m.reflection(),Array.from({length:6},(_,i)=>({...draft(id),id:'guide_'+i,scope:{...draft(id).scope,health:(i===0?[0,5]:[0,20]) as [number,number]}})));
 const guides=m.retrieve(visible());assert.equal(guides.length,6);assert.deepEqual(guides.find(g=>g.id==='guide_0')!.scope.health,[0,5]);
});

test('historical mining guides reload without rewriting original episode evidence',t=>{
 const {dir,m}=fixture(t),id=m.add(record());m.apply(m.reflection(),[draft(id)]);
 const file=join(dir,'memory.json'),d=JSON.parse(readFileSync(file,'utf8'));d.guides[0].scope.action='gather';d.episodes[0].record.decision.action='gather';writeFileSync(file,JSON.stringify(d));const before=readFileSync(file,'utf8');
 const restored=new ExperienceMemory(dir,'Bob/test');assert.equal(restored.retrieve(visible())[0].scope.action,'mine');assert.equal(readFileSync(file,'utf8'),before);
 assert.throws(()=>restored.apply(restored.reflection(),[{...draft(id),scope:{...draft(id).scope,action:'gather'}}]));
});

test('reflection retrieves prior successes and failures even before any guideline exists, without skipping new episodes',t=>{
 const {m}=fixture(t),success=m.add(record()),failure=m.add({...record(),outcome:'failed'});m.apply(m.reflection(),[]);
 const latest=m.add(record()),input=m.reflection();assert.equal(input.through,3);assert.equal(input.episodes[0].id,latest);assert.ok(input.episodes.some(e=>e.id===success));assert.ok(input.episodes.some(e=>e.id===failure));assert.equal(new Set(input.episodes.map(e=>e.id)).size,input.episodes.length);
 m.apply(input,[]);assert.equal(m.pending(),0);
});

test('passive backlog is explicitly summarized without deleting raw experience or skipping failures',t=>{
 const {m,dir}=fixture(t);for(let i=0;i<30;i++)m.add({...record(),decision:{action:'look',confidence:1},outcome:'succeeded'});
 const failed=m.add({...record(),decision:{action:'look',confidence:1},outcome:'failed'});const input=m.reflection();
 assert.equal(input.through,31);assert.equal(input.passiveSummary?.count,30);assert.ok(input.episodes.some(e=>e.id===failed));assert.equal(input.episodes.length,3);
 m.apply(input,[]);assert.equal(m.pending(),0);assert.equal(JSON.parse(readFileSync(join(dir,'memory.json'),'utf8')).episodes.length,31);
});

test('reflection retains every reference from two maximal guides alongside a full new batch',t=>{
 const {dir,m}=fixture(t);const ids=Array.from({length:32},()=>m.add(record()));
 const data=JSON.parse(readFileSync(join(dir,'memory.json'),'utf8'));data.reviewed=32;
 data.guides=[0,1].map(i=>({...draft(ids[i*16]),id:'guide_'+i,scope:{species:[],equipment:[],health:[0,20],action:'attack'},support:ids.slice(i*16,i*16+8),counterexamples:ids.slice(i*16+8,i*16+16),version:1,updatedAt:1,model:'fake'}));
 writeFileSync(join(dir,'memory.json'),JSON.stringify(data));
 const passive={...record(),decision:{action:'idle' as const,confidence:1},outcome:'succeeded' as const};
 m.add(passive);m.add(passive);for(let i=0;i<8;i++)m.add(record());
 const input=m.reflection(),supplied=new Set(input.episodes.map(e=>e.id));
 assert.ok(input.episodes.length>40);assert.ok(input.episodes.length<=54);
 for(const id of ids)assert.ok(supplied.has(id));m.apply(input,input.guides);
});

test('LLM merge is atomic, keeps counterexamples and raw evidence across restart',t=>{
 const {m,dir}=fixture(t),a=m.add(record()),b=m.add({...record(),outcome:'failed'});
 m.apply(m.reflection(),[{...draft(a),id:'g1',counterexamples:[b]},{...draft(a),id:'g2'}]);
 const input=m.reflection();assert.equal(input.guides.length,2);
 const merged={...draft(a),id:'merged',supersedes:['g1','g2'],revisionReason:'Same conditional advice',counterexamples:[b]};
 const before=readFileSync(join(dir,'memory.json'),'utf8');assert.throws(()=>m.apply(input,[{...merged,counterexamples:[]}]),/counterexamples/);assert.equal(readFileSync(join(dir,'memory.json'),'utf8'),before);
 m.apply(input,[merged],'mock-consolidator');const n=new ExperienceMemory(dir,'Bob/test');assert.deepEqual(n.retrieve().map(g=>g.id),['merged']);
 const raw=JSON.parse(readFileSync(join(dir,'memory.json'),'utf8'));assert.equal(raw.episodes.length,2);assert.equal(raw.revisions.length,5);assert.equal(raw.guides.find((g:any)=>g.id==='g1').status,'retired');assert.equal(n.retrieve()[0].supersedes!.length,2);
});
test('whole-book maintenance can run without new episodes and is periodic',t=>{
 const {m}=fixture(t),a=m.add(record());m.apply(m.reflection(),[draft(a)]);assert.equal(m.pending(),0);assert.equal(m.needsMaintenance(),false);assert.equal(m.needsMaintenance(Date.now()+300001),true);
 const input=m.reflection();assert.equal(input.guides.length,1);assert.ok(input.episodes.some(e=>e.id===a));
});
test('new guidelines remain concise; historical long drafts are preserved on load',t=>{
 const {m,dir}=fixture(t),a=m.add(record());assert.throws(()=>m.apply(m.reflection(),[{...draft(a),text:'a'.repeat(241)}]),/max240/);
 m.apply(m.reflection(),[draft(a)]);const path=join(dir,'memory.json'),raw=JSON.parse(readFileSync(path,'utf8'));raw.guides[0].text='a'.repeat(500);writeFileSync(path,JSON.stringify(raw));
 assert.equal(new ExperienceMemory(dir,'Bob/test').retrieve()[0].text.length,500);
});
test('runtime invokes maintenance without new pending episodes',async t=>{
 const {m}=fixture(t),a=m.add(record());m.apply(m.reflection(),[draft(a)]);m.needsMaintenance=()=>true;let calls=0;
 const r=new Runtime(new MockWorld(),{plan:()=>new Promise<any>(()=>{}),choose:async()=>({action:'idle',confidence:1}),reflect:async input=>{calls++;assert.equal(input.guides.length,1);return [];}},{planMs:30000,actionMs:1000,minConfidence:0,memory:m},()=>{});
 await r.reflectMemory(true);r.close();assert.equal(calls,1);assert.equal(m.pending(),0);
});
