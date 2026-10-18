import test from 'node:test';import assert from 'node:assert/strict';
import {lookFeedbackRequest} from '../src/look-feedback.js';
import {jevLosslessRequest,decodeJevState,decodeJevQuestions} from '../src/jev-state.js';
const questions={action:{type:'choice' as const,instructions:'Choose',criteria:{look:'look',move:'move',wait:'wait'}}};
test('look feedback exposes zero change without removing choices or replacing original evidence',()=>{
 const view={camera:{yawDeltaDegrees:0,pitchDeltaDegrees:0},visibleBlocks:{enteredCount:0,leftCount:0}};
 const c={observation:{vision:{yaw:1,pitch:0,blocks:[]}},recentOutcome:{id:5,decision:{action:'look'},changes:{view}},recentLookResults:[{id:4,outcome:'succeeded',view},{id:5,outcome:'succeeded',view}]};
 const before=structuredClone(c),out=lookFeedbackRequest(questions,c);
 assert.deepEqual(c,before);assert.deepEqual(Object.keys(out.questions.action.criteria),Object.keys(questions.action.criteria));assert.deepEqual(out.context.recentOutcome,c.recentOutcome);
 assert.equal(out.context.lookFeedback.recentLooks.length,2);assert.equal(out.context.lookFeedback.recentLooks[1].view.camera.yawDeltaDegrees,0);
 const packed=jevLosslessRequest(out.context,out.questions);assert.deepEqual(decodeJevState(packed.state),JSON.parse(JSON.stringify(out.context)));assert.deepEqual(decodeJevQuestions(packed.questions),out.questions);
});
test('unknown view is not reported as unchanged; all angle choices and withdrawal remain untouched',()=>{
 const q={yawDegrees:{type:'choice' as const,instructions:'choose',criteria:{value_0:'0',value_90:'90',revise:'withdraw'}}};
 const out=lookFeedbackRequest(q,{recentOutcome:{id:1,decision:{action:'look'},outcome:'cancelled'}});
 assert.deepEqual(out.questions,q);assert.equal(out.context.lookFeedback.recentLooks[0].view,undefined);assert.equal(out.context.lookFeedback.currentCamera,null);
});
