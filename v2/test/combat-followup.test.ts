import test from 'node:test';import assert from 'node:assert/strict';
import {fleeFollowups} from '../src/combat-followup.js';

const rec=(id:number,action:string,at:number,enemies:{id:number;kind:string;distance:number}[],life=1,health=0,target?:number):any=>({id,decision:{action},outcome:'succeeded',startedAt:at,endedAt:at+2000,executionPlan:target?{targetEntityId:target}:undefined,before:{enemies,lifeGeneration:life},after:{lifeGeneration:life},changes:{health}});

test('a successful flee still reports the same enemy returning, later damage and death',()=>{
 const z={id:7,kind:'zombie',distance:3};
 const [f]=fleeFollowups([rec(1,'flee',0,[z],1,0,7),rec(2,'mine',10000,[{...z,distance:4}],1,-6),rec(3,'move',20000,[],2)],60000);
 assert.deepEqual(f.sameEnemyBackWithin8Blocks,{afterSeconds:8,distance:4,actionId:2});
 assert.equal(f.laterHealthLoss,6);assert.equal(f.diedAfterSeconds,18);assert.equal(f.targetKind,'zombie');
 const [g]=fleeFollowups([rec(1,'flee',0,[z],1,0,7),rec(2,'mine',10000,[{...z,distance:20}])],60000);
 assert.equal(g.sameEnemyBackWithin8Blocks,null);assert.equal(g.diedAfterSeconds,null);
});
