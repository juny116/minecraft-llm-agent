import type {Ask} from './parameter-supervisor.js';
/** Complete arguments request an execution attempt. Withdrawal needs no extra call. */
export function directSelection(ask:Ask):Ask{return async(questions,context)=>{
 const changed=structuredClone(questions);
 if(!context.argumentName){
  if(changed.action)changed.action.instructions+=' Choose an action, then suitable arguments; if none serves the current intention, revise during argument selection instead of committing to an unsuitable operation. There is no separate final approval call. When execution is running, continue maintains it and stop cancels it without a timed wait. No idle/wait action is offered. Execution still checks fresh physical conditions.';
  return ask(changed,{...context,selectionContract:'direct',...(context.capabilityFacts?{capabilityFacts:{...(context.capabilityFacts as object),note:'Observed capabilities are not objectives. Choose an action and its arguments, or revise before execution. No additional approval call.'}}:{})});
 }
 for(const q of Object.values(changed)){
  delete q.criteria.none;delete q.criteria.revise;
  if(!Object.keys(q.criteria).length)throw Error('Empty direct argument domain');
  q.criteria.revise='Withdraw this proposed action before execution and return to action selection; no alternative is chosen locally. Keep an existing running action unchanged.';
  q.instructions=q.instructions.replace(/none[^.]*\./gi,'').replace('Select revise only to withdraw this action.','').trim()+' Choose a supplied argument that serves the current intention, or revise if this proposed operation is unsuitable. A physically feasible recipe can still consume materials needed for the intended task. All arguments are applied together only after binding completes and fresh physical checks pass. Revise discards this proposal; it does not cancel an already running action, undo prior work, or choose a replacement. No additional approval call or preferred value.';
 }
 const response=await ask(changed,{...context,selectionContract:'direct'});
 for(const [name,q]of Object.entries(changed)){
  const a=response?.[name];if(a?.type!=='choice'||!Object.hasOwn(q.criteria,a.choice)||!Number.isFinite(a.confidence)||a.confidence<0||a.confidence>1)throw Error('Invalid direct argument selection');
 }
 // Legacy selectValue calls the same withdrawal token none; only its internal
 // spelling changes. The API always receives the explicit revise contract.
 return Object.fromEntries(Object.entries(response).map(([name,a]:[string,any])=>[name,a.choice==='revise'&&!questions[name]?.criteria.revise?{...a,choice:'none'}:a]));
};}
