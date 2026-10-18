import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeActivity} from '../src/activity-metrics.js';
test('idle, no executor, look and working time are disjoint; model overlap is not added',()=>{
 const e=(at:number,activeAction:string|null)=>({at,bot:'bot',event:'activity_sample',data:{activeAction,selectorPending:true,mediumPending:true}});
 const events=[{at:0,bot:'run',event:'started',data:{}},e(100,null),e(700,'idle'),e(1100,'look'),e(1600,'mine'),{at:2000,bot:'run',event:'stopped',data:{}}];
 const r=summarizeActivity(events,'bot')!;assert.equal(r.seconds.noAction,.6);assert.equal(r.seconds.idle,.4);assert.equal(r.seconds.look,.5);assert.equal(r.seconds.work,.4);assert.ok(Math.abs(r.seconds.unobserved-.1)<1e-9);assert.equal(r.noActionModelPendingSeconds.medium,.6);
});
test('sampling gaps are unknown, not falsely counted as work; failed startup is not a run',()=>{
 assert.equal(summarizeActivity([{at:100,bot:'run',event:'stopped',data:{}}],'bot'),null);
 const r=summarizeActivity([{at:0,bot:'run',event:'started',data:{}},{at:100,bot:'bot',event:'activity_sample',data:{activeAction:'mine'}},{at:10000,bot:'run',event:'stopped',data:{}}],'bot')!;
 assert.equal(r.seconds.work,1);assert.equal(r.seconds.unobserved,9);
});
