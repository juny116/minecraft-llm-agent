import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleView, PlaceMemory, viewDirection} from '../src/vision.js';
import {parsePlan} from '../src/providers.js';
import {candidates} from '../src/types.js';
import {MockWorld} from '../src/mock.js';

test('perspective rays stay inside forward view and stop at the first occluder',()=>{
  let rays=0;
  const seen=sampleView(0,0,d=>{
    rays++; assert.ok(d.z<0); assert.ok(Math.abs(d.x/-d.z)<=1.00001);
    // A solid wall spans the view at z=-2; a resource behind it is never returned.
    return {name:'stone',position:{x:Math.floor(d.x*2/-d.z),y:Math.floor(d.y*2/-d.z),z:-2}};
  },100);
  assert.equal(rays,425);assert.ok(seen.length>1);assert.ok(seen.every(b=>b.name==='stone'));
  assert.ok(viewDirection(Math.PI,0).z>0);
});
test('memory survives turning away, timestamps updates, and isolates bots and snapshots',()=>{
 const a=new PlaceMemory(),b=new PlaceMemory();
 const block={name:'oak_log',position:{x:1,y:2,z:3},lastSeen:10};
 a.observe([block]);a.observe([]);assert.equal(a.snapshot()[0].lastSeen,10);
 a.snapshot()[0].name='diamond_block';assert.equal(a.snapshot()[0].name,'oak_log');
 a.observe([{...block,name:'air',lastSeen:20}]);assert.equal(a.snapshot().length,1);assert.equal(a.snapshot()[0].lastSeen,20);
 assert.deepEqual(b.snapshot(),[]);a.clear();assert.deepEqual(a.snapshot(),[]);
});
test('parameter validation and remembered-destination gating reject fabricated moves',()=>{
 assert.throws(()=>parsePlan({goal:'go',preferred:'move'}));
 assert.throws(()=>parsePlan({goal:'craft',preferred:'craft',craft:{item:'oak_planks',count:0}}));
 assert.throws(()=>parsePlan({goal:'look',preferred:'look',look:{yaw:0,pitch:10}}));
 const s=new MockWorld().snapshot();s.places=[{name:'chest',position:{x:1,y:2,z:3},lastSeen:1}];
 const p=parsePlan({goal:'go',preferred:'move',destination:{x:1,y:2,z:3}});
 assert.ok(candidates(s,p).includes('move'));p.destination!.x=100;assert.ok(!candidates(s,p).includes('move'));
});
