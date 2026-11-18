import test from 'node:test';import assert from 'node:assert/strict';
import {fastRaycast} from '../src/fast-raycast.js';

const full=[[0,0,0,1,1,1]],slab=[[0,0,0,1,.5,1]];
const world=(cells:Record<string,{name:string;shapes:number[][]}>)=>(x:number,y:number,z:number)=>cells[`${x},${y},${z}`]??{name:'air',shapes:[]};

test('first solid cell along the ray is returned, within range only',()=>{
 const look=world({'3,0,0':{name:'stone',shapes:full},'5,0,0':{name:'dirt',shapes:full}});
 assert.deepEqual(fastRaycast({x:.5,y:.5,z:.5},{x:1,y:0,z:0},10,look),{name:'stone',position:{x:3,y:0,z:0}});
 assert.equal(fastRaycast({x:.5,y:.5,z:.5},{x:1,y:0,z:0},2.4,look),null);
});
test('partial shapes are hit only where the ray passes through them; unloaded cells are passed through',()=>{
 const look=world({'2,0,0':{name:'oak_slab',shapes:slab},'4,0,0':{name:'stone',shapes:full}});
 assert.equal(fastRaycast({x:.5,y:.75,z:.5},{x:1,y:0,z:0},10,look)?.name,'stone','ray above the slab');
 assert.equal(fastRaycast({x:.5,y:.25,z:.5},{x:1,y:0,z:0},10,look)?.name,'oak_slab');
 const unloaded=(x:number,y:number,z:number)=>x===2?null:look(x,y,z);
 assert.equal(fastRaycast({x:.5,y:.25,z:.5},{x:1,y:0,z:0},10,unloaded)?.name,'stone');
});
