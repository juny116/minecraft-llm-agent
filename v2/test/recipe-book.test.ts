import test from 'node:test';
import assert from 'node:assert/strict';
import {RecipeBook} from '../src/recipe-book.js';
import {ApiBrain,Budget} from '../src/providers.js';
import {config} from '../src/config.js';
import {MockWorld} from '../src/mock.js';

test('initial state, add/remove, replace, highlights and reconnect do not reveal locked recipes',()=>{
 const book=new RecipeBook();
 assert.deepEqual(book.snapshot(),{initialized:false,unlocked:[]});
 book.apply({action:1,recipes1:['premature']});assert.deepEqual(book.snapshot().unlocked,[]);
 book.apply({action:0,recipes1:['minecraft:oak_planks'],recipes2:['minecraft:diamond_sword']});
 assert.deepEqual(book.snapshot().unlocked,['minecraft:oak_planks']);
 book.apply({action:1,recipes1:['minecraft:stick','minecraft:stick']});
 book.apply({action:2,recipes1:['minecraft:oak_planks']});
 assert.deepEqual(book.snapshot().unlocked,['minecraft:stick']);
 book.apply({action:0,recipes1:['minecraft:chest']});
 assert.deepEqual(book.snapshot().unlocked,['minecraft:chest']);
 book.reset();assert.deepEqual(book.snapshot(),{initialized:false,unlocked:[]});
});

test('bots and observation copies have independent recipe books',()=>{
 const alice=new RecipeBook(),bob=new RecipeBook();
 alice.apply({action:0,recipes1:['minecraft:oak_planks']});bob.apply({action:0,recipes1:[]});
 alice.snapshot().unlocked.push('minecraft:diamond_sword');
 assert.deepEqual(alice.snapshot().unlocked,['minecraft:oak_planks']);
 assert.deepEqual(bob.snapshot().unlocked,[]);
});

test('both planner and JEV requests include only the observed unlocked recipe IDs',async()=>{
 const bodies:any[]=[];
 const transport=(async(_url:any,init:any)=>{
  const body=JSON.parse(init.body);bodies.push(body);
  return Response.json(body.questions?{answers:{action:{type:'choice',choice:'idle',confidence:1}},usage:{input_tokens:1,output_tokens:0}}
    :{choices:[{message:{content:'{"goal":"observe","preferred":"idle"}'}}],usage:{prompt_tokens:1,completion_tokens:1}});
 }) as typeof fetch;
 const c={...config(),llmKey:'test',jevKey:'test',mode:'jev' as const};
 const brain=new ApiBrain(c,new Budget(2,1),transport);const world=new MockWorld();
 world.state.recipeBook={initialized:true,unlocked:['minecraft:oak_planks']};
 const plan=await brain.plan(world.snapshot(),[],new AbortController().signal);
 await brain.choose(world.snapshot(),plan,['idle'],new AbortController().signal);
 for(const body of bodies){assert.ok(JSON.stringify(body).includes('minecraft:oak_planks'));assert.ok(!JSON.stringify(body).includes('minecraft:diamond_sword'));}
 assert.deepEqual(JSON.parse(bodies[0].messages[1].content).state.recipeBook,world.state.recipeBook);
 assert.deepEqual(bodies[1].state.observation.recipeBook,world.state.recipeBook);
});
