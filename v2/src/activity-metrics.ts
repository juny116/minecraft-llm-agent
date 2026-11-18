import type {PilotEvent} from './pilot-report.js';
// Mutually exclusive executor states. Model-pending overlaps are diagnostic, not causal blame.
export function summarizeActivity(events:PilotEvent[],bot:string){
 const start=events.find(e=>e.event==='started')?.at,stop=events.find(e=>e.event==='stopped')?.at;
 if(start===undefined||stop===undefined||stop<=start)return null;
 const samples=events.filter(e=>e.bot===bot&&e.event==='activity_sample'&&e.at>=start&&e.at<=stop).sort((a,b)=>a.at-b.at);
 const seconds={noAction:0,idle:0,look:0,work:0,unobserved:0},pending={selector:0,medium:0,long:0};
 for(let i=0;i<samples.length;i++){
  const e=samples[i],dt=Math.max(0,Math.min((samples[i+1]?.at??stop)-e.at,1000))/1000;
  const a=e.data.activeAction,key=a==null?'noAction':a==='idle'?'idle':a==='look'?'look':'work';seconds[key]+=dt;
  if(key==='noAction'){if(e.data.selectorPending)pending.selector+=dt;if(e.data.mediumPending)pending.medium+=dt;if(e.data.longPending)pending.long+=dt;}
 }
 const durationSeconds=(stop-start)/1000;seconds.unobserved=Math.max(0,durationSeconds-Object.values(seconds).reduce((a,b)=>a+b,0));
 return {durationSeconds,seconds,percent:Object.fromEntries(Object.entries(seconds).map(([k,v])=>[k,100*v/durationSeconds])),noActionModelPendingSeconds:pending};
}
