import test from 'node:test';import assert from 'node:assert/strict';
import {RecipeBook} from '../src/recipe-book.js';
test('without the declared catalog, unlocked names remain the only gate instead of hiding every recipe',()=>{
 const b=new RecipeBook();b.apply({action:0,recipes1:['minecraft:white_bed']});
 assert.equal(b.catalogSize,0);assert.equal(b.permits({result:{id:1,count:1},requiresTable:true,delta:[{id:2,count:-3}]}),true);
 b.declare({recipes:[{name:'minecraft:white_bed',type:'minecraft:crafting_shaped',data:{result:{itemId:99,itemCount:1},gridWidth:3,gridHeight:2,ingredients:[]}}]});
 assert.equal(b.catalogSize,1);assert.equal(b.permits({result:{id:1,count:1},requiresTable:true,delta:[{id:2,count:-3}]}),false,'with a catalog, variants are checked again');
});
