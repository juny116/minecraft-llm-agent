import test from 'node:test';import assert from 'node:assert/strict';
import {MineflayerWorld}from '../src/mineflayer.js';import {sampleView}from '../src/vision.js';import {lookFeedbackRequest}from '../src/look-feedback.js';
test('real look executor awaits camera then refreshes observation used by next model context',async()=>{
 const w=Object.create(MineflayerWorld.prototype)as any;const calls:string[]=[];let visible:any[]=[];
 w.bot={entity:{yaw:0,pitch:0},look:async(yaw:number,pitch:number)=>{await Promise.resolve();w.bot.entity.yaw=yaw;w.bot.entity.pitch=pitch;calls.push('look');}};
 w.stop=()=>{};w.observe=()=>{calls.push('observe');visible=sampleView(w.bot.entity.yaw,w.bot.entity.pitch,d=>({name:d.x<-.5?'oak_log':'stone',position:d.x<-.5?{x:-3,y:64,z:0}:{x:0,y:64,z:-3}}),1);};
 await w.execute('look',new AbortController().signal,{goal:'observe',preferred:'look',look:{yaw:Math.PI/2,pitch:0}});
 assert.ok(calls.indexOf('look')<calls.lastIndexOf('observe'));assert.ok(visible.some(b=>b.name==='oak_log'));
 const out=lookFeedbackRequest({},{observation:{vision:{...w.bot.entity,blocks:visible}}});assert.equal(out.context.lookFeedback.currentCamera?.yawRadians,Math.PI/2);assert.equal(out.context.lookFeedback.currentCamera?.visibleBlockCount,visible.length);
});
