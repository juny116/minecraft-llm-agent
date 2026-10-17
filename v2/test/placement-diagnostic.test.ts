import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBuild} from '../src/building.js';
test('identical placement and support cells produce actionable feedback without accepting plan',()=>{
 const p={x:1,y:64,z:1};assert.throws(()=>validateBuild({item:'cobblestone',position:p,reference:p}),/DIFFERENT.*Manhattan distance 1/);
 validateBuild({item:'cobblestone',position:{...p,y:65},reference:p});
});
test('fractional placement coordinates are rejected with integer-cell feedback',()=>{
 assert.throws(()=>validateBuild({item:'cobblestone',position:{x:1.5,y:65,z:1},reference:{x:1,y:64,z:1}}),/integer block cells/);
});
