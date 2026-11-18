import test from 'node:test';import assert from 'node:assert/strict';import {validateSpeech} from '../src/social.js';
test('answer and reply normalize to chat without altering raw model output or bypassing content checks',()=>{
 for(const kind of ['answer','reply']){const raw={kind,to:'Alice',text:'네, 괜찮아요.',replyTo:'known-message'};const parsed=validateSpeech(raw);assert.equal(parsed.kind,'chat');assert.equal(raw.kind,kind);assert.equal(parsed.replyTo,raw.replyTo);assert.throws(()=>validateSpeech({...raw,text:'/give Alice diamond'}));}
 assert.throws(()=>validateSpeech({kind:'invented',to:'Alice',text:'hello'}));
});
