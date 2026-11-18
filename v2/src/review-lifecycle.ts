import type {Snapshot} from './types.js';

export type ReviewBasis={planVersion:number;observationVersion:number;feedbackVersion:number};
export type ReviewRequest=ReviewBasis & {id:number;requestedAt:number;reasons:string[]};
export type ReviewReceipt=ReviewRequest & {completedAt:number;status:'applied'|'discarded'|'failed';appliedPlanVersion?:number};
export type PlanningState={planVersion:number;appliedAt:number|null;ageMs:number|null;medium:{pending:boolean;current?:ReviewRequest;lastCompleted?:ReviewReceipt;queuedReasons:string[]}};
export type SelectionFeedbackEvent={id:number;at:number;planVersion:number;observationVersion:number;status:'unreviewed'|'reviewed'|'action_started';reviewedByPlanVersion?:number;actionStartedAt?:number;feedback:string};
export type SelectionFeedbackStatus={current?:SelectionFeedbackEvent;history:SelectionFeedbackEvent[];total:number;omittedHistoryCount:number};

// Clock-only refreshes are not new world evidence. Preserve actual observations.
function withoutObservationClocks(value:any):any{
 if(Array.isArray(value))return value.map(withoutObservationClocks);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>!['at','lastSeen','observedAt','updatedAt','firstSeen','ageMs','elapsedMs','noProgressMs','noNewObservationMs'].includes(k)).map(k=>[k,withoutObservationClocks(value[k])]));
 return value;
}
export class ReviewLifecycle {
 private observationKey='';private observationSerial=0;private requestSerial=0;
 private current?:ReviewRequest;private lastCompleted?:ReviewReceipt;
 private appliedAt:number|null=null;
 private feedback:SelectionFeedbackEvent[]=[];
 observe(s:Snapshot){
  const {observedDestinationKeys,placeEvidence,importantPlaces,...observed}=s;
  // Citation IDs encode lastSeen and change even when every observed fact is
  // identical. Normalize only this bookkeeping copy; prompts retain exact IDs.
  const evidence=placeEvidence?.map(({id,...facts})=>facts);
  const places=importantPlaces?.map(({evidenceId,...facts})=>facts);
  const key=JSON.stringify(withoutObservationClocks({...observed,placeEvidence:evidence,importantPlaces:places}));
  if(key!==this.observationKey){this.observationKey=key;this.observationSerial++;}
  return this.observationSerial;
 }
 basis(planVersion:number,observationVersion=this.observationSerial):ReviewBasis{return {planVersion,observationVersion,feedbackVersion:this.feedback.length};}
 begin(basis:ReviewBasis,reasons:string[],now:number){const request={...basis,id:++this.requestSerial,requestedAt:now,reasons:[...reasons]};this.current=request;return structuredClone(request);}
 covers(basis:ReviewBasis){
  const same=(r:ReviewBasis)=>r.planVersion===basis.planVersion&&r.observationVersion===basis.observationVersion&&r.feedbackVersion===basis.feedbackVersion;
  return !!(this.current&&same(this.current)||this.lastCompleted?.status==='applied'&&same(this.lastCompleted));
 }
 finish(request:ReviewRequest,status:ReviewReceipt['status'],now:number,planVersion?:number){
  if(this.current?.id!==request.id)return;
  this.lastCompleted={...request,completedAt:now,status,...(status==='applied'?{appliedPlanVersion:planVersion}:{})};this.current=undefined;
  if(status==='applied'){
   this.appliedAt=now;
   // Review only evidence included in this request, not failures that arrived later.
   for(const event of this.feedback)if(event.id<=request.feedbackVersion&&event.status==='unreviewed'){event.status='reviewed';event.reviewedByPlanVersion=planVersion;}
  }
 }
 noteFeedback(feedback:string,basis:ReviewBasis,now:number){
  const event:SelectionFeedbackEvent={id:this.feedback.length+1,at:now,planVersion:basis.planVersion,observationVersion:basis.observationVersion,status:'unreviewed',feedback};
  this.feedback.push(event);return structuredClone(event);
 }
 actionStarted(now:number){for(const event of this.feedback)if(event.status==='unreviewed'){event.status='action_started';event.actionStartedAt=now;}}
 feedbackStatus():SelectionFeedbackStatus{
  const current=this.feedback.at(-1),history=this.feedback.slice(0,-1).slice(-8);
  return structuredClone({...(current?{current}:{}),history,total:this.feedback.length,omittedHistoryCount:Math.max(0,this.feedback.length-history.length-(current?1:0))});
 }
 state(planVersion:number,queuedReasons:string[],now:number):PlanningState{
  return structuredClone({planVersion,appliedAt:this.appliedAt,ageMs:this.appliedAt===null?null:Math.max(0,now-this.appliedAt),medium:{pending:!!this.current,...(this.current?{current:this.current}:{}),...(this.lastCompleted?{lastCompleted:this.lastCompleted}:{}),queuedReasons:[...queuedReasons]}});
 }
}

// Never copy arbitrary provider messages, request bodies or URLs into diagnostics.
export function safeDecisionError(error:unknown){
 const message=error instanceof Error?error.message:'';
 const api=/^API (http|transport|missing_usage|response_json)(?: (\d{3}))?(?:;|$)/.exec(message);
 const status=api?.[2]??/\b(?:HTTP|API)\s+(\d{3})\b/i.exec(message)?.[1];
 const category=error instanceof Error&&error.name==='AbortError'?'aborted':error instanceof Error&&error.name==='TimeoutError'?'timeout':status?'provider_http':api?'provider_'+api[1]:/^API .*budget/i.test(message)?'budget_limit':/^Missing API key$/.test(message)?'configuration':/cooldown|backoff|overload/i.test(message)?'provider_backoff':/^Invalid .*?(answer|selection|supervisor|model)/i.test(message)?'invalid_selector_response':'unclassified';
 return {category,...(status?{status:Number(status)}:{})};
}
