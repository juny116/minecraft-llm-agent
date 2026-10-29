import test from 'node:test';import assert from 'node:assert/strict';
import {equipmentChoices,equipmentRequest,defaultEquipmentDestination,validateEquip} from '../src/equipment.js';
test('body slots are automatic and only ordinary items offer off-hand variants',()=>{
 for(const [name,destination] of [['iron_helmet','head'],['turtle_helmet','head'],['carved_pumpkin','head'],['elytra','torso'],['iron_chestplate','torso'],['iron_leggings','legs'],['iron_boots','feet'],['shield','hand'],['bread','hand']]){
  assert.equal(defaultEquipmentDestination(name),destination);
  const choices=equipmentChoices([{slot:9,name}]).filter(c=>c[1]!==null);
  assert.deepEqual(choices,destination==='hand'?[[9,name,'default'],[9,name,'off-hand']]:[[9,name,'default']]);
  for(const c of choices)validateEquip(equipmentRequest(c));
 }
});
test('full inventory remains within one Choice, preserves exact duplicate-name stacks and all removals',()=>{
 const inventory=Array.from({length:41},(_,i)=>({slot:i+5,name:'iron_sword'}));
 const choices=equipmentChoices([...inventory,{slot:0,name:'diamond'},{slot:46,name:'stone'},{slot:9.5,name:'dirt'},inventory[0]]);
 assert.equal(choices.length,88);assert.equal(choices.filter(c=>c[1]===null).length,6);
 for(const i of inventory)for(const mode of ['default','off-hand'])assert.ok(choices.some(c=>c[0]===i.slot&&c[2]===mode));
 assert.deepEqual(equipmentChoices(),['hand','off-hand','head','torso','legs','feet'].map(d=>[-1,null,d]));
});
