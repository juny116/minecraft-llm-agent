import test from 'node:test';import assert from 'node:assert/strict';import {craftFailure} from '../src/craft-feedback.js';
test('locked recipes reveal no static ingredients; unlocked recipes report measured shortages',()=>{
 let calls=0;const bot:any={registry:{itemsByName:{wooden_pickaxe:{id:1}},items:{2:{name:'stick'},3:{name:'oak_planks'}}},inventory:{count:(id:number)=>id===2?1:3},recipesAll:()=>{calls++;return [{delta:[{id:2,count:-2,metadata:null},{id:3,count:-3,metadata:null},{id:1,count:1,metadata:null}]}];}};
 const r={item:'wooden_pickaxe',count:1};assert.match(craftFailure(bot,r,[],{} as any),/not unlocked/);assert.equal(calls,0);
 assert.match(craftFailure(bot,r,['minecraft:wooden_pickaxe'],{} as any),/stick x1; table visible/);
 assert.match(craftFailure(bot,{...r,count:2},['wooden_pickaxe'],{} as any),/stick x3, oak_planks x3/);
 bot.recipesAll=()=>[{requiresTable:true,delta:[]}];assert.match(craftFailure(bot,r,['wooden_pickaxe'],null),/Missing visible crafting table/);
 bot.recipesAll=()=>[];assert.match(craftFailure(bot,r,['wooden_pickaxe'],null),/Missing supported unlocked recipe/);
});
