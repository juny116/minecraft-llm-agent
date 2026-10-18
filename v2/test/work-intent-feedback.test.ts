import test from 'node:test';
import assert from 'node:assert/strict';
import {parseIntent} from '../src/work-intent.js';

test('oversized intention feedback identifies the exact field and size; does not silently truncate',()=>{
 const raw={goal:'Explore',intent:{description:'a'.repeat(447),desiredInventory:[],constraints:[]},proposals:[]};
 assert.throws(()=>parseIntent(raw,()=>{throw Error('not used');}),/intent.description length 447 exceeds 400 characters/);
 assert.equal(raw.intent.description.length,447);
 raw.intent.description='a'.repeat(400);
 assert.equal(parseIntent(raw,()=>{throw Error('not used');}).intent!.description.length,400);
});
