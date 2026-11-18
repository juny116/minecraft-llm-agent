import test from 'node:test';
import assert from 'node:assert/strict';
import {tableSupportMaterial} from '../src/building.js';
import {parsePlan} from '../src/providers.js';
test('table placement supports ordinary terrain and canopy without fluids or interactive blocks',()=>{
 for(const n of ['oak_leaves','jungle_leaves','jungle_planks','andesite','bedrock','dirt'])assert.equal(tableSupportMaterial(n),true,n);
 for(const n of ['water','lava','air','chest','tall_grass'])assert.equal(tableSupportMaterial(n),false,n);
});
test('empty optional look means default scan without mutating model output; partial angles still reject',()=>{
 const raw={goal:'Observe',preferred:'look',steps:[{id:'scan',description:'Inspect',action:'look',look:{},completion:{kind:'action_success'}}]};
 const p=parsePlan(raw);assert.equal(p.look,undefined);assert.equal(p.steps![0].look,undefined);assert.deepEqual(raw.steps[0].look,{});
 assert.throws(()=>parsePlan({goal:'Observe',preferred:'look',look:{yaw:0}}),/Invalid look/);
 assert.throws(()=>parsePlan({goal:'Observe',preferred:'look',look:{yaw:0,pitch:99}}),/Invalid look/);
});
