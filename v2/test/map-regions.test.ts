import test from 'node:test';import assert from 'node:assert/strict';
import {rectangles,rectCells,terrainAreas,placementRegions,regionSite,localPlacementSites,placementDomain} from '../src/map-regions.js';
import {sampleNearSurfaces,key,type Position,type SeenBlock} from '../src/vision.js';
import {MockWorld} from '../src/mock.js';import {spatialContext} from '../src/spatial-context.js';import {currentModelState} from '../src/selector-context.js';
import {parameterSupervise} from '../src/parameter-supervisor.js';import {directSelection} from '../src/direct-selection.js';
function world(){const blocks=new Map<string,{name:string;boundingBox:string}>();
 for(let x=-15;x<=15;x++)for(let z=-15;z<=15;z++)blocks.set(key({x,y:-1,z}),{name:x>=-2&&x<=2&&z>=8&&z<=10?'smooth_stone':'grass_block',boundingBox:'block'});
 const read=(p:Position)=>blocks.get(key(p))??{name:'air',boundingBox:'empty'};
 const eye={x:.5,y:1.62,z:.5};const cast=(d:Position,length:number)=>{for(let t=.005;t<=length;t+=.02){const p={x:Math.floor(eye.x+d.x*t),y:Math.floor(eye.y+d.y*t),z:Math.floor(eye.z+d.z*t)};if(blocks.has(key(p)))return p;}return null;};
 return {blocks,read,eye,cast};}
test('near target rays cover south floor skipped by angular sampling and do not reveal wall-hidden blocks',()=>{
 const w=world();let seen=sampleNearSurfaces(w.eye,w.read,w.cast,1);assert.equal(seen.filter(b=>b.name==='smooth_stone').length,15);
 for(let z=-4;z<=4;z++)for(let y=0;y<=4;y++)w.blocks.set(key({x:3,y,z}),{name:'stone',boundingBox:'block'});
 w.blocks.set('4,1,0',{name:'diamond_block',boundingBox:'block'});seen=sampleNearSurfaces(w.eye,w.read,w.cast,2);assert.ok(!seen.some(b=>b.name==='diamond_block'));assert.ok(seen.some(b=>b.name==='stone'));
});
test('removed remembered block becomes air only through unobstructed reobservation; unloaded space stays unknown',()=>{
 const w=world(),p={x:1,y:0,z:1},old:SeenBlock[]=[{position:p,name:'chest',lastSeen:1}];
 assert.ok(sampleNearSurfaces(w.eye,w.read,w.cast,2,old).some(b=>key(b.position)===key(p)&&b.name==='air'));
 assert.deepEqual(sampleNearSurfaces(w.eye,()=>null,w.cast,2,old),[]);
 assert.deepEqual(sampleNearSurfaces(w.eye,w.read,()=>({x:0,y:0,z:0}),2,old).filter(b=>b.name==='air'),[]);
});
test('rectangular encoding roundtrips holes, steps, material and time without filling gaps',()=>{
 const cells:Position[]=[];for(let x=-4;x<=4;x++)for(let z=-4;z<=4;z++)if(!(x===2&&z===3))cells.push({x,y:-1,z});cells.push({x:0,y:0,z:0});
 assert.deepEqual(rectangles(cells).flatMap(rectCells).map(key).sort(),cells.map(key).sort());
 const bs=cells.map((position,i)=>({position,name:i%2?'stone':'dirt',lastSeen:i%3}));const current=new Set(bs.slice(0,20).map(b=>key(b.position)));
 const decoded=terrainAreas(bs,current).flatMap(a=>rectCells(a.cells).map(position=>({position,name:a.block,lastSeen:a.lastObservedAt,current:a.source==='current_observation'})));
 assert.deepEqual(decoded.sort((a,b)=>key(a.position).localeCompare(key(b.position))),bs.map(b=>({...b,current:current.has(key(b.position))})).sort((a,b)=>key(a.position).localeCompare(key(b.position))));
});
function state(){const s=new MockWorld().snapshot();s.position={x:.5,y:0,z:.5};s.perception={mode:'panorama',range:48};s.placeableItems=['oak_planks'];s.vision={yaw:0,pitch:0,blocks:[]};s.places=[];s.placementSites=[];
 for(let x=-2;x<=2;x++)for(let z=8;z<=10;z++){s.vision.blocks.push({name:'smooth_stone',position:{x,y:-1,z},lastSeen:10});if(x!==0||z!==9)s.placementSites.push({position:{x,y:0,z},reference:{x,y:-1,z}});}return s;}
test('placement regions cover exactly all offered targets and keep support geometry; prompt has no duplicate raw site list',()=>{
 const s=state(),regions=placementRegions(s);const restored=regions.flatMap(g=>rectCells(g.targetCells).map(p=>regionSite(g,p)));
 assert.deepEqual(restored.map(x=>JSON.stringify(x)).sort(),s.placementSites!.map(x=>JSON.stringify(x)).sort());
 const ctx=currentModelState(s);assert.equal(ctx.placementSites,undefined);assert.ok(ctx.spatial!.interactionGeometry.placement.every(g=>g.supportBlock==='smooth_stone'));
 assert.equal(spatialContext(s).near.omitted,0);
});
test('JEV chooses placement item and exact site together without a region round',async()=>{
 const s=state(),calls:string[]=[];const out=await parameterSupervise(s,{options:[],execution:null,inbox:[],goal:null},directSelection(async q=>Object.fromEntries(Object.entries(q).map(([n,v])=>{
 calls.push(n);const choice=n==='action'?'place_block':n==='review'?'none':Object.keys(v.criteria).find(k=>{const value=(v.criteria[k] as any).value;if(n==='placementSite')return value?.kind==='other_site';if(n==='placementSiteExact')return value?.position.x===-1&&value.position.z===8;return value==='oak_planks';});assert.ok(choice);return [n,{type:'choice',choice,confidence:1}];}))), 'coordinated','sequential','independent');
 assert.equal(out.choice,'selected');assert.deepEqual(out.selected!.plan.build,{item:'oak_planks',position:{x:-1,y:0,z:8},reference:{x:-1,y:-1,z:8}});assert.deepEqual(calls,['action','review','blockItem','placementSite','placementSiteExact']);
});

test('repacking model state preserves its map and place citation evidence',()=>{
 const s=state();s.placeEvidence=[{id:'observed-floor',position:{x:0,y:-1,z:8},name:'smooth_stone',observedAt:10} as any];const once=currentModelState(s),twice=currentModelState(once);assert.deepEqual(twice,once);assert.equal(twice.placeEvidence?.length,1);
});

test('placement excludes distant and remembered-only supports but keeps every observed local site',()=>{
 const s=state(),near=s.placementSites!.length;
 const far={position:{x:30,y:0,z:0},reference:{x:30,y:-1,z:0}};
 const hidden={position:{x:4,y:0,z:0},reference:{x:4,y:-1,z:0}};
 s.placementSites!.push(far,hidden);s.vision!.blocks.push({name:'stone',position:far.reference,lastSeen:10});
 s.places!.push({name:'stone',position:hidden.reference,lastSeen:1});
 assert.equal(localPlacementSites(s).length,near);
 assert.equal(placementRegions(s).flatMap(g=>rectCells(g.targetCells)).length,near);
 // A dense plain narrows the published radius, preserving every cell within it.
 s.placementSites=[];s.vision!.blocks=[];
 for(let x=-11;x<=11;x++)for(let z=-11;z<=11;z++){
  const site={position:{x,y:0,z},reference:{x,y:-1,z}};
  s.placementSites.push(site);s.vision!.blocks.push({name:'stone',position:site.reference,lastSeen:10});
 }
 const domain=placementDomain(s);assert.ok(domain.scope.radiusBlocks<12);assert.ok(domain.values.length<=254);assert.ok(domain.scope.outsideCount>0);
});
