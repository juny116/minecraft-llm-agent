import test from 'node:test';
import assert from 'node:assert/strict';
import {MineflayerWorld} from '../src/mineflayer.js';
test('observed-place merge is cached per observation but returned data remains isolated',()=>{
 const w:any=Object.create(MineflayerWorld.prototype);let reads=0,x=1;
 Object.assign(w,{observedAt:10,observationDimension:'overworld',knownCacheAt:-1,knownCacheDimension:'',knownCache:[],memory:{snapshot:()=>{reads++;return [{name:'stone',position:{x,y:64,z:0},lastSeen:10}];}}});
 const first=w.knownPlaces();first[0].position.x=99;assert.equal(w.knownPlaces()[0].position.x,1);assert.equal(reads,1);
 x=2;w.observedAt++;assert.equal(w.knownPlaces()[0].position.x,2);assert.equal(reads,2);
 w.observationDimension='nether';w.knownPlaces();assert.equal(reads,3);
});
