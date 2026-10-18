import type {Ask,Question} from './parameter-supervisor.js';
/** One commitment: the model's action and complete argument selection. No approval calls. */
export function directSelection(ask:Ask):Ask{return async(questions,context)=>{
 const changed=structuredClone(questions);
 if(!context.argumentName){
  if(changed.action)changed.action.instructions+=' Selecting an action commits to choosing its arguments; there is no separate approval call. Use wait, continue or stop at this action decision when appropriate. Execution still checks fresh physical conditions.';
  return ask(changed,{...context,selectionContract:'direct',...(context.capabilityFacts?{capabilityFacts:{...(context.capabilityFacts as object),note:'Observed capabilities are not objectives. Choose the action, then all its arguments; no additional model approval is requested.'}}:{})});
 }
 for(const q of Object.values(changed)){
  delete q.criteria.none;delete q.criteria.revise;
  if(!Object.keys(q.criteria).length)throw Error('Empty direct argument domain');
  q.instructions=q.instructions.replace(/none[^.]*\./gi,'').replace('Select revise only to withdraw this action.','').trim()+' Select the most suitable supplied value or group for the complete action, in light of current observations, intention and boundArguments. All selected arguments are applied together. This selection requests an execution attempt after all arguments and fresh physical checks, not guaranteed success. There is no additional approval call. No supplied value is preferred.';

 }
 const response=await ask(changed,{...context,selectionContract:'direct'});
 for(const [name,q]of Object.entries(changed)){
  const a=response?.[name];if(a?.type!=='choice'||!Object.hasOwn(q.criteria,a.choice)||!Number.isFinite(a.confidence)||a.confidence<0||a.confidence>1)throw Error('Invalid direct argument selection');
 }
 return response;
};}
