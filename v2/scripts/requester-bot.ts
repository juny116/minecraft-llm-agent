// Scripted requester player for in-game chat tests. No model calls.
// Usage: REQUESTER_NAME=<player> tsx scripts/requester-bot.ts --live <script.json> [--seconds 180]
// script.json: [{"afterMs":10000,"text":"Bob, 흰색 침대 하나 만들어 줄 수 있어?"}]
import {mkdirSync,appendFileSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import mineflayer from 'mineflayer';
import {config} from '../src/config.js';
import {RequesterScript,parseRequesterScript} from '../src/requester-script.js';
const args=process.argv.slice(2);
if(!args.includes('--live'))throw Error('Explicit --live required: this connects to the configured Minecraft server');
const file=args.find(a=>a.endsWith('.json'));if(!file)throw Error('Requester script JSON path required');
const name=process.env.REQUESTER_NAME??'';if(!/^[A-Za-z0-9_]{3,16}$/.test(name))throw Error('REQUESTER_NAME must be a 3-16 character player name');
const c=config();if(c.names.includes(name))throw Error('REQUESTER_NAME must not be one of BOT_NAMES; the tested bot should see an ordinary player');
const seconds=Number(args[args.indexOf('--seconds')+1]??0)||180;
const lines=parseRequesterScript(JSON.parse(readFileSync(file,'utf8')));
const dir=join('runs','requester-'+Date.now());mkdirSync(dir,{recursive:true,mode:0o700});
const log=(event:string,fields:unknown={})=>{const line=JSON.stringify({at:Date.now(),event,fields});appendFileSync(join(dir,'events.jsonl'),line+'\n',{mode:0o600});console.log(line);};
const bot=mineflayer.createBot({host:c.host,port:c.port,version:c.version,auth:c.auth,username:name});
let script:RequesterScript|undefined,timer:NodeJS.Timeout|undefined,stopped=false;
const stop=(reason:string)=>{if(stopped)return;stopped=true;if(timer)clearInterval(timer);writeFileSync(join(dir,'summary.json'),JSON.stringify({reason,requester:name,lines,records:script?.records??[]},null,1),{mode:0o600});log('stopped',{reason});bot.quit();setTimeout(()=>process.exit(0),500);};
bot.once('spawn',()=>{
 script=new RequesterScript(name,lines,t=>bot.chat(t),Date.now());log('spawned',{requester:name,lines:lines.length,seconds});
 timer=setInterval(()=>{script!.tick(Date.now());},200);
 setTimeout(()=>stop('time_limit'),seconds*1000);
});
bot.on('chat',(speaker,text)=>{script?.heard(speaker,text,Date.now());if(speaker!==name)log('heard',{speaker,text});});
bot.on('kicked',reason=>stop('kicked: '+String(reason).slice(0,200)));bot.on('error',e=>{log('error',{message:e.message});stop('error');});
process.once('SIGINT',()=>stop('SIGINT'));process.once('SIGTERM',()=>stop('SIGTERM'));
