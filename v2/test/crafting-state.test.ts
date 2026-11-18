import test from 'node:test';import assert from 'node:assert/strict';
import {craftingState,feasibleExecutions,recipeExecutionCounts,recipeBatchAvailable} from '../src/crafting-state.js';
import {recipeKey,type RecipeFact} from '../src/procedure.js';
import {MockWorld} from '../src/mock.js';
import {parameterSupervise} from '../src/parameter-supervisor.js';import {directSelection} from '../src/direct-selection.js';
import {ApiBrain,Budget} from '../src/providers.js';import {config} from '../src/config.js';import {decodeReferenceRequest} from '../src/jev-references.js';
const fact=(item:string,ingredients:{item:string;count:number}[],output=1,requiresTable=true):RecipeFact=>{const r={item,output,requiresTable,ingredients};return {...r,key:recipeKey(r)};};
const bed=fact('white_bed',[{item:'white_wool',count:3},{item:'oak_planks',count:3}]);
const carpet=fact('white_carpet',[{item:'white_wool',count:2}],3,false);
function fixture(){const s=new MockWorld().snapshot();s.inventory=[{name:'white_wool',slot:9,count:3}];s.recipeBook={initialized:true,unlocked:['minecraft:white_bed','minecraft:white_carpet']};s.craftable=['white_carpet'];s.inventoryCraftable=['white_carpet'];s.crafting=craftingState(s,n=>[bed,carpet].filter(r=>r.item===n),n=>n==='white_carpet'?1:0);return s;}
const input:any={options:[],execution:null,inbox:[],goal:null,userRequest:'Make one white bed',parameterSelection:true};
test('unlocked deficits are explicit before selection and recomputed after consumption/acquisition',()=>{
 const s=fixture();const before=s.crafting!.recipes.find(r=>r.item==='white_bed')!;
 assert.equal(before.maxExecutions,0);assert.ok(before.variants[0].ingredients.some(i=>JSON.stringify(i.alternatives)===JSON.stringify([['oak_planks',0,3]])));
 s.inventory![0].count=1;s.inventory!.push({name:'oak_planks',slot:10,count:4},{name:'white_wool',slot:45,count:64});
 const after=craftingState(s,n=>[bed,carpet].filter(r=>r.item===n),()=>0).recipes.find(r=>r.item==='white_bed')!;
 assert.ok(after.variants[0].ingredients.some(i=>JSON.stringify(i.alternatives)===JSON.stringify([['white_wool',1,2]])));
 assert.ok(after.variants[0].ingredients.some(i=>JSON.stringify(i.alternatives)===JSON.stringify([['oak_planks',4,0]])));
 const calls:string[]=[];craftingState({...s,recipeBook:{initialized:true,unlocked:['minecraft:white_carpet']}},n=>{calls.push(n);return [bed,carpet];},()=>1);
 assert.deepEqual(calls,['white_carpet']);
});
test('variant compaction merges exact single axes without inventing correlated recipes',()=>{
 const s=fixture();const facts=[bed,fact('white_bed',[{item:'white_wool',count:3},{item:'birch_planks',count:3}])];
 const out=craftingState(s,()=>facts,()=>0).recipes[0];assert.equal(out.variants.length,1);assert.equal(out.variants[0].ingredients.find(i=>i.alternatives.some(a=>a[0]==='oak_planks'))!.alternatives.length,2);
 const correlated=[fact('white_bed',[{item:'a',count:1},{item:'b',count:2}]),fact('white_bed',[{item:'c',count:1},{item:'d',count:2}])];
 assert.equal(craftingState(s,()=>correlated,()=>0).recipes[0].variants.length,2);
});
test('affordable execution range is bounded by current feasibility, not constant 16 or output amount',()=>{
 for(const stock of [0,1,3,15,16,64])assert.equal(feasibleExecutions(n=>n<=stock),Math.min(stock,16));
 const s=fixture();assert.deepEqual(recipeExecutionCounts(s,'white_carpet'),[1]);assert.deepEqual(recipeExecutionCounts(s,'white_bed'),[]);
 s.crafting!.recipes[1].maxExecutions=3;assert.deepEqual(recipeExecutionCounts(s,'white_carpet'),[1,2,3]);
 s.crafting=undefined;assert.deepEqual(recipeExecutionCounts(s,'white_carpet'),[1]);
});
test('actual API encoding carries deficits on action and arguments; model can withdraw sole carpet option',async()=>{
 for(const contract of ['legacy','coordinated'] as const){
 const s=fixture();let calls=0;
 const b=new ApiBrain({...config(),mode:'jev',targetPolicy:'observed',withdrawalMode:'direct',argumentContract:contract,jevKey:'test'},new Budget(10,1),async(_u,init)=>{
  const body=JSON.parse(String(init?.body));const {context,questions}=decodeReferenceRequest(body.state,body.questions);calls++;
  assert.equal(context.observation.crafting,undefined,'recipe tables stay with the planning layers');if(questions.action)assert.match(JSON.stringify(questions.action.criteria.craft),/Craftable now: white_carpet/);assert.equal(context.userRequest,input.userRequest);
  if(questions.recipeOutput){assert.ok(questions.recipeOutput.criteria.revise);assert.ok(questions.recipeOutput.criteria.value_0);}
  return Response.json({answers:Object.fromEntries(Object.keys(questions).map(k=>[k,{type:'choice',choice:k==='action'?'craft':k==='review'?'none':'revise',confidence:.1}])),usage:{input_tokens:1,output_tokens:0}});
 });
 const out=await b.supervise(s,input,new AbortController().signal);assert.equal(calls,2);assert.equal(out.choice,'unresolved');assert.equal(out.selected,undefined);assert.equal(out.attempt?.unresolvedArgument?.name,'recipeOutput');
 }
});
test('batched count/workstation withdrawal invalidates whole craft; complete binding has no approval call',async()=>{
 for(const withdraw of [false,true]){
 const s=fixture();s.perception={mode:'panorama',range:48};s.craftable=['white_bed'];s.inventoryCraftable=[];s.crafting!.recipes[0].maxExecutions=1;
 s.vision={yaw:0,pitch:0,blocks:[{name:'crafting_table',position:{x:2,y:64,z:0},lastSeen:1}]};s.position={x:0,y:64,z:0};let calls=0;
 const result=await parameterSupervise(s,input,directSelection(async q=>{
  calls++;if(q.recipeExecutions)assert.deepEqual(Object.keys(q.recipeExecutions.criteria),['value_0','revise']);
  return Object.fromEntries(Object.keys(q).map(k=>[k,{type:'choice',choice:k==='action'?'craft':k==='review'?'none':k==='workstation'&&withdraw?'revise':'value_0',confidence:.1}]));
 }),'coordinated');
 assert.equal(calls,3);assert.equal(result.choice,withdraw?'unresolved':'selected');assert.equal(result.selected?.plan.craft?.count,withdraw?undefined:1);
 }
});

test('one log makes four output items but permits only one recipe execution',()=>{
 const recipe={result:{id:2,count:4},delta:[{id:1,count:-1},{id:2,count:4}]};
 assert.equal(feasibleExecutions(n=>recipeBatchAvailable(recipe,n,id=>id===1?1:0)),1);
 assert.equal(recipeBatchAvailable(recipe,4,id=>id===1?1:0),false);
 assert.equal(feasibleExecutions(n=>recipeBatchAvailable(recipe,n,id=>id===1?3:0)),3);
});
test('each ingredient group states whether it is covered, so plank alternatives are not read as a shortage',()=>{
 const planks=['acacia_planks','birch_planks','oak_planks','spruce_planks'];
 const multi:RecipeFact[]=planks.map(p=>fact('white_bed',[{item:'white_wool',count:3},{item:p,count:3}]));
 const s=new MockWorld().snapshot();s.inventory=[{name:'white_wool',slot:9,count:2},{name:'oak_planks',slot:10,count:4}];s.recipeBook={initialized:true,unlocked:['minecraft:white_bed']};
 const v=craftingState(s,()=>multi,()=>0).recipes[0].variants[0];
 const plankGroup=v.ingredients.find(g=>g.alternatives.length>1)!;
 assert.equal(plankGroup.satisfiedBy,'oak_planks');assert.equal(plankGroup.missing,0);
 assert.deepEqual(v.shortForOneExecution,[{count:3,missing:1,closest:'white_wool'}]);
});
test('craft action states what is craftable now and what a planned output still lacks',async()=>{
 const {craftableNowFact}=await import('../src/crafting-state.js');
 const s=new MockWorld().snapshot();s.inventory=[{name:'white_wool',slot:9,count:2},{name:'oak_planks',slot:10,count:4}];s.recipeBook={initialized:true,unlocked:['minecraft:white_bed','minecraft:white_carpet']};
 s.crafting=craftingState(s,n=>[bed,carpet].filter(r=>r.item===n),n=>n==='white_carpet'?1:0);s.craftable=['white_carpet'];
 assert.equal(craftableNowFact(s,{desiredInventory:[{item:'white_bed',count:1}]}),'Craftable now: white_carpet. Planned but not craftable now: white_bed (short: white_wool 1).');
 assert.equal(craftableNowFact({...s,craftable:[]}),'Craftable now: nothing.');
});

test('outputs named in the goal text count as planned before a task plan lists them',async()=>{
 const {craftableNowFact}=await import('../src/crafting-state.js');
 const s=new MockWorld().snapshot();s.inventory=[{name:'white_wool',slot:9,count:2},{name:'oak_planks',slot:10,count:4}];s.recipeBook={initialized:true,unlocked:['minecraft:white_bed','minecraft:white_carpet']};
 s.crafting=craftingState(s,n=>[bed,carpet].filter(r=>r.item===n),n=>n==='white_carpet'?1:0);s.craftable=['white_carpet'];
 assert.match(craftableNowFact(s,undefined,'Make a white bed and give it to Haneul'),/Planned but not craftable now: white_bed \(short: white_wool 1\)/);
});
