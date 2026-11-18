import test from 'node:test';import assert from 'node:assert/strict';
import {fixRecipeTypeMapping,recipeTypeMapping} from '../src/protocol-fixes.js';
test('1.21.1 recipe serializer ids match the server registry (no banneraddpattern shift)',()=>{
 fixRecipeTypeMapping('1.21.1');fixRecipeTypeMapping('1.21.1');
 const m=recipeTypeMapping('1.21.1');
 assert.ok(!Object.values(m).includes('minecraft:crafting_special_banneraddpattern'));
 assert.equal(m['11'],'minecraft:crafting_special_shielddecoration');assert.equal(m['15'],'minecraft:smelting');assert.equal(m['22'],'minecraft:crafting_decorated_pot');
});
