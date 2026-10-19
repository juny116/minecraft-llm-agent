import type {Ask,Question} from './parameter-supervisor.js';
/** Combine independent question rounds; no cross product, filtering or local answer. */
export function batchIndependent(transport:Ask):Ask{
 let queued:{questions:Record<string,Question>;context:Record<string,unknown>;resolve:(v:any)=>void;reject:(e:unknown)=>void}[]=[];let scheduled=false;
 return (questions,context)=>new Promise((resolve,reject)=>{
  queued.push({questions,context,resolve,reject});if(scheduled)return;scheduled=true;
  queueMicrotask(async()=>{
   const group=queued;queued=[];scheduled=false;
   try{
    const names=group.flatMap(g=>Object.keys(g.questions));if(new Set(names).size!==names.length)throw Error('Duplicate independent argument question');
    const questions=Object.assign({},...group.map(g=>g.questions));
    const context={...group[0].context,argumentName:'independent_arguments',independentArguments:Object.fromEntries(group.flatMap(g=>Object.keys(g.questions).map(k=>[k,g.context]))),bindingMeaning:'These questions bind independent fields of ONE action. Choose a coherent combination; each question retains its complete allowed domain. Dependent fields are selected afterward, not guessed.'};
    const result=await transport(questions,context);for(const g of group)g.resolve(result);
   }catch(e){for(const g of group)g.reject(e);}
  });
 });
}
