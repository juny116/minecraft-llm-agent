/** Diagnostic only: preserve every argument, separating commitment from N-way binding. */
import type {Ask,Question} from '../src/parameter-supervisor.js';
export function separateWithdrawal(ask:Ask):Ask{
 return async(questions,context)=>{
  const entries=Object.entries(questions);
  if(entries.length!==1||!context.argumentName)return ask(questions,context);
  const [name,q]=entries[0],withdraw=Object.hasOwn(q.criteria,'revise')?'revise':Object.hasOwn(q.criteria,'none')?'none':undefined;
  if(!withdraw)return ask(questions,context);
  const criteria={...q.criteria};delete criteria[withdraw];
  if(!Object.keys(criteria).length)throw Error('Empty diagnostic binding domain');
  const gate:Question={type:'choice',instructions:'Decide whether to bind this argument from the supplied domain or withdraw the selected action. Both choices are allowed. Binding means you will select one supplied value or group next; it does not assert that execution will succeed. Use observations, intention, current execution and the complete supplied domain. No choice is preferred.',criteria:{bind:'Continue this selected action by choosing an argument from the supplied domain',withdraw:'Withdraw this selected action; do not choose an argument or execute a replacement'}};
  const out=await ask({bindingDecision:gate},{...context,bindingDomain:{name,instructions:q.instructions,criteria}}),a=out?.bindingDecision;
  if(a?.type!=='choice'||!Object.hasOwn(gate.criteria,a.choice)||!Number.isFinite(a.confidence)||a.confidence<0||a.confidence>1)throw Error('Invalid withdrawal gate response');
  if(a.choice==='withdraw')return {[name]:{...a,choice:withdraw}};
  return ask({[name]:{...q,criteria,instructions:q.instructions.replace('Select revise only to withdraw this action.','')+' You chose bind in the preceding binary decision. Now choose one of these values or groups; no value is preferred.'}},{...context,bindingDecision:{choice:'bind',scope:'this argument question only'}});
 };
}
