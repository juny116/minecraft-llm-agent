import test from 'node:test';import assert from 'node:assert/strict';
import {ApiBrain,Budget} from '../src/providers.js';
import {config} from '../src/config.js';

function brainWith(reply:(body:any)=>{status?:number;json:any}){
 const prev={p:process.env.LLM_PROVIDER,k:process.env.ANTHROPIC_API_KEY,m:process.env.LLM_MODEL};
 process.env.LLM_PROVIDER='anthropic';process.env.ANTHROPIC_API_KEY='test-key';delete process.env.LLM_MODEL;
 const c=config();process.env.LLM_PROVIDER=prev.p;process.env.ANTHROPIC_API_KEY=prev.k;if(prev.m!==undefined)process.env.LLM_MODEL=prev.m;
 const sent:any[]=[];const budget=new Budget(10,1);
 const fetcher=(async(url:any,init:any)=>{const body=JSON.parse(String(init.body));sent.push({url:String(url),body});const r=reply(body);return new Response(JSON.stringify(r.json),{status:r.status??200,headers:{'content-type':'application/json','request-id':'req_1'}});}) as typeof fetch;
 return {brain:new ApiBrain(c,budget,fetcher) as any,sent,budget,c};
}
const message=(text:string,stop='end_turn',usage={input_tokens:1200,output_tokens:40,cache_read_input_tokens:3000,cache_creation_input_tokens:0})=>({id:'msg_1',type:'message',role:'assistant',model:'claude-haiku-5-5',content:[{type:'text',text}],stop_reason:stop,stop_sequence:null,usage});

test('LLM_PROVIDER=anthropic sends Haiku requests through the SDK and parses the JSON reply',async()=>{
 const {brain,sent,budget,c}=brainWith(()=>({json:message('```json\n{"speech":null}\n```')}));
 assert.equal(c.llmModel,'claude-haiku-5-5');
 const out=await brain.generate('Decide.',{a:1},new AbortController().signal,5000,256);
 assert.deepEqual(out,{speech:null});
 const b=sent[0].body;assert.match(sent[0].url,/\/v1\/messages$/);assert.equal(b.model,'claude-haiku-5-5');assert.equal(b.max_tokens,256);
 assert.deepEqual(b.thinking,{type:'disabled'});assert.deepEqual(b.system[0].cache_control,{type:'ephemeral'});assert.equal(b.messages[0].content,'{"a":1}');
 assert.equal(b.temperature,undefined);
 assert.equal(budget.input,4200,'cached prompt tokens are counted');assert.equal(budget.calls,1);
});
test('a truncated reply and a billing failure are reported, not parsed',async()=>{
 const t=brainWith(()=>({json:message('{"speech":','max_tokens')}));
 await assert.rejects(t.brain.generate('x',{},new AbortController().signal,5000,16),/truncated/);
 const f=brainWith(()=>({status:402,json:{type:'error',error:{type:'billing_error',message:'credit'}}}));
 await assert.rejects(f.brain.generate('x',{},new AbortController().signal,5000,16),/http 402/);assert.equal(f.budget.fatal,true);
});

test('with LLM_PROVIDER=anthropic an OpenAI LLM_MODEL is ignored and CLAUDE_API_KEY is accepted',()=>{
 const keep={...process.env};
 try{
  Object.assign(process.env,{LLM_PROVIDER:'anthropic',LLM_MODEL:'gpt-6-luna',CLAUDE_API_KEY:'k2'});delete process.env.ANTHROPIC_API_KEY;delete process.env.CLAUDE_MODEL;
  const c=config();assert.equal(c.llmModel,'claude-haiku-5-5');assert.equal(c.llmKey,'k2');
  process.env.CLAUDE_MODEL='claude-sonnet-5-5';assert.equal(config().llmModel,'claude-sonnet-5-5');
 }finally{for(const k of Object.keys(process.env))if(!(k in keep))delete process.env[k];Object.assign(process.env,keep);}
});
