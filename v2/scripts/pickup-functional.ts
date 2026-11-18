import {mkdirSync,appendFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {config} from '../src/config.js';
import {MineflayerWorld} from '../src/mineflayer.js';
import {candidates,type Plan} from '../src/types.js';
if(!process.argv.includes('--live-functional'))throw Error('Explicit functional flag required');
const dir=`runs/pickup-${Date.now()}`;mkdirSync(dir,{recursive:true,mode:0o700});
function log(event:string,data:unknown={}){const line=JSON.stringify({at:new Date().toISOString(),event,data});console.log(line);appendFileSync(dir+'/events.jsonl',line+'\n');}
const world=new MineflayerWorld('Bob',config(),(e,f)=>log(e,f)),stop=new AbortController();
const hard=setTimeout(()=>{stop.abort();world.stop();world.close();log('hard_timeout');setTimeout(()=>process.exit(2),500);},60000);
const snap=()=>{const s=world.snapshot();return {position:s.position,health:s.health,inventory:s.inventory,visibleItems:s.visibleItems};};
try{
 for(let i=0;i<150&&!world.snapshot().ready;i++)await delay(100);if(!world.snapshot().ready)throw Error('Spawn timeout');await delay(1500);log('initial',snap());
 for(const pitch of [-Math.PI/2,-Math.PI/4])for(let i=0;i<8;i++)await world.execute('look',stop.signal,{goal:'Observe functional terrain',preferred:'look',look:{yaw:i*Math.PI/4,pitch}});
 let item;
 for(let i=0;i<16&&!item;i++){await world.execute('look',stop.signal,{goal:'Find visible test drop',preferred:'look',look:{yaw:i*Math.PI/4,pitch:-Math.PI/8}});item=world.snapshot().visibleItems?.find(i=>i.name==='cobblestone');}
 if(!item)throw Error('No visible cobblestone fixture');
 const plan:Plan={goal:'Functional pickup of existing drop',preferred:'pickup',pickup:{entityId:item.id,expected:item.name}};
 log('before',{state:snap(),plan,candidates:candidates(world.snapshot(),plan)});
 const result=JSON.parse(await world.execute('pickup',AbortSignal.any([stop.signal,AbortSignal.timeout(10000)]),plan));log('pickup',{result,state:snap()});
 if(result.status!=='finished'||!result.inventoryGained.some((i:any)=>i.name==='cobblestone'&&i.count===1))throw Error('Pickup not confirmed');
 const stale=JSON.parse(await world.execute('pickup',stop.signal,plan));log('stale_retry',{result:stale,state:snap()});if(stale.status!=='failed')throw Error('Stale target not rejected');
}catch(e){log('fatal',{error:e instanceof Error?e.message:String(e)});process.exitCode=1;}
finally{clearTimeout(hard);stop.abort();world.stop();world.close();log('closed',{dir,apiCalls:0});await delay(500);process.exit(process.exitCode??0);}
