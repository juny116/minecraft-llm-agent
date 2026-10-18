import test from 'node:test';import assert from 'node:assert/strict';import {encodeTables,decodeTables} from '../src/jev-table-codec.js';
test('point encoding preserves full ordered domains and escapes literal markers',()=>{
 const points=Array.from({length:800},(_,i)=>({x:-500+i%40,y:65+Math.floor(i/40),z:-400}));
 const input={points,literal:{$jev_points:{origin:'user data'}},fractional:[{x:.1,y:2,z:3},{x:.2,y:2,z:3}]};
 const encoded=encodeTables(input);assert.deepEqual(decodeTables(encoded),input);assert.ok(JSON.stringify(encoded).length<JSON.stringify(input).length);assert.ok(encoded.points.$jev_points);
});
test('point decoder rejects invalid coordinates rather than inventing an argument',()=>{
 assert.throws(()=>decodeTables({$jev_points:{origin:[0,0,0],offsets:[[1,2]]}}),/Invalid/);
 const edge=[{x:Number.MAX_SAFE_INTEGER,y:0,z:0},{x:-Number.MAX_SAFE_INTEGER,y:0,z:0}];assert.deepEqual(decodeTables(encodeTables(edge)),edge);
});
