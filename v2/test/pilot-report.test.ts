import test from 'node:test';import assert from 'node:assert/strict';
import {summarizePilot} from '../src/pilot-report.js';
test('report distinguishes substantive progress from looking and removes private content',()=>{
 const e=(at:number,event:string,data:any)=>({at,bot:'PrivatePlayer',event,data});
 const record=(action:string,outcome:string)=>({decision:{action},outcome,before:{health:20},after:{health:19},changes:{inventory:{oak_log:1},position:{from:{x:100,y:0,z:0},to:{x:103,y:0,z:0}}},result:'private message'});
 const r=summarizePilot([e(0,'initial_observation',{observation:{health:20}}),e(1,'action_record',{record:record('look','succeeded')}),e(2,'action_record',{record:record('mine','failed')}),e(3,'social_speech',{sent:false,reason:'no_new_report_evidence',text:'private message'}),e(300000,'final_observation',{observation:{health:19}})]);
 assert.equal(r.agents[0].durationSeconds,300);assert.equal(r.agents[0].substantiveSuccesses,0);assert.equal(r.agents[0].minimumObservedHealth,19);assert.equal(r.agents[0].actions.mine.failed,1);assert.equal(r.agents[0].suppressedDuplicateReports,1);
 assert.ok(!JSON.stringify(r).includes('PrivatePlayer'));assert.ok(!JSON.stringify(r).includes('private message'));
});

test('no-op movement never counts as substantive progress',async()=>{
 const {noOpMove}=await import('../src/pilot-report.js');const r={decision:{action:'move'},outcome:'succeeded',changes:{position:{from:{x:-1.5,y:1,z:-1.5},to:{x:-1.5,y:1,z:-1.5}}}};
 assert.equal(noOpMove(r),true);r.changes.position.to.x=-.5;assert.equal(noOpMove(r),false);
});
