import type {Question} from './parameter-supervisor.js';

const semantics='look sets absolute camera orientation without moving the body, then samples the resulting view. Snapshots also sample the view independently of choosing look; look is not required to receive current observations. Keeping both axes unchanged does not by itself expose another direction. A completed look means the motor command finished, not that new information was obtained. Maintaining a view can still be intentional, for example to monitor a changing scene. Choose according to the current intention; no direction or action is preferred.';
// Observed outcomes only: never infer unseen terrain or prescribe the next action.
export function lookFeedbackRequest<T extends Record<string,any>>(questions:Record<string,Question>,context:T){
 const q=structuredClone(questions);
 if(q.action?.criteria.look)q.action.criteria.look=context.observation?.perception?'Optional focused camera observation. Automatic surrounding sensing already updates without look. Set yaw/pitch to add denser samples in a chosen direction; a changed view or discovery is not guaranteed. No direction is required for ordinary movement.':semantics;
 const last=context.recentOutcome;
 const history=context.recentLookResults??(last?.decision?.action==='look'?[last]:[]);
 const observations=history.map((r:any)=>({id:r.id,endedAt:r.endedAt,outcome:r.outcome,requested:r.executionPlan?.look??r.requested,view:r.changes?.view??r.view}));
 const feedback={semantics:context.observation?.perception?.mode==='panorama'?'Automatic all-direction occluded sensing refreshes without look. First-hit surfaces block knowledge behind them; missing cells are unknown. Movement changes the observation origin. Historical look records are not available actions.':semantics,currentCamera:context.observation?.vision?{yawRadians:context.observation.vision.yaw,pitchRadians:context.observation.vision.pitch,visibleBlockCount:context.observation.spatial?.regions.reduce((n:number,r:any)=>n+r.currentCells,0)??context.observation.vision.blocks.length}:null,recentLooks:observations,historyScope:'Up to six most recent look records in the retained twelve-action journal; not an exhaustive history. Missing view evidence is unknown, not zero change.'};
 return {questions:q,context:{...context,lookFeedback:feedback}};
}
