import test from 'node:test';
import assert from 'node:assert/strict';
import {CombatEvidenceStore} from '../src/combat-evidence.js';
import {combat,type CombatPort,type Enemy} from '../src/combat.js';

test('visible source-attributed damage followed by death confirms defeat; disappearance alone does not',()=>{
 const e=new CombatEvidenceStore();e.seen(1,'zombie',0);e.hurt(1,true,true,100);
 assert.equal(e.get(1)?.ownKillConfirmed,false);e.death(1,200);
 assert.equal(e.get(1)?.ownKillConfirmed,true);assert.equal(e.get(1)?.confirmedOwnHits,1);
});
test('other damage, hidden hits, stale deaths and hurt animations cannot establish own kill',()=>{
 const e=new CombatEvidenceStore();e.seen(1,'zombie',0);e.hurt(1,true,true,100);e.hurt(1,false,true,200);e.death(1,300);
 assert.equal(e.get(1)?.ownKillConfirmed,false);
 e.seen(2,'zombie',0);e.hurt(2,true,false,100);e.death(2,200);assert.equal(e.get(2)?.ownKillConfirmed,false);
 e.seen(3,'zombie',0);e.hurt(3,true,true,100);e.death(3,3000);assert.equal(e.get(3)?.deathObserved,false);
});
function fixture(){
 let now=0,hits=0,approaches=0,turns=0;
 const enemy:Enemy={id:1,kind:'zombie',position:{x:0,y:0,z:2},distance:2};
 const state={health:20,position:{x:0,y:0,z:0},enemies:[enemy]};const evidence=new CombatEvidenceStore();
 const port:CombatPort={observe:()=>{for(const e of state.enemies)evidence.seen(e.id,e.kind,now);return state;},targetEvidence:id=>evidence.get(id),equipWeapon:async()=>{},cooldownMs:()=>700,
 approach:()=>{approaches++;enemy.distance=2;},strike:async()=>{hits++;evidence.hurt(1,true,true,now);enemy.distance=4;if(hits===3)evidence.death(1,now);return true;},
 faceLastSeen:async p=>{turns++;assert.deepEqual(p,enemy.position);},retreat:()=>false,stop:()=>{},wait:async ms=>{now+=ms;},now:()=>now};
 return {port,state,enemy,evidence,hits:()=>hits,approaches:()=>approaches,turns:()=>turns};
}
test('knockback triggers reapproach, repeated cooldown strikes and observed defeat ends combat',async()=>{
 const f=fixture(),r=await combat(f.port,'attack',new AbortController().signal);
 assert.equal(f.hits(),3);assert.equal(f.approaches(),2);assert.equal(r.outcome,'target_defeated');assert.equal(r.ownKillConfirmed,true);assert.equal(r.targetDeathObserved,true);
});
test('temporary visual loss turns toward last observation, while persistent occlusion stops without attacks',async()=>{
 const f=fixture(),wait=f.port.wait;f.port.wait=async(ms,s)=>{await wait(ms,s);f.state.enemies=[];};
 const r=await combat(f.port,'attack',new AbortController().signal);
 assert.equal(r.outcome,'target_left_view');assert.equal(f.hits(),0);assert.equal(f.approaches(),0);assert.equal(f.turns(),8);
});
test('reacquired visible target resumes attacks',async()=>{
 const f=fixture(),wait=f.port.wait;let n=0;f.port.wait=async(ms,s)=>{await wait(ms,s);n++;f.state.enemies=n<3?[]:[f.enemy];};
 const r=await combat(f.port,'attack',new AbortController().signal);assert.ok(f.turns()>0);assert.equal(r.outcome,'target_defeated');
});

test('death received during final wait overrides time-limit label without another swing',async()=>{
 const f=fixture();let dead=false;const wait=f.port.wait;
 f.port.wait=async(ms,s)=>{await wait(ms,s);if(f.port.now()>=3000)dead=true;};
 f.port.targetEvidence=()=>({confirmedOwnHits:f.hits(),deathObserved:dead,ownKillConfirmed:dead});
 const r=await combat(f.port,'attack',new AbortController().signal);
 assert.equal(r.outcome,'target_defeated');assert.equal(r.targetDeathObserved,true);assert.equal(r.ownKillConfirmed,true);assert.equal(f.hits(),4);
});
