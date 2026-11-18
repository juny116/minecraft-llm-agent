import test from 'node:test';import assert from 'node:assert/strict';import {completionBoundary} from '../src/supervision.js';import {MineflayerWorld} from '../src/mineflayer.js';import {pilotStopReason} from '../src/pilot.js';
test('completion grace is phase-aware and expires rather than locking an entire slow attempt',()=>{
 assert.equal(completionBoundary({phase:'digging',phaseElapsedMs:3000,estimatedDigMs:60000,blockBroken:false}),false);
 assert.equal(completionBoundary({phase:'digging',phaseElapsedMs:59000,estimatedDigMs:60000,blockBroken:false}),true);
 assert.equal(completionBoundary({phase:'digging',phaseElapsedMs:61000,estimatedDigMs:60000,blockBroken:false}),false);
 assert.equal(completionBoundary({phase:'collecting',phaseElapsedMs:1000,blockBroken:true}),true);
 assert.equal(completionBoundary({phase:'collecting',phaseElapsedMs:2300,blockBroken:true}),false);
 assert.equal(completionBoundary({phase:'prepare',phaseElapsedMs:1,blockBroken:false}),false);
});
test('motor telemetry is a fresh elapsed snapshot, not a mutable exposed internal object',()=>{
 const w=Object.create(MineflayerWorld.prototype) as any;w.motor={phase:'digging',at:Date.now()-120,estimatedDigMs:3000,blockBroken:false};const a=w.executionProgress();assert.ok(a.phaseElapsedMs>=120);a.phase='collecting';assert.equal(w.executionProgress().phase,'digging');w.motor=undefined;assert.equal(w.executionProgress(),undefined);
});
test('repeated rejected goal reviews cannot be masked by camera novelty in the pilot',()=>{
 const s={elapsedMs:30000,maxMs:900000,authorizedMaxMs:900000,states:[{ready:true,health:20}],budgetExhausted:false,noProgressMs:0,consecutiveFailures:0,agentNoProgressMs:[0]};
 assert.equal(pilotStopReason({...s,agentGoalValidationFailures:[4]}),null);assert.equal(pilotStopReason({...s,agentGoalValidationFailures:[5]}),'goal_validation_stalled');
});
