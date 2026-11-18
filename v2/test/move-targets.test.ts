import test from 'node:test';import assert from 'node:assert/strict';
import {moveTargets,coordinatesIn} from '../src/move-targets.js';
import {bindBoundedArguments} from '../src/bounded-arguments.js';
import {candidates} from '../src/types.js';
import {MockWorld} from '../src/mock.js';

function scene(){
 const s=new MockWorld().snapshot();s.position={x:0.5,y:64,z:0.5};s.perception={mode:'panorama'} as any;
 const floor=[];for(let x=-6;x<=32;x++)for(let z=-3;z<=6;z++)if(!(x===-3&&z===0))floor.push({name:'grass_block',position:{x,y:63,z}});
 s.vision={yaw:0,pitch:0,blocks:[...floor,{name:'oak_log',position:{x:30,y:64,z:0}},{name:'oak_log',position:{x:20,y:64,z:0}},{name:'stone',position:{x:-3,y:63,z:0}},{name:'crafting_table',position:{x:0,y:64,z:5}},{name:'sea_lantern',position:{x:2,y:69,z:0}}]} as any;
 s.animals=[{id:7,kind:'sheep',position:{x:8.3,y:64,z:-2.6},distance:8} as any];s.nearbyPlayers=[{name:'Haneul',position:{x:4.5,y:64,z:0.5}}];
 s.social={self:'Bob',heard:[{id:'m1',speaker:'Haneul',text:'우리 집 (100, 70, -20) 으로 와',at:1}]} as any;
 return s;
}
const scope=[{x:5,y:64,z:0},{x:-5,y:64,z:0},{x:0,y:64,z:5},{x:0,y:64,z:-5},{x:3,y:64,z:3}];

test('targets cover each known kind once, including out-of-scope blocks, plan and chat coordinates, and scope edges',()=>{
 const t=moveTargets(scene(),{goal:'Collect logs',preferred:'move',intent:{description:'Approach the log near (20,64,0)',desiredInventory:[],constraints:[]}},scope);
 const by=(k:string)=>t.filter(x=>x.kind===k);
 const blocks=Object.fromEntries(by('observed_block').map(x=>[x.label,x.position]));
 assert.deepEqual(blocks.oak_log,{x:20,y:64,z:0},'nearest cell per type');assert.deepEqual(blocks.crafting_table,{x:0,y:64,z:5});assert.ok(blocks.grass_block);
 assert.equal(blocks.sea_lantern,undefined,'ceiling light has no standing place within the arrival radius');
 assert.ok(by('entity').some(x=>x.label==='sheep #7')&&by('entity').some(x=>x.label==='player Haneul'));
 assert.deepEqual(by('plan_coordinate').map(x=>x.position),[{x:20,y:64,z:0}]);
 assert.deepEqual(by('chat_coordinate').map(x=>[x.position,x.source]),[[{x:100,y:70,z:-20},'chat message m1; unverified claim']]);
 assert.ok(by('scope_edge').length>=4);assert.equal(t.at(-1)!.kind,'other_coordinate');
 assert.deepEqual(coordinatesIn('go to 3, -60, 65 then (1.9,2,3)'),[{x:3,y:-60,z:65},{x:1,y:2,z:3}]);
});

test('choosing a target goes all the way; other_coordinate opens the exact cell list',async()=>{
 const s=scene();const asked:string[]=[];
 const pickTarget=(choose:(vs:any[])=>any)=>async(name:string,values:any[])=>{asked.push(name);return choose(values);};
 const far=await bindBoundedArguments(s,'move',pickTarget(vs=>vs.find((v:any)=>v.kind==='chat_coordinate')??vs[0]) as any,async()=>[],undefined);
 assert.deepEqual(far.destination,{x:100,y:70,z:-20});assert.equal(far.destinationTarget?.kind,'chat_coordinate');
 assert.ok(candidates(s,{goal:'g',preferred:'move',...far} as any).includes('move'),'referenced destination is executable without a remembered cell');
 asked.length=0;
 const exact=await bindBoundedArguments(s,'move',pickTarget(vs=>vs.find((v:any)=>v.kind==='other_coordinate')??vs.at(-1)) as any,async()=>[],undefined);
 assert.equal(asked.join(','),'destination,destinationCoordinate');assert.equal(exact.destinationTarget,undefined);
});

test('placement sites are offered by known anchors with an exact-site fallback',async()=>{
 const {placementTargets}=await import('../src/move-targets.js');
 const s=scene();const sites=[{position:{x:4,y:64,z:1},reference:{x:4,y:63,z:1}},{position:{x:0,y:64,z:4},reference:{x:0,y:63,z:4}},{position:{x:-4,y:64,z:0},reference:{x:-4,y:63,z:0}}];
 const t=placementTargets(s,undefined,sites);
 assert.deepEqual(t.find(x=>x.label==='next to player Haneul')?.site?.position,{x:4,y:64,z:1});
 assert.deepEqual(t.find(x=>x.label.startsWith('next to crafting_table'))?.site?.position,{x:0,y:64,z:4});
 assert.equal(t.at(-1)!.kind,'other_site');assert.ok(t.length<sites.length+6);
});

test('mining targets are one option per block type with an exact-cell fallback',async()=>{
 const {mineTargets}=await import('../src/move-targets.js');
 const s=scene();const blocks=[{name:'stone',position:{x:3,y:63,z:0}},{name:'stone',position:{x:1,y:63,z:0}},{name:'white_bed',position:{x:2,y:64,z:2}},{name:'oak_log',position:{x:6,y:64,z:0}}];
 const t=mineTargets(s,blocks);
 assert.deepEqual(t.filter(x=>x.kind==='block_type').map(x=>[x.label,x.count,x.block!.position]),[['oak_log',1,{x:6,y:64,z:0}],['stone',2,{x:1,y:63,z:0}],['white_bed',1,{x:2,y:64,z:2}]]);
 assert.equal(t.at(-1)!.kind,'other_block');
});

test('anchors prefer a floor-supported site, and a bed maps a side-attached site to the floor below it',async()=>{
 const {placementTargets}=await import('../src/move-targets.js');
 const s=scene();s.placeableItems=['white_bed'];s.inventory=[{name:'white_bed',count:1,slot:36}] as any;
 // Side-attached site next to the table is nearer than the floor site; LONG1 offered the side one and every bed placement failed.
 const sites=[{position:{x:0,y:64,z:4},reference:{x:1,y:64,z:4}},{position:{x:1,y:64,z:4},reference:{x:1,y:63,z:4}},{position:{x:0,y:64,z:4},reference:{x:0,y:63,z:4}}];
 assert.deepEqual(placementTargets(s,undefined,[sites[0],sites[1]]).find(x=>x.label.startsWith('next to crafting_table'))?.site?.reference,{x:1,y:63,z:4});
 s.placementSites=sites;const side={kind:'next_to',label:'side',site:sites[0]};
 const r=await bindBoundedArguments(s,'place_block',async(_n:string,vs:any[])=>vs[0],async(qs:any[])=>qs.map((q:any)=>q.name==='blockItem'?'white_bed':q.name==='placementSite'?side:'north'),undefined);
 assert.deepEqual(r.build,{item:'white_bed',position:{x:0,y:64,z:4},reference:{x:0,y:63,z:4},facing:'north'});
});
