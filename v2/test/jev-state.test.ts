import test from 'node:test';import assert from 'node:assert/strict';import {encodeJevState,decodeJevState} from '../src/jev-state.js';import {selectValue} from '../src/parameter-supervisor.js';
test('JEV JSON encoding retains every coordinate, timestamp, guide, dialogue and map record',()=>{
 const state={observation:{vision:{blocks:Array.from({length:1024},(_,i)=>({name:'stone',position:{x:i,y:64,z:-i},lastSeen:10000+i}))},inventory:[{name:'bread',count:3,slot:9}],importantPlaces:Array.from({length:80},(_,i)=>({id:'base'+i,position:{x:i,y:64,z:100},reason:'model evidence',status:'historical'}))},dialogue:{messages:[{text:'do not discard this',at:9}],aliases:['앨리스']},guidance:['experience rule'],selectedAction:'move'};
 const packed=encodeJevState(state);assert.deepEqual(decodeJevState(packed),JSON.parse(JSON.stringify(state)));assert.equal(packed,JSON.stringify(state));
});
test('bounded branching preserves all 5000 argument values without selection ranking',async()=>{
 const values=Array.from({length:5000},(_,i)=>({x:i,y:64,z:0}));let calls=0;
 const v=await selectValue('destination',values,async(q,c)=>{calls++;const question=q.destination;assert.ok(Object.keys(question.criteria).length<=33);const wanted=4999;const k=Object.entries(question.criteria).find(([k,v])=>typeof v!=='string'&&(k.startsWith('group_')?((v as any).summary ? (v as any).summary.bounds.x[0]<=wanted&&(v as any).summary.bounds.x[1]>=wanted : v.values!.some((v:any)=>v.x===wanted)):(v.value as any).x===wanted))![0];return {destination:{type:'choice',choice:k,confidence:0}};},{selectedAction:'move'});
 assert.equal(v.x,4999);assert.equal(calls,4);
});
test('none remains a model choice even when the domain has feasible values',async()=>{await assert.rejects(selectValue('item',['bread','stone'],async()=>({item:{type:'choice',choice:'none',confidence:1}}),{selectedAction:'give'}),/No suitable item/);});


import {jevStateForRequest} from '../src/jev-state.js';
test('large request serialization preserves full important map and recent evidence',()=>{
 const state={importantPlaces:Array.from({length:400},(_,i)=>({id:'place'+i,label:'Remembered site',position:{x:i,y:64,z:i},evidenceId:'observation'+i})),recentResults:[{result:'no drop observed'}],dialogue:{messages:[{text:'meet later'}]}};
 const wire=jevStateForRequest(state,{});assert.equal(typeof wire,'string');assert.deepEqual(decodeJevState(wire),state);assert.equal(decodeJevState(wire).importantPlaces.length,400);
 const small={importantPlaces:state.importantPlaces.slice(0,2)};assert.equal(jevStateForRequest(small,{}),small);
});

