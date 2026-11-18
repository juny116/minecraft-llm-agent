import test from 'node:test';
import assert from 'node:assert/strict';
import {localNavigationTargets} from '../src/navigation.js';
import {knownDestination} from '../src/types.js';
test('movement hints contain only observed cells with confirmed local routes, bounded by direction and distance',()=>{
 const seen=[{name:'stone',position:{x:5,y:64,z:0},lastSeen:1},{name:'stone',position:{x:-5,y:64,z:0},lastSeen:1},{name:'water',position:{x:0,y:64,z:6},lastSeen:1},{name:'oak_log',position:{x:0,y:80,z:5},lastSeen:1}];
 const hints=localNavigationTargets({x:0,y:64,z:0},seen,p=>p.x>0);assert.deepEqual(hints,[seen[0].position]);
 assert.equal(knownDestination({places:[],navigationTargets:hints},hints[0]),true);assert.equal(knownDestination({places:[],navigationTargets:hints},{x:100,y:64,z:100}),false);
 assert.deepEqual(localNavigationTargets({x:0,y:64,z:0},seen,()=>false),[]);
});
