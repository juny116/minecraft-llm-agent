import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {config} from '../src/config.js';
import {MineflayerWorld} from '../src/mineflayer.js';
import {ApiBrain,Budget} from '../src/providers.js';
import {candidates,type Action} from '../src/types.js';
if(!process.argv.includes('--live-functional'))throw Error('Requires --live-functional');
const argument=process.argv.find(a=>a.startsWith('--action='))?.split('=')[1];
const withJev=process.argv.includes('--with-jev');
if(!withJev && argument!=='attack' && argument!=='flee')throw Error('Requires --action=attack|flee or explicitly authorized --with-jev');
const c=config();const world=new MineflayerWorld('Bob',c,event=>console.log(JSON.stringify({event})));
const bot=(world as any).bot;
const hardStop=setTimeout(()=>{world.stop();world.close();process.exit(2)},90000);
const signal=AbortSignal.timeout(80000);
let hurtEvents=0,targetId=-1;
bot.on('entityHurt',(e:any)=>{if(e.id===targetId)hurtEvents++;});
try{
 for(let i=0;i<150&&!world.snapshot().ready;i++)await delay(100,undefined,{signal});
 assert.ok(world.snapshot().ready,'Spawn timeout');
 console.log(JSON.stringify({event:'ready_for_administrator',position:world.snapshot().position,health:world.snapshot().health}));
 // Inspect near floor and surroundings before trying a known-terrain retreat.
 for(const pitch of [-Math.PI/2,-Math.PI/4,0])for(let i=0;i<8;i++){
  await world.execute('look',signal,{goal:'functional scan',preferred:'look',look:{yaw:i*Math.PI/4,pitch}});
 }
 let state=world.snapshot();
 for(let i=0;!state.enemies?.length&&i<100;i++){
  await world.execute('look',signal);await delay(400,undefined,{signal});state=world.snapshot();
 }
 assert.equal(state.enemies?.length,1,'Require exactly one visible prepared mob');
 assert.equal(state.enemies![0].kind,'zombie','Fixture must be a regular zombie');targetId=state.enemies![0].id;
 assert.ok(state.health>=16,'Prepare healthy Bob before functional combat');
 let action=argument as Action;
 if(withJev){
  const budget=new Budget(1,.01);const brain=new ApiBrain({...c,mode:'jev'},budget);
  const options=candidates(state).filter(a=>['idle','attack','flee'].includes(a));
  action=(await brain.choose(state,{goal:'Bounded functional combat choice',preferred:'idle'},options,signal)).action;
  console.log(JSON.stringify({event:'jev_choice',action,calls:budget.calls,usd:budget.usd}));
 }
 console.log(JSON.stringify({event:'before',action,state}));
 const result=await world.execute(action,signal);
 await delay(300,undefined,{signal});
 const after=world.snapshot();console.log(JSON.stringify({event:'after',result,hurtEvents,state:after}));
 if(action==='attack'){assert.ok(hurtEvents>0,'No server-observed target hurt event; attack not verified');console.log('attack_hurt_verified');}
 if(action==='flee'){assert.equal(JSON.parse(result).outcome,'distance_increased');console.log('retreat_distance_verified');}
 if(action==='idle')console.log('JEV chose idle; attack/flee remain untested in this probe');
}catch(e){console.error(e);process.exitCode=1;}
finally{world.stop();world.close();clearTimeout(hardStop);setTimeout(()=>process.exit(process.exitCode||0),500);}
