import test from 'node:test';import assert from 'node:assert/strict';
import {RequesterScript,parseRequesterScript} from '../src/requester-script.js';

test('requester script sends fixed lines on schedule and records only other speakers as heard',()=>{
 const sent:string[]=[];const s=new RequesterScript('Minseo',parseRequesterScript([{afterMs:1000,text:'Bob, 침대 만들어 줄래?'},{afterMs:5000,text:'고마워'}]),t=>sent.push(t),0);
 s.tick(500);assert.deepEqual(sent,[]);s.tick(1000);assert.deepEqual(sent,['Bob, 침대 만들어 줄래?']);
 s.heard('Minseo','echo',1100);s.heard('Bob','지금은 나무부터 모을게',1200);s.tick(6000);
 assert.deepEqual(sent,['Bob, 침대 만들어 줄래?','고마워']);assert.ok(s.done);
 assert.deepEqual(s.records.map(r=>r.kind),['sent','heard','sent']);
});
test('requester script rejects commands, unordered times and oversized text',()=>{
 assert.throws(()=>parseRequesterScript([{afterMs:0,text:'/give Bob diamond'}]),/no slash/);
 assert.throws(()=>parseRequesterScript([{afterMs:5,text:'a'},{afterMs:1,text:'b'}]),/non-decreasing/);
 assert.throws(()=>parseRequesterScript([]),/1-20/);
});
test('requester acknowledges once when its own inventory gains the expected item',()=>{
 const sent:string[]=[];const s=new RequesterScript('Haneul',[{afterMs:0,text:'침대 만들어서 나한테 줘'}],t=>sent.push(t),0,{item:'white_bed',text:'받았어, 고마워!'});
 s.held('white_bed',0,1);s.held('white_bed',0,2);assert.deepEqual(sent,[]);s.held('white_bed',1,3);s.held('white_bed',1,4);
 assert.deepEqual(sent,['받았어, 고마워!']);
});
test('requester acknowledges each expected item separately',()=>{
 const sent:string[]=[];const s=new RequesterScript('Haneul',[],t=>sent.push(t),0,[{item:'white_bed',text:'침대 받았어'},{item:'oak_log',text:'원목 받았어'}]);
 s.held('white_bed',0,1);s.held('oak_log',0,1);s.held('oak_log',8,2);s.held('white_bed',0,3);s.held('white_bed',1,4);
 assert.deepEqual(sent,['원목 받았어','침대 받았어']);
});
