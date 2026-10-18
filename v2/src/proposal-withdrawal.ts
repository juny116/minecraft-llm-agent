import type {Ask,Question} from './parameter-supervisor.js';
/** Argument proposals are not execution commands; the model can reject the concrete proposal. */
export function proposalWithdrawal(ask:Ask):Ask{return async(questions,context)=>{
 const entries=Object.entries(questions);if(entries.length!==1||!context.argumentName)return ask(questions,context);
 const [name,q]=entries[0],withdraw=Object.hasOwn(q.criteria,'revise')?'revise':Object.hasOwn(q.criteria,'none')?'none':undefined;
 if(!withdraw)return ask(questions,context);
 const criteria={...q.criteria};delete criteria[withdraw];if(!Object.keys(criteria).length)throw Error('Empty proposal domain');
 const grouped=Object.keys(criteria).every(k=>k.startsWith('group_'));
 const proposal:Question={...q,criteria,instructions:q.instructions.replace('Select revise only to withdraw this action.','')+' Propose the most suitable supplied argument or group for consideration. This is a provisional proposal, not an execution commitment. After a concrete value is proposed you can withdraw the action; nothing executes before that decision.'};
 const out=await ask({[name]:proposal},{...context,proposalStatus:'uncommitted'}),a=out?.[name];
 if(a?.type!=='choice'||!Object.hasOwn(criteria,a.choice)||!Number.isFinite(a.confidence)||a.confidence<0||a.confidence>1)throw Error('Invalid argument proposal');
 if(grouped)return out;
 const gate:Question={type:'choice',instructions:'Review the concrete proposed argument for the selected action against observations and intention. Bind requests an execution attempt after current physical checks, not guaranteed success. Withdraw rejects this action without a replacement. Both are allowed; no choice is preferred.',criteria:{bind:'Use the concrete proposed argument for this action',withdraw:'Reject this proposed argument and withdraw the action'}};
 const decision=await ask({bindingDecision:gate},{...context,proposedArgument:{name,choice:a.choice,value:criteria[a.choice]},bindingDomain:{name,instructions:q.instructions,criteria}}),b=decision?.bindingDecision;
 if(b?.type!=='choice'||!Object.hasOwn(gate.criteria,b.choice)||!Number.isFinite(b.confidence)||b.confidence<0||b.confidence>1)throw Error('Invalid proposal review');
 return {[name]:b.choice==='withdraw'?{...b,choice:withdraw}:{...a}};
};}
