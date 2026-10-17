import test from 'node:test';import assert from 'node:assert/strict';
import {GoalBook,validateGoalUpdates} from '../src/goals.js';import {MockWorld} from '../src/mock.js';import {SocialMemory} from '../src/social.js';import {ProgressTracker} from '../src/progress.js';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
test('accepted social message can ground a goal, survives restart, but invented IDs cannot',t=>{
 const dir=mkdtempSync(join(tmpdir(),'goal-social-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const social=new SocialMemory('Alice');social.ingest([{id:'proposal-1',speaker:'Bob',text:'같이 나무를 모으자',at:1}]);
 const sent=social.send({to:'Bob',kind:'accept',text:'좋아요',replyTo:'proposal-1',promise:{id:'wood',task:'모으기',action:'mine',status:'accepted'}},()=>{},10000);assert.ok(sent.sent);
 const id=(sent as any).event.id;const s=new MockWorld().snapshot();s.social=social.context();
 const b=new GoalBook(join(dir,'goals.json'),'test'),review=b.review(s,null),g={id:'gather_wood',description:'Gather nearby wood',reason:'Accepted proposal',status:'active',successCriteria:'Collect reachable wood',evidenceIds:[review.observationId,id]};
 assert.throws(()=>b.apply(review,[{...g,evidenceIds:[review.observationId,'invented']}],g.id));
 b.apply(review,[g],g.id);const restored=new GoalBook(join(dir,'goals.json'),'test');assert.equal(restored.snapshot().goals[0].evidenceIds[1],id);assert.equal(restored.needsReview,true);
 const evidence=review.evidence.find(e=>e.id===id)!;assert.equal(evidence.kind,'social');assert.match(JSON.stringify(evidence.data),/self_statement/);
 const again=restored.review(s,null);assert.ok(again.evidence.some(e=>e.id===id));assert.ok(again.evidence.some(e=>e.id==='proposal-1'));assert.match(JSON.stringify(again.evidence.find(e=>e.id==='proposal-1')?.data),/heard_unverified/);
 restored.apply(again,[{...g,evidenceIds:[again.observationId,'proposal-1']}],g.id);
});
test('colon goal IDs return specific repair feedback',()=>{
 assert.throws(()=>validateGoalUpdates([{id:'goal:wood',description:'wood',reason:'visible',status:'active',successCriteria:'wood',evidenceIds:['obs']}]),/goal id.*letters.*digits/i);
});
test('new camera observations do not hide no-work immobility',()=>{
 const p=new ProgressTracker(),s=new MockWorld().snapshot();p.observe(s,0);
 for(let t=1000;t<=60000;t+=1000){s.vision={yaw:0,pitch:0,blocks:[{name:'oak_leaves',position:{x:t,y:64,z:0},lastSeen:t}]};p.observe(s,t);}
 assert.equal(p.context(60000).noProgressMs,60000);assert.equal(p.review(60000),'medium');
});
