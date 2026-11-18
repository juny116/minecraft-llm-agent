// Turns repeated non-progress into an actual change of the offered options. In FREE3 the goal layer wrote "do not
// select (-461,71,233)" for 27 minutes while JEV kept being offered that cell (47 self-cancelled mines) and kept
// withdrawing the same action from the same candidates (Alice mine 735, Bob place_block 631 withdrawals).
type Pos={x:number;y:number;z:number};
export const TARGET_REPEATS=3,TARGET_WINDOW_MS=300000,TARGET_EXCLUDE_MS=300000,WITHDRAW_REPEATS=8,ACTION_SUPPRESS_MS=90000;
export type ExcludedTarget={action:string;position:Pos;until:number;reason:string};
export type SuppressedAction={action:string;until:number;reason:string};
const cell=(p:Pos)=>`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;

export class StuckGuard{
 private attempts=new Map<string,number[]>();private targets=new Map<string,ExcludedTarget>();
 private withdrawals=new Map<string,{signature:string;count:number}>();private actions=new Map<string,SuppressedAction>();
 // A finished mine/place_block/move/pickup whose outcome did not make progress.
 recordResult(action:string,position:Pos|undefined,outcome:string,now=Date.now()){
  if(!position)return;
  if(outcome==='succeeded'){this.attempts.delete(`${action}@${cell(position)}`);return;}
  if(!['failed','cancelled','partial'].includes(outcome))return;
  const key=`${action}@${cell(position)}`,times=[...(this.attempts.get(key)??[]).filter(t=>now-t<TARGET_WINDOW_MS),now];this.attempts.set(key,times);
  if(times.length>=TARGET_REPEATS){this.targets.set(key,{action,position:{x:Math.floor(position.x),y:Math.floor(position.y),z:Math.floor(position.z)},until:now+TARGET_EXCLUDE_MS,reason:`${times.length} ${action} attempts at this cell ended ${outcome} or without progress within ${TARGET_WINDOW_MS/60000} min`});this.attempts.delete(key);}
 }
 // JEV chose an action and then withdrew it at argument selection, with these offered candidates.
 recordWithdrawal(action:string,offered:unknown,now=Date.now()){
  const signature=JSON.stringify(offered)??'',w=this.withdrawals.get(action);
  const count=w&&w.signature===signature?w.count+1:1;this.withdrawals.set(action,{signature,count});
  if(count>=WITHDRAW_REPEATS){this.actions.set(action,{action,until:now+ACTION_SUPPRESS_MS,reason:`selected and withdrawn ${count} times in a row with the same offered candidates`});this.withdrawals.delete(action);}
 }
 executed(action:string){this.withdrawals.delete(action);}
 excludedTargets(now=Date.now()){for(const [k,v] of this.targets)if(v.until<=now)this.targets.delete(k);return [...this.targets.values()];}
 suppressedActions(now=Date.now()){for(const [k,v] of this.actions)if(v.until<=now)this.actions.delete(k);return [...this.actions.values()];}
 view(now=Date.now()){
  const targets=this.excludedTargets(now),actions=this.suppressedActions(now);
  return targets.length||actions.length?{excludedTargets:targets.map(t=>({...t,secondsLeft:Math.round((t.until-now)/1000)})),suppressedActions:actions.map(a=>({...a,secondsLeft:Math.round((a.until-now)/1000)})),meaning:'Temporarily removed from the offered options because repeated attempts made no progress; they return when the time runs out. Choose a different target, action or place meanwhile.'}:undefined;
 }
}
export function isExcluded(excluded:ExcludedTarget[]|undefined,action:string,p:Pos){return !!excluded?.some(t=>t.action===action&&t.position.x===Math.floor(p.x)&&t.position.y===Math.floor(p.y)&&t.position.z===Math.floor(p.z));}
