import type {Snapshot} from './types.js';
// Source attribution only. No target ranking or action selection. Live callers
// compute this before overview compression; archived summaries may be incomplete.
export function planningGrounding(state:Snapshot,fullObservation=false){
 const spatial=state.spatial as any;
 const complete=fullObservation||!state.perception||!!state.vision?.blocks?.length;
 return {meaning:'Current visibility comes from this request observations, never saved label/reason wording. A historical annotation saying fresh describes its registration time. false means not currently seen, not destroyed. null means the archived summary cannot establish visibility; do not infer absence or current visibility.',landmarkVisibility:(state.importantPlaces??[]).map(p=>{
  const exact=(state.vision?.blocks??[]).some(b=>b.position.x===p.position.x&&b.position.y===p.position.y&&b.position.z===p.position.z&&b.name===p.registeredBlock);
  const rectangle=(spatial?.near?.currentObservation??[]).some((r:any)=>r.block===p.registeredBlock&&r.cells.y===p.position.y&&r.cells.x[0]<=p.position.x&&r.cells.x[1]>=p.position.x&&r.cells.z[0]<=p.position.z&&r.cells.z[1]>=p.position.z);
  const presentInCurrentPanorama=exact||rectangle?true:complete?false:null;
  return {id:p.id,position:p.position,registeredBlock:p.registeredBlock,lastSeen:p.lastSeen,presentInCurrentPanorama};
 })};
}
