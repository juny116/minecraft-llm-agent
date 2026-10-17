import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { config } from '../src/config.js';
import { MineflayerWorld } from '../src/mineflayer.js';
import { Runtime } from '../src/runtime.js';
import { ApiBrain, Budget } from '../src/providers.js';
import type { Brain } from '../src/types.js';
if (!process.argv.includes('--live-functional')) throw new Error('Explicit --live-functional flag required; this changes the test world');
const c=config();const results:unknown[]=[];const worlds:MineflayerWorld[]=[];
const record=(name:string,detail:unknown)=>{results.push({name,detail});console.log(JSON.stringify({name,detail}));};
const budget=new Budget(2,0.01);
const deadline=setTimeout(()=>{worlds.forEach(w=>w.close());process.exit(2)},100000);
try {
 const alice=new MineflayerWorld('Alice',{...c,follow:'Bob'},event=>record('Alice_event',event));worlds.push(alice);
 const bob=new MineflayerWorld('Bob',{...c,follow:'Alice'},event=>record('Bob_event',event));worlds.push(bob);
 for(let i=0;i<150&&!worlds.every(w=>w.snapshot().ready);i++)await delay(100);
 assert.ok(worlds.every(w=>w.snapshot().ready));await delay(1000);
 const a=(alice as any).bot,b=(bob as any).bot;
 const goalNear=(await import('mineflayer-pathfinder')).default.goals.GoalNear;
 const signal=()=>AbortSignal.timeout(15000);
 await a.pathfinder.goto(new goalNear(-16,-60,0,1));
 const cancelled=bob.execute('follow',signal());await delay(200);bob.stop();
 const cancelResult=await cancelled.then(()=> 'completed',()=> 'interrupted');
 await delay(300);const pos=bob.snapshot().position;await delay(500);
 assert.ok(Math.hypot(pos.x-bob.snapshot().position.x,pos.z-bob.snapshot().position.z)<0.1);
 assert.equal(cancelResult,'interrupted');record('mid_action_stop','passed');
 const brain:Brain={plan:async(_s,_h,_sig,goal)=>({goal:goal??'approach Alice',preferred:goal?'idle':'follow'}),choose:async(_s,p)=>({action:p.preferred??'idle',confidence:1})};
 const runtime=new Runtime(bob,brain,{planMs:30000,actionMs:15000,minConfidence:0.55},()=>{});
 await runtime.tick();await delay(10);const pending=runtime.tick();await delay(150);runtime.setGoal('wait');await pending;
 assert.equal(runtime.plan.preferred,'idle');await runtime.refreshPlan();assert.equal(runtime.plan.preferred,'idle');record('live_goal_change','passed');
 runtime.setGoal(null);assert.equal(runtime.userGoal,null);record('live_goal_clear','passed');
 // Deliberate contention: force both adapters to refer to the same observed block.
 const target=a.findBlock({matching:(x:any)=>x.name.endsWith('_log'),maxDistance:32});assert.ok(target);
 await Promise.all([a,b].map(bot=>bot.pathfinder.goto(new goalNear(target.position.x,target.position.y,target.position.z,2))));
 const originalA=(alice as any).wood,originalB=(bob as any).wood;
 (alice as any).wood=()=>a.blockAt(target.position);(bob as any).wood=()=>b.blockAt(target.position);
 const before=alice.snapshot().logs+bob.snapshot().logs;
 const contest=await Promise.allSettled(worlds.map(w=>{const b=w.snapshot().vision?.blocks.find(b=>b.name.endsWith('_log'));if(!b)throw Error('No visible log for functional mine probe');return w.execute('mine',signal(),{goal:'Functional mining check',preferred:'mine',mine:{position:b.position,expected:b.name}});}));
 (alice as any).wood=originalA;(bob as any).wood=originalB;
 await delay(1000);const gained=alice.snapshot().logs+bob.snapshot().logs-before;
 assert.equal(gained,1);assert.ok(contest.filter(r=>r.status==='fulfilled').length<=1);
 record('resource_contention',{results:contest.map(r=>r.status),totalLogsGained:gained});
 async function storeLogs(w:MineflayerWorld){
  const chest=w.snapshot().vision?.blocks.find(b=>b.name==='chest');if(!chest)throw Error('No visible chest for deposit fixture');
  for(const item of w.snapshot().inventory??[]){if(!item.name.endsWith('_log'))continue;
   const plan={goal:'Store functional check resources',preferred:'deposit' as const,container:chest.position,transfer:{item:item.name,count:Math.min(64,item.count)}};
   await assert.rejects(w.execute('deposit',signal(),{...plan,container:{x:30000000,y:0,z:0}}),/visible requested chest/);
   record('failure_then_recovery',await w.execute('deposit',signal(),plan));
  }
 }
 for(const w of worlds)if(w.snapshot().logs)await storeLogs(w);
 // Two real model calls on live state, then one bounded selected action.
 if(process.argv.includes('--with-api')) {
 const api=new ApiBrain({...c,maxOutput:256,mode:'jev'},budget);
 const state=bob.snapshot();const plan=await api.plan(state,[],signal(),'Choose one safe short action; idle is fine.');
 const {candidates}=await import('../src/types.js');const decision=await api.choose(bob.snapshot(),plan,candidates(bob.snapshot(),plan),signal());
 assert.ok(candidates(bob.snapshot(),plan).includes(decision.action));
 const action=await bob.execute(decision.action,signal(),plan);record('live_model_to_action',{plan,decision,result:action,budget:{...budget}});
 if(bob.snapshot().logs>0)await storeLogs(bob);
 }
 record('eat_preconditions',worlds.map(w=>({food:w.snapshot().food,canEat:w.snapshot().canEat})));
}catch(e){record('FAILED',e instanceof Error?e.message:'unknown');process.exitCode=1;}
finally{worlds.forEach(w=>{w.stop();w.close();});clearTimeout(deadline);mkdirSync('runs',{recursive:true});writeFileSync('runs/functional-check.json',JSON.stringify({results,budget},null,2),{mode:0o600});setTimeout(()=>process.exit(process.exitCode||0),500);}
