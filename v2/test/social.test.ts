import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SocialMemory,validateSpeech} from '../src/social.js';
import {Runtime} from '../src/runtime.js';
import {MockWorld} from '../src/mock.js';
import {parsePlan} from '../src/providers.js';
test('hearsay stays attributed, deduplicated and durable without creating world facts',t=>{
 const dir=mkdtempSync(join(tmpdir(),'social-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'bob.json');
 const s=new SocialMemory('Bob',path),e={id:'heard1',at:1,speaker:'Alice',text:'저쪽에 나무 있어'};s.ingest([e,e]);
 const reloaded=new SocialMemory('Bob',path);assert.equal(reloaded.context().heard.length,1);assert.equal(reloaded.context().heard[0].source,'heard_unverified');assert.equal(reloaded.context().heard[0].speaker,'Alice');
});
test('unsolicited speech works but duplicates, fast loops, self-chat and slash commands are blocked',()=>{
 const s=new SocialMemory('Alice');let count=0;const speak=(text:string,at:number)=>s.send({to:'Bob',kind:'proposal',text},()=>count++,at);
 assert.equal(speak('주변을 살펴볼래?',10000).sent,true);assert.equal(speak('다른 말',10001).sent,false);assert.equal(speak('주변을 살펴볼래?',20000).sent,false);assert.equal(count,1);
 assert.throws(()=>validateSpeech({to:'all',kind:'chat',text:'/op Alice'}));assert.equal(s.send({to:'Alice',kind:'chat',text:'안녕'},()=>{},30000).sent,false);
});
test('acceptance needs an actual message; completion needs an executed successful action',()=>{
 const s=new SocialMemory('Bob'),promise={id:'wood',task:'나무 하나 모으기',action:'mine' as const,status:'accepted' as const};
 assert.equal(s.send({to:'Alice',kind:'accept',text:'내가 모을게',replyTo:'missing',promise},()=>{},10000).sent,false);
 s.ingest([{id:'ask',at:1,speaker:'Alice',text:'나무 하나 모아줄래?'}]);assert.equal(s.send({to:'Alice',kind:'accept',text:'내가 모을게',replyTo:'ask',promise},()=>{},10000).sent,true);
 assert.equal(s.send({to:'Alice',kind:'report',text:'다 했어',promise:{...promise,status:'completed',actionEvidence:'invented'}},()=>{},20000).sent,false);
});
test('planner speech schema is checked and retained',()=>{
 const speech={to:'Bob',kind:'proposal',text:'같이 주변을 살펴보자'};assert.deepEqual(parsePlan({goal:'주변 관찰',preferred:'look',speech}).speech,speech);
 assert.throws(()=>parsePlan({goal:'x',preferred:'idle',speech:{...speech,kind:'invented'}}));
});
test('two independent runtimes exchange a proposal and acceptance then execute, without shared world state',async()=>{
 const a=new MockWorld(),b=new MockWorld();a.state.chatEvents=[];b.state.chatEvents=[];
 let serial=0;a.chat=text=>{b.state.chatEvents!.push({id:'a'+serial++,at:Date.now(),speaker:'Alice',text});b.state.messages.push('Alice: '+text);};
 b.chat=text=>{a.state.chatEvents!.push({id:'b'+serial++,at:Date.now(),speaker:'Bob',text});a.state.messages.push('Bob: '+text);};
 const sa=new SocialMemory('Alice'),sb=new SocialMemory('Bob');let bobHeard=false,acted=false;
 const ra=new Runtime(a,{plan:async()=>({goal:'작업 제안',preferred:'idle',speech:{to:'Bob',kind:'proposal',text:'내가 주변을 볼게. 너는 나무 하나 모아볼래?'}}),choose:async()=>({action:'idle',confidence:.1})},{planMs:60000,actionMs:1000,minConfidence:.55,social:sa},()=>{});
 const rb=new Runtime(b,{plan:async s=>{const heard=s.social!.heard.find(e=>e.speaker==='Alice');bobHeard=!!heard;return {goal:'나무 하나 채집',preferred:'mine',mine:{position:{x:1,y:64,z:0},expected:'oak_log'},speech:{to:'Alice',kind:'accept',text:'좋아, 내가 나무 하나 모을게.',replyTo:heard!.id,promise:{id:'wood',task:'나무 하나',action:'mine',status:'accepted'}}};},choose:async s=>{assert.equal(s.social?.promises[0].status,'accepted');return {action:'mine',confidence:.1};}},{planMs:60000,actionMs:1000,minConfidence:.55,social:sb},()=>{});
 b.execute=async action=>{acted=action==='mine';b.state.logs++;return 'gathered one';};
 await ra.refreshPlan();await rb.refreshPlan();await rb.tick();await new Promise(r=>setTimeout(r,0));await rb.tick();
 assert.ok(bobHeard);assert.ok(acted);assert.equal(a.state.logs,0);assert.equal(b.state.logs,1);assert.equal(sb.context().promises[0].status,'accepted');ra.close();rb.close();
});

test('dedicated social decision initiates on visible contact without planner speech',async()=>{
 const w=new MockWorld();w.state.nearbyPlayers=[{name:'Bob',position:{x:2,y:64,z:0}}];let count=0,message='';w.chat=t=>{message=t;};
 const r=new Runtime(w,{plan:()=>new Promise<any>(()=>{}),choose:async()=>({action:'idle',confidence:1}),communicate:async s=>{count++;assert.equal(s.social?.self,'Alice');return {to:'Bob',kind:'proposal',text:'같이 주변 자원을 확인할래?'};}},{planMs:10000,actionMs:1000,minConfidence:.55,social:new SocialMemory('Alice')},()=>{});
 await r.tick();await new Promise(resolve=>setTimeout(resolve,0));assert.ok(message.includes('Bob'));await r.tick();assert.equal(count,1);r.close();
});
test('late speech after shutdown is discarded',async()=>{
 const w=new MockWorld();w.state.nearbyPlayers=[{name:'Bob',position:{x:2,y:64,z:0}}];let finish!:(v:any)=>void,count=0;w.chat=()=>count++;
 const r=new Runtime(w,{plan:()=>new Promise<any>(()=>{}),choose:async()=>({action:'idle',confidence:1}),communicate:()=>new Promise(resolve=>{finish=resolve;})},{planMs:10000,actionMs:1000,minConfidence:.55,social:new SocialMemory('Alice')},()=>{});
 await r.tick();r.close();finish({to:'Bob',kind:'chat',text:'hello'});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(count,0);
});
test('dedicated dialogue API uses limited attributed context, not another bot private state',async()=>{
 const {ApiBrain,Budget}=await import('../src/providers.js');const {config}=await import('../src/config.js');const w=new MockWorld(),social=new SocialMemory('Bob');
 social.ingest([{id:'question',at:1,speaker:'Alice',text:'뭐부터 할래?'}]);const s=w.snapshot();s.social=social.context();
 const brain=new ApiBrain({...config(),llmKey:'fake',mode:'jev'},new Budget(1,1),(async(_url:any,init:any)=>{const b=JSON.parse(init.body),data=JSON.parse(b.messages[1].content);assert.equal(data.state.social.heard[0].source,'heard_unverified');assert.equal(data.state.places,undefined);return Response.json({choices:[{message:{content:JSON.stringify({speech:{to:'Alice',kind:'question',replyTo:'question',text:'나무를 먼저 모아볼까?'}})}}],usage:{prompt_tokens:1,completion_tokens:1}});}) as typeof fetch);
 const reply=await brain.communicate(s,{goal:'주변 관찰',preferred:'look'},new AbortController().signal);assert.equal(reply?.replyTo,'question');
});

test('speech generated against an old intention is discarded after plan changes',async()=>{
 const w=new MockWorld();w.state.nearbyPlayers=[{name:'Bob',position:{x:2,y:64,z:0}}];let finish!:(v:any)=>void,count=0;w.chat=()=>count++;
 const r=new Runtime(w,{plan:()=>new Promise<any>(()=>{}),choose:async()=>({action:'idle',confidence:1}),communicate:()=>new Promise(resolve=>{finish=resolve;})},{planMs:10000,actionMs:1000,minConfidence:0,social:new SocialMemory('Alice')},()=>{});
 await r.tick();r.setGoal('Inspect surroundings');finish({to:'Bob',kind:'chat',text:'나무를 모을게.'});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(count,0);r.close();
});

test('reworded unsolicited reports need new evidence across reconnects; replies and proposals remain allowed',t=>{
 const dir=mkdtempSync(join(tmpdir(),'social-report-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=join(dir,'social.json');
 const a=new SocialMemory('Bob',file),out:string[]=[];
 assert.equal(a.send({to:'Alice',kind:'report',text:'판자 네 개가 있어.'},x=>out.push(x),100000,'same-state').sent,true);
 const b=new SocialMemory('Bob',file);
 assert.equal(b.send({to:'Alice',kind:'report',text:'내 판자는 총 네 개야.'},x=>out.push(x),110000,'same-state').reason,'no_new_report_evidence');
 assert.equal(b.send({to:'Alice',kind:'proposal',text:'같이 주변을 살펴볼까?'},x=>out.push(x),110000,'same-state').sent,true);
 b.ingest([{id:'q',at:111000,speaker:'Alice',text:'판자가 몇 개야?'}]);
 assert.equal(b.send({to:'Alice',kind:'report',replyTo:'q',text:'지금 네 개 있어.'},x=>out.push(x),120000,'same-state').sent,true);
 assert.equal(b.send({to:'Alice',kind:'report',text:'이제 다섯 개야.'},x=>out.push(x),130000,'changed-state').sent,true);
});
