import test from 'node:test';import assert from 'node:assert/strict';
import {feedbackView,outcomeView} from '../src/selector-context.js';

test('repeated withdrawals with moving candidates collapse to one entry with the latest offer',()=>{
 const ev=(id:number,x:number)=>({id,at:id,status:'unreviewed',feedback:JSON.stringify({reason:'Model withdrew selected action at target; return to action selection',attempt:{action:'attack',boundArguments:{},offeredArguments:[{name:'target',values:[{id:1,kind:'sheep',position:{x,y:64,z:0}}]}]}})});
 const view=feedbackView({history:[ev(1,1),ev(2,2)],current:ev(3,3)});
 assert.equal(view.entries.length,1);assert.equal(view.entries[0].count,3);assert.deepEqual(view.entries[0].ids,[1,2,3]);
 assert.match(JSON.stringify(view.entries[0].offeredArguments),/"x":3/);assert.equal(view.entries[0].distinctOffers,3);assert.match(view.entries[0].offerMeaning!,/3 different candidate sets/);
});

test('outcome view does not send a parsed copy of the result string',()=>{
 const r={id:1,decision:{action:'pickup'},outcome:'failed',result:'{"kind":"pickup","status":"failed"}',pickup:{kind:'pickup',status:'failed'},changes:{}};
 const v:any=outcomeView(r);assert.equal(v.pickup,undefined);assert.equal(v.result,r.result);
 assert.deepEqual((outcomeView({...r,result:undefined}) as any).pickup,r.pickup);
});
