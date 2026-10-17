import type {Brain,Snapshot,Decision} from './types.js';
import {candidates} from './types.js';
export async function chooseCombat(p:{snapshot:()=>Snapshot;brain:Pick<Brain,'choose'>;exhausted:()=>boolean;signal:AbortSignal;minConfidence:number;log:(event:string,detail:unknown)=>void}):Promise<{choice:Decision;state:Snapshot}|undefined>{
 if(!p.exhausted()){
  p.signal.throwIfAborted();
  const state=p.snapshot();
  if(!state.ready||state.health<=10||state.enemies?.length!==1||state.enemies[0].kind!=='zombie')return;
  const started=Date.now();
  const choice=await p.brain.choose(state,{goal:'Choose whether to engage, retreat or wait using current observations'},candidates(state).filter(a=>['idle','attack','flee'].includes(a)),p.signal);
  p.signal.throwIfAborted();
  p.log('jev_choice',{decisionLatencyMs:Date.now()-started,choice,health:state.health,equipment:state.equipment,enemies:state.enemies,incomingDamage:state.incomingDamage});
  const fresh=p.snapshot();
  if(!fresh.ready||fresh.health<=10||fresh.enemies?.length!==1||fresh.enemies[0].id!==state.enemies[0].id||!candidates(fresh).includes(choice.action)){p.log('stale_choice_discarded',{});return;}
  if(choice.confidence<p.minConfidence)p.log('low_confidence_observed',{confidence:choice.confidence,action:choice.action});
  return {choice,state};
 }
}
