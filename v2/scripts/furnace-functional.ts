import {mkdirSync,appendFileSync} from 'node:fs';import {setTimeout as delay} from 'node:timers/promises';import {config} from '../src/config.js';import {MineflayerWorld} from '../src/mineflayer.js';import type {Plan,Action} from '../src/types.js';
if(!process.argv.includes('--live-functional'))throw Error('Explicit functional flag required');
const dir=`runs/furnace-${Date.now()}`;mkdirSync(dir,{recursive:true,mode:0o700});const log=(event:string,data:unknown={})=>{const l=JSON.stringify({at:new Date().toISOString(),event,data});console.log(l);appendFileSync(dir+'/events.jsonl',l+'\n');};
const w=new MineflayerWorld('Bob',config(),(e,f)=>log(e,f)),c=new AbortController(),furnace={x:6,y:-60,z:-3},chest={x:3,y:-60,z:-3};const timer=setTimeout(()=>{c.abort();w.stop();w.close();setTimeout(()=>process.exit(2),500);},60000);
const state=()=>{const s=w.snapshot();return {inventory:s.inventory,containers:s.containers,position:s.position,health:s.health};};
async function face(p:{x:number;y:number;z:number}){const b=(w as any).bot;await b.lookAt(b.entity.position.scaled(0).offset(p.x+.5,p.y+.5,p.z+.5),false);await w.execute('look',c.signal,{goal:'Inspect fixture',preferred:'look',look:{yaw:b.entity.yaw,pitch:b.entity.pitch}});}
async function act(action:Action,fields:Partial<Plan>={}){const result=await w.execute(action,AbortSignal.any([c.signal,AbortSignal.timeout(12000)]),{goal:'Furnace functional fixture',preferred:action,...fields});log('action',{action,result,state:state()});return result;}
try{for(let i=0;i<150&&!w.snapshot().ready;i++)await delay(100);if(!w.snapshot().ready)throw Error('Spawn timeout');await delay(1000);log('initial',state());
if(process.argv.includes('--recall-only')){const s=w.snapshot();if(!s.containers?.some(x=>x.position.x===chest.x&&x.position.z===chest.z))throw Error('Remembered chest missing');log('recalled_before_open',state());await face(chest);await act('inspect_container',{container:chest});}
else{
for(const pitch of [-Math.PI/2,-Math.PI/4])for(let i=0;i<8;i++)await act('look',{look:{yaw:i*Math.PI/4,pitch}});
await face(chest);await act('inspect_container',{container:chest});
const reference={...furnace,y:-61};await face(reference);await act('place_block',{build:{item:'furnace',position:furnace,reference}});
await face(furnace);await act('inspect_container',{container:furnace});await act('deposit',{container:furnace,transfer:{item:'raw_iron',count:1,slot:'input'}});await act('deposit',{container:furnace,transfer:{item:'coal',count:1,slot:'fuel'}});
let ready=false;for(let n=0;n<16;n++){await delay(1000);await face(furnace);const s=JSON.parse(await act('inspect_container',{container:furnace}));if(s.slots?.output?.name==='iron_ingot'){ready=true;break;}}
if(!ready)throw Error('No observed iron output');await act('withdraw',{container:furnace,transfer:{item:'iron_ingot',count:1,slot:'output'}});
await face(furnace);const mined=JSON.parse(await act('mine',{mine:{position:furnace,expected:'furnace',tool:'iron_pickaxe',maxMs:10000}}));if(!mined.blockBroken||!mined.inventoryGained.some((i:any)=>i.name==='furnace'))throw Error('Furnace recovery incomplete');log('final',state());
}
}catch(e){log('fatal',{error:e instanceof Error?e.message:String(e)});process.exitCode=1;}finally{clearTimeout(timer);c.abort();w.stop();w.close();log('closed',{dir,apiCalls:0});await delay(500);process.exit(process.exitCode??0);}
