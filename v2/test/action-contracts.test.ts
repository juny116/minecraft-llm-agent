import {emptyActions} from '../src/action-domains.js';
import test from 'node:test';import assert from 'node:assert/strict';
import pathfinder from 'mineflayer-pathfinder';
const {goals}=pathfinder;
import {moveReached,moveDomain,partitionMoveDestinations,MOVE_RADIUS,MINE_DESCRIPTION} from '../src/action-contracts.js';
import {actions,candidates} from '../src/types.js';import {MockWorld} from '../src/mock.js';
import {parameterSupervise,type Ask} from '../src/parameter-supervisor.js';
const input={options:[],execution:null,inbox:[],goal:'Choose activity',parameterSelection:true};
test('move completion agrees with GoalNear including fractional negative coordinates and boundary',()=>{
 const target={x:-3,y:64,z:-3},goal=new goals.GoalNear(target.x,target.y,target.z,MOVE_RADIUS);
 for(const position of [{x:-.1,y:64,z:-3},{x:-.1,y:64,z:-.1},{x:-5.01,y:64,z:-3},{x:-3,y:66,z:-3}])assert.equal(moveReached(position,target),goal.isEnd({x:Math.floor(position.x),y:Math.floor(position.y),z:Math.floor(position.z)} as any));
});
test('eligibility removes only already-complete references without modifying observations or ordering others',()=>{
 const points=[{x:0,y:64,z:0},{x:2,y:64,z:0},{x:3,y:64,z:0},{x:1000,y:64,z:0}];const original=structuredClone(points),domain=partitionMoveDestinations(points[0],points);
 assert.deepEqual(points,original);assert.deepEqual(domain.observed,points);assert.deepEqual(domain.eligible,points.slice(2));assert.deepEqual(domain.alreadyReached,points.slice(0,2));
});
test('same action menu exposes eligibility and binds an executable move without removing near map observations',async()=>{
 const s=new MockWorld().snapshot();s.position={x:0,y:64,z:0};s.places=[{name:'stone',position:{x:1,y:64,z:0},lastSeen:1},{name:'stone',position:{x:8,y:64,z:0},lastSeen:1}];s.vision={yaw:0,pitch:0,blocks:s.places};s.navigationTargets=[];s.craftable=['stick'];const before=structuredClone(s);let selectedArgs=0;
 const ask:Ask=async(q,c)=>{
  if(!c.argumentName){assert.ok(q.action.criteria.move);assert.equal(Object.keys(q.action.criteria).filter(x=>actions.includes(x as any)).length,actions.filter(a=>a!=='idle'&&(s.perception?.mode!=='panorama'||!['look','place_table'].includes(a))&&!emptyActions(s).includes(a)).length);assert.equal((c.moveAvailability as any).eligibleDestinationCount,1);return {action:{type:'choice',choice:'move',confidence:.01},review:{type:'choice',choice:'none',confidence:1}};}
  selectedArgs++;const entries=Object.entries(q.destination.criteria).filter(([k])=>k.startsWith('value_'));assert.equal(entries.length,1);assert.equal((entries[0][1] as any).value.x,8);assert.equal((c.argumentSemantics as any).alreadyWithinArrivalRadius.coordinates[0].x,1);return {destination:{type:'choice',choice:entries[0][0],confidence:.01}};
 };
 const d=await parameterSupervise(s,input,ask,'coordinated');assert.equal(selectedArgs,1);assert.equal(d.selected?.plan.destination?.x,8);assert.ok(candidates(s,d.selected!.plan).includes('move'));assert.deepEqual(s,before);
 const moved={...s,position:{x:8,y:64,z:0}};assert.ok(!candidates(moved,d.selected!.plan).includes('move'));
});
test('all destinations already reached yields empty-domain feedback, never fallback movement',async()=>{
 const s=new MockWorld().snapshot();s.position={x:0,y:64,z:0};s.places=[{name:'stone',position:{x:1,y:64,z:0},lastSeen:1}];s.vision={yaw:0,pitch:0,blocks:s.places};s.navigationTargets=[];let calls=0;
 const d=await parameterSupervise(s,input,async()=>{calls++;return {action:{type:'choice',choice:'move',confidence:1},review:{type:'choice',choice:'none',confidence:1}};},'coordinated');
 assert.equal(calls,1);assert.equal(d.choice,'unresolved');assert.equal(d.selectionControl?.argumentOutcome,'empty_domain');assert.equal(d.selected,undefined);assert.equal(actions.length,18);assert.equal(moveDomain(s).observed.length,1);
});
test('eligible movement can still be withdrawn by the model',async()=>{
 const s=new MockWorld().snapshot();s.position={x:0,y:64,z:0};s.places=[{name:'stone',position:{x:8,y:64,z:0},lastSeen:1}];s.vision={yaw:0,pitch:0,blocks:s.places};
 const d=await parameterSupervise(s,input,async(q,c)=>c.argumentName?{destination:{type:'choice',choice:'revise',confidence:1}}:{action:{type:'choice',choice:'move',confidence:1},review:{type:'choice',choice:'none',confidence:1}},'coordinated');assert.equal(d.choice,'unresolved');assert.equal(d.selected,undefined);
 assert.match(MINE_DESCRIPTION,/duration covers digging, not approach/);
});
