/** Trace extraction only. Never attaches later observations to a request. */
export function planningFrames(events:any[]){
 const pending=new Map<string,any>(),frames:any[]=[];
 for(let i=0;i<events.length;i++){
  const e=events[i],d=e.data??{},prev=events[i-1];
  if(e.event==='model_input'&&d.context?.planning&&!d.context.planning.goalReview&&d.context.allowedProposals){
   if(prev?.event!=='api_request'||prev.data.phase!=='dispatch')throw Error('Uncorrelated planner input');
   pending.set(prev.data.id,{id:prev.data.id,line:i+1,at:e.at,input:structuredClone(d.context)});
  }
  if(e.event==='api_request'&&d.phase==='complete'&&pending.has(d.id)){
   if(prev?.event!=='model_output')throw Error('Missing planner output');
   frames.push({...pending.get(d.id),output:structuredClone(prev.data.content),latencyMs:d.elapsedMs});pending.delete(d.id);
  }
 }
 return frames;
}
export const planningRubric={
 completion:'Assess supplied done criteria against actual results, including effects of cancelled work; do not claim hidden results.',
 transition:'If previous task is complete, propose distinct bounded work in the same response; no prescribed action type.',
 deferral:'Keep an unresolved criterion and a reason to reopen deferred work; no invented safety guarantee.',
 attribution:'Separate teammate claims, annotation receipts and physical outcomes.',
 continuity:'Retain useful unfinished work; changed wording is not progress. Repetition can be valid with a stated purpose.'
};
