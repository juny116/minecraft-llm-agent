import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeTables,decodeTables,encodeCriterion,decodeCriterion} from '../src/jev-table-codec.js';
import {jevLosslessRequest,decodeJevState,decodeJevQuestions} from '../src/jev-state.js';
const normalized=(x:any)=>JSON.parse(JSON.stringify(x));
test('homogeneous observed blocks and nested coordinates round-trip without removed facts',()=>{
 const blocks=Array.from({length:600},(_,i)=>({name:i%2?'oak_log':'stone',position:{x:i-300,y:-60,z:i%7},lastSeen:1234567890123}));
 const value={observation:{vision:{blocks}},other:{empty:{},nil:null,values:[false,0,'한국어']}};
 const encoded=encodeTables(value);
 assert.ok(JSON.stringify(encoded).length<JSON.stringify(value).length);
 assert.deepEqual(decodeTables(encoded),value);
 assert.equal(encoded.observation.vision.blocks.$jev_table.rows.length,600);
});
test('heterogeneous keys, empty objects and reserved marker objects round-trip',()=>{
 const data={varied:[{x:1},{x:1,y:2},null,{},[]],literal:{$jev_table:{columns:[['x']],rows:[[1]]}},other:{$jev_object:{a:1}},nested:[{a:{x:1},empty:{}},{empty:{},a:{x:2}}]};
 assert.deepEqual(decodeTables(encodeTables(data)),data);
 for(const small of [[{x:1}],[{x:1},{x:2}],[]])assert.ok(Buffer.byteLength(JSON.stringify(encodeTables(small)))<=Buffer.byteLength(JSON.stringify(small)));
});
test('property paths preserve literal dots and prototype-shaped keys as own data',()=>{
 const rows=Array.from({length:30},(_,i)=>JSON.parse('{"__proto__":{"polluted":'+i+'},"a.b":1,"constructor":{"x":2}}'));
 const decoded=decodeTables(encodeTables(rows));
 assert.deepEqual(decoded,rows);assert.equal(({} as any).polluted,undefined);assert.ok(Object.hasOwn(decoded[0],'__proto__'));
});
test('criterion encoding keeps answer IDs and all coordinates, with exact decode',()=>{
 const values=Array.from({length:600},(_,i)=>({x:i,y:64,z:i?-i:0}));
 const criterion={description:'Choose a supplied observed coordinate',values};
 const encoded=encodeCriterion(criterion);
 assert.equal(typeof encoded,'string');assert.ok(encoded.startsWith('JEV_JSON:'));
 assert.deepEqual(decodeCriterion(encoded),criterion);
 assert.equal(decodeCriterion(encodeCriterion('JEV_JSON:literal text')),'JEV_JSON:literal text');
 const state={observation:{targets:values},__jevEncoding:{userData:true}};
 const questions={destination:{type:'choice',instructions:'Choose',criteria:{group_0:criterion,revise:'Withdraw'}}};
 const request=jevLosslessRequest(state,questions);
 assert.deepEqual(decodeJevState(request.state),state);assert.deepEqual(decodeJevQuestions(request.questions),questions);
 assert.deepEqual(Object.keys(request.questions.destination.criteria),['group_0','revise']);
});
test('JSON wire facts round-trip while undefined remains omitted by JSON semantics',()=>{
 const state={observation:undefined,plan:{goal:'observe',optional:undefined},items:Array.from({length:20},(_,i)=>({name:'stone',count:i,optional:undefined})),nil:[undefined,-0]};
 const q={action:{type:'choice',criteria:{look:'Observe',wait:'Wait'},instructions:'Choose'}};
 const wire=JSON.parse(JSON.stringify(jevLosslessRequest(state,q)));
 assert.deepEqual(decodeJevState(wire.state),normalized(state));assert.deepEqual(decodeJevQuestions(wire.questions),q);
});
