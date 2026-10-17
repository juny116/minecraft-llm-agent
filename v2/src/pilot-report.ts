// Aggregate functional evidence without publishing raw dialogue, coordinates,
// goals, player names, endpoints or memory contents.
export type PilotEvent={at:number;bot:string;event:string;data:Record<string,any>};
export function noOpMove(r:any){const p=r.changes?.position;return r.decision?.action==='move'&&r.outcome==='succeeded'&&p?.from&&p?.to&&Math.hypot(p.to.x-p.from.x,p.to.y-p.from.y,p.to.z-p.from.z)<.1;}
export function summarizePilot(events:PilotEvent[]){
 const identities=[...new Set(events.filter(e=>e.event==='initial_observation').map(e=>e.bot))];
 const agents=identities.map((name,index)=>{
  const rows=events.filter(e=>e.bot===name),records=rows.filter(e=>e.event==='action_record').map(e=>e.data.record);
  const actions:Record<string,Record<string,number>>={};let acquired=0,broken=0,travel=0;
  for(const r of records){const a=r.decision.action;actions[a]??={};actions[a][r.outcome]=(actions[a][r.outcome]??0)+1;
   for(const v of Object.values(r.changes.inventory??{}))if(typeof v==='number'&&v>0)acquired+=v;
   if(r.mining?.blockBroken)broken++;
   const p=r.changes.position;if(p?.from&&p?.to)travel+=Math.hypot(p.to.x-p.from.x,p.to.y-p.from.y,p.to.z-p.from.z);
  }
  const initial=rows.find(e=>e.event==='initial_observation'),final=[...rows].reverse().find(e=>e.event==='final_observation');
  const health=records.flatMap(r=>[r.before.health,r.after.health]);
  return {agent:`agent_${index+1}`,durationSeconds:initial&&final?(final.at-initial.at)/1000:null,actions,
   substantiveSuccesses:records.filter(r=>r.outcome==='succeeded'&&!['look','idle'].includes(r.decision.action)&&!noOpMove(r)).length,
   noOpMoves:records.filter(noOpMove).length,
   positiveInventoryDeltas:acquired,blocksBroken:broken,actionDisplacement:Math.round(travel*100)/100,
   minimumObservedHealth:Math.min(...health,initial?.data.observation?.health??20,final?.data.observation?.health??20),
   goalReviews:rows.filter(e=>e.event==='goals_reviewed').length,plannerErrors:rows.filter(e=>e.event==='planner_error').length,
   sentMessages:rows.filter(e=>e.event==='social_speech'&&e.data.sent).length,
   suppressedDuplicateReports:rows.filter(e=>e.event==='social_speech'&&e.data.reason==='no_new_report_evidence').length,
   memoryReflections:rows.filter(e=>e.event==='memory_reflected').length};
 });
 return {agents,modelResponses:events.filter(e=>e.event==='model_output').length,
  caveats:['Positive inventory deltas include crafting; they are not unique acquired resources.','Action displacement is endpoint distance, not total walking distance.','Functional duration and health do not establish unrestricted survival or autonomous cooperation.']};
}
