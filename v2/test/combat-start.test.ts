import test from 'node:test';
import assert from 'node:assert/strict';
import {CombatStart} from '../src/combat-start.js';
const zombie=(x=33.5,id=1)=>({id,kind:'zombie',position:{x,y:-60,z:.5},distance:5});
test('no target and stationary zombie never start paid decision; visible motion starts once',()=>{
 const t=new CombatStart();assert.equal(t.update([]),'waiting');assert.equal(t.update([zombie()]),'armed');
 for(let i=0;i<20;i++)assert.equal(t.update([zombie(33.51)]),'armed');
 assert.equal(t.update([zombie(33.3)]),'start');assert.equal(t.update([zombie(33)]),'running');
});
test('vertical settling does not trigger but cumulative horizontal displacement does',()=>{
 const t=new CombatStart();t.update([zombie()]);const e=zombie();e.position.y=-59.8;
 assert.equal(t.update([e]),'armed');assert.equal(t.update([zombie(33.4)]),'armed');assert.equal(t.update([zombie(33.3)]),'start');
});
test('lost, replaced or ambiguous target fails closed instead of launching a decision',()=>{
 for(const enemies of [[],[zombie(33.3,2)],[zombie(),zombie(34,2)],[{...zombie(),kind:'skeleton'}]]){
  const t=new CombatStart();t.update([zombie()]);assert.throws(()=>t.update(enemies));
 }
});
