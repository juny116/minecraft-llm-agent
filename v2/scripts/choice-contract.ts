/** Diagnostic finite-domain contract. Not a production action policy. */
import type {Ask,Question} from '../src/parameter-supervisor.js';
export type Tuple={action:string;args:Record<string,unknown>};
export type ContractResult={kind:'selected';tuple:Tuple}|{kind:'wait'|'reconsider'|'revise'};
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
async function choose(name:string,criteria:Question['criteria'],instructions:string,ask:Ask,context:Record<string,unknown>){
 const qs={[name]:{type:'choice' as const,criteria,instructions}};
 const out=await ask(qs,context),a=out?.[name];
 if(a?.type!=='choice'||!Object.hasOwn(criteria,a.choice)||!Number.isFinite(a.confidence)||a.confidence<0||a.confidence>1)throw Error('Invalid contract response');
 return a.choice as string;
}
export async function chooseContract(tuples:Tuple[],mode:'staged'|'complete',ask:Ask):Promise<ContractResult>{
 if(!tuples.length)return {kind:'revise'};
 const actionNames=[...new Set(tuples.map(t=>t.action))];
 const capabilities=Object.fromEntries(actionNames.map(a=>[a,tuples.filter(t=>t.action===a).map(t=>t.args)]));
 const shared={diagnosticScope:'Only the supplied finite action-argument combinations are compared. This is not the full runtime domain. No combination is recommended.'};
 const controls={wait:'Intentionally wait or maintain current execution',reconsider:'Request a new medium intention; no immediate action',revise:'Return to action selection; do not execute this proposal'};
 if(mode==='complete'){
  const answer=await choose('complete',{...Object.fromEntries(tuples.map((t,i)=>['tuple_'+i,{description:'Execute this exact action and arguments',value:t}])),...controls},
   'Choose an entire action and its arguments using the supplied observations, goal, memory and execution constraints. All tuples are unranked. No answer is preferred. You may deliberately wait, request planning, or return to selection.',ask,shared);
  return answer.startsWith('tuple_')?{kind:'selected',tuple:tuples[Number(answer.slice(6))]}:{kind:answer as 'wait'|'reconsider'|'revise'};
 }
 const action=await choose('action',{...Object.fromEntries(actionNames.map(a=>[a,{description:'Choose this action; select its arguments next',values:capabilities[a]}])),...controls},
  'Choose an action using observations, goal, memory and available argument combinations. You will choose its arguments next. These are capabilities, not recommendations. No answer is preferred.',ask,shared);
 if(Object.hasOwn(controls,action))return {kind:action as 'wait'|'reconsider'|'revise'};
 let pool=tuples.filter(t=>t.action===action);const bound:Record<string,unknown>={};
 for(const name of Object.keys(pool[0].args)){
  const values=[...new Map(pool.map(t=>[JSON.stringify(t.args[name]),t.args[name]])).values()];
  const selected=await choose(name,{...Object.fromEntries(values.map((v,i)=>['value_'+i,{description:'Use this argument for your selected action',value:v}])),revise:controls.revise},
   'You selected '+action+'. Choose '+name+' to complete that action, consistent with previously bound arguments. If you withdraw this action, explicitly return to action selection. This is not a question about whether a value is a true statement. No value is preferred.',ask,{...shared,capabilities,selectedAction:action,boundArguments:{...bound},argumentName:name});
  if(selected==='revise')return {kind:'revise'};
  bound[name]=values[Number(selected.slice(6))];
  pool=pool.filter(t=>equal(t.args[name],bound[name]));
 }
 return {kind:'selected',tuple:pool[0]};
}
