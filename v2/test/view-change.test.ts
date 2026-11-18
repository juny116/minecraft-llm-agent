import test from 'node:test';
import assert from 'node:assert/strict';
import {viewChange} from '../src/view-change.js';
import {MockWorld} from '../src/mock.js';

test('same-direction look exposes zero turn and zero newly visible blocks',()=>{
 const before=new MockWorld().snapshot(),after=structuredClone(before);
 const change=viewChange(before,after)!;
 assert.equal(change.camera.yawDeltaDegrees,0);assert.equal(change.camera.pitchDeltaDegrees,0);
 assert.equal(change.visibleBlocks.enteredCount,0);assert.equal(change.visibleBlocks.leftCount,0);
});
test('actual camera wrap and changed visible blocks are factual without asserting discovery',()=>{
 const before=new MockWorld().snapshot(),after=structuredClone(before);
 before.vision!.yaw=359*Math.PI/180;after.vision!.yaw=Math.PI/180;after.vision!.pitch=-Math.PI/4;
 after.vision!.blocks=[{name:'stone',position:{x:99,y:64,z:99},lastSeen:1}];
 const change=viewChange(before,after)!;
 assert.ok(Math.abs(change.camera.yawDeltaDegrees-2)<1e-8);
 assert.equal(change.visibleBlocks.enteredCount,1);
 assert.equal(change.visibleBlocks.leftCount,before.vision!.blocks.length);
 assert.match(change.meaning,/not guaranteed/);
});
