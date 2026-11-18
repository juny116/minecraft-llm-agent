import type {GoalBook,ReviewTrigger} from './goals.js';
import type {RecoveryMemory} from './recovery.js';
import type {Snapshot} from './types.js';

// Item entities despawn after 6000 game ticks while their chunk is loaded.
export const ITEM_DESPAWN_MS=300000;
export const STARTUP_ORIENTATION='Provisional: observe surroundings and own survival state until the first goal review';
const TO_DECIDE:Record<ReviewTrigger,string[]>={
 startup:['Whether a restored intention or current observations justify the first active goal'],
 operator_request_changed:['How the new operator request relates to the current intention'],
 disconnected:['Whether position, inventory and surroundings still support the intention after time offline'],
 reconnect:['Whether position, inventory and surroundings still support the intention after time offline'],
 death:['Whether to recover dropped items now, after preparation, later or never','Whether the intention is still feasible with the current inventory'],
 respawn_after_death:['Whether to recover dropped items now, after preparation, later or never','Whether the intention is still feasible with the current inventory'],
 stalled:['The active goal made no progress for a long time: pause or abandon it and choose a DIFFERENT active goal that current inventory and observations can advance (keeping it is rejected)'],
};
const counts=(items:Snapshot['inventory']|undefined)=>{const out:Record<string,number>={};for(const i of items??[])out[i.name]=(out[i.name]??0)+i.count;return out;};

// Facts for the latest death. Values are computed from records; nothing here recommends recovery.
export function deathFacts(recovery:RecoveryMemory,s:Snapshot,now=Date.now()){
 const d=recovery.context().deaths.at(-1);if(!d)return undefined;
 const elapsedMs=now-d.at,before=counts(d.inventory),after=counts(d.respawn?.inventory),lostItems:Record<string,number>={};
 for(const [name,n] of Object.entries(before))if(n>(after[name]??0))lostItems[name]=n-(after[name]??0);
 const sameDimension=!d.dimension||!s.dimension||d.dimension===s.dimension;
 return {deathId:d.id,elapsedMs,
  itemDespawn:{rule:'Dropped items despawn about 300 s after dropping while their chunk stays loaded; the timer pauses while unloaded, so the true remaining time is uncertain',maxRemainingMs:Math.max(0,ITEM_DESPAWN_MS-elapsedMs)},
  deathSite:{position:d.position,dimension:d.dimension,distanceFromCurrent:sameDimension?Math.hypot(s.position.x-d.position.x,s.position.y-d.position.y,s.position.z-d.position.z):null},
  lostItems,equipmentAtDeath:d.equipment,possessionsSource:d.possessionsSource,
  observedAtDeath:{enemies:d.enemies,incomingDamage:d.incomingDamage,cause:'unconfirmed'},
  current:{health:s.health,food:s.food,equipment:s.equipment,timeOfDay:s.timeOfDay,time:s.time},
  recoveryOutcome:d.outcome??null};
}

// Why the goal layer is reviewing, what may have changed, and what the review must settle.
export function reviewFacts(goals:GoalBook,recovery:RecoveryMemory|undefined,s:Snapshot,now=Date.now()){
 if(!goals.needsReview)return undefined;
 const st=goals.reviewState,provisional=goals.snapshot().provisionalGoal,death=st.trigger==='death'||st.trigger==='respawn_after_death';
 return {status:'reviewing' as const,trigger:st.trigger,reason:st.reason,since:st.since,elapsedMs:now-st.since,
  provisionalGoal:provisional?{id:provisional.id,description:provisional.description,successCriteria:provisional.successCriteria}:{description:STARTUP_ORIENTATION},
  toDecide:TO_DECIDE[st.trigger],...(death&&recovery?{death:deathFacts(recovery,s,now)}:{}),
  meaning:'The provisional goal is the last reviewed intention, kept visible until the goal layer rechecks it; it is context, not a confirmed current goal.'};
}
