import type { Position } from './vision.js';
// One attack runs until the target dies or this bound; JEV still judges continue/stop meanwhile. A 3 s attempt
// ended before a stone-sword zombie kill (4 hits), and each new decision left the bot standing while it was hit.
export const COMBAT_BUDGET_MS=8000, COMBAT_REACH=2.8, REACQUIRE_MS=800;
// Between swings a target closer than this is backed away from (hit and step back), so a melee mob has to walk
// into reach again instead of hitting a bot that stands still through the cooldown.
export const BACKSTEP_DISTANCE=2.4;
// Flee keeps moving until the target and every visible hostile are this far away (or the flee budget ends; the
// runtime's 20 s action timeout bounds it). In CONT6 flees ended once one zombie was 16 blocks away, the bot stood
// still awaiting the next decision, the group closed in again and it died 21 times.
export const FLEE_BUDGET_MS=18000, FLEE_SAFE_DISTANCE=24, FLEE_RETARGET_MS=1500;
export const combatCooldownMs=(item?:string)=>item?.endsWith('_sword')?700:item?.endsWith('_axe')?1250:2000;
export const ATTACK_DESCRIPTION='Approach and attack a model-selected visible enemy or passive animal with the currently held equipment. The target need not already be in swing reach. Equip separately if desired; the local motor handles pursuit, swing cooldown and repeated attacks within a bounded attempt. See execution.combatContract and motor.combat for timing and progress.';
export type CombatProgress={targetId:number;mode:'approach'|'cooldown'|'strike'|'reobserve'|'retreat'|'finished';observedAt:number;targetVisible:boolean;distance?:number;reach:number;attemptElapsedMs:number;skillElapsedMs:number;budgetMs:number;cooldownMs:number;nextSwingInMs:number;attacksSent:number;outcome?:string};
export type Enemy = { id: number; kind: string; position: Position; distance: number };
export type Encounter = { kind: string; action: 'attack'|'flee'; startedAt: number; healthBefore: number; healthAfter: number; attacksSent: number | null; outcome: string; targetId?:number; confirmedOwnHits?:number; targetDeathObserved?:boolean; ownKillConfirmed?:boolean };
export const animalKinds=new Set(['sheep','cow','pig','chicken','rabbit','mooshroom']);
// Species identification only: no damage, HP, armor, difficulty or danger scores.
export const hostileKinds = new Set(['zombie','husk','drowned','zombie_villager','skeleton','stray','bogged','wither_skeleton','creeper','spider','cave_spider','slime','magma_cube','silverfish','endermite','witch','pillager','vindicator','evoker','ravager','vex','blaze','ghast','phantom','guardian','elder_guardian','hoglin','piglin_brute','warden','wither']);
export const distance = (a: Position,b: Position) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
export interface CombatPort {
  progress?(value:CombatProgress):void;
  observe(): { health: number; position: Position; enemies: Enemy[] };
  faceLastSeen?(position:Position,signal:AbortSignal):Promise<void>;
  targetEvidence?(id:number): {confirmedOwnHits:number;deathObserved:boolean;ownKillConfirmed:boolean}|undefined;
  equipWeapon(): Promise<void>;
  cooldownMs(): number;
  approach(enemy: Enemy): void;
  strike(id: number): Promise<boolean>;
  // Face the enemy and step back from it while the swing recharges; false when the floor behind is unsafe or a
  // further threat stands there.
  backstep?(enemy: Enemy, others: Position[]): boolean;
  // Away from the first position and from any further threats (other visible hostiles).
  retreat(from: Position, others?: Position[]): boolean;
  stop(): void;
  wait(ms:number,signal:AbortSignal):Promise<void>;
  now(): number;
}
// Short local skills return control to JEV; no per-swing model requests.
export async function combat(port: CombatPort, action:'attack'|'flee', signal:AbortSignal,selection?:{targetId:number;modelSelected?:boolean}): Promise<Encounter> {
  signal.throwIfAborted();
  const observed=port.observe();
  const initial={...observed,position:{...observed.position}};
  const target=selection?initial.enemies.find(e=>e.id===selection.targetId):[...initial.enemies].sort((a,b)=>a.distance-b.distance)[0];
  if(!target) throw new Error('No visible selected target');
  const record:Encounter={targetId:target.id,kind:target.kind,action,startedAt:port.now(),healthBefore:initial.health,healthAfter:initial.health,attacksSent:0,outcome:'time_limit'};
  let lastSeen={...target.position}, lastStrike=-Infinity, lostSince:number|undefined,skillStarted:number|undefined;
  const report=(mode:CombatProgress['mode'],current?:Enemy)=>port.progress?.({targetId:target.id,mode,observedAt:port.now(),targetVisible:!!current,...(current?{distance:current.distance}:{}),reach:COMBAT_REACH,attemptElapsedMs:Math.max(0,port.now()-record.startedAt),skillElapsedMs:skillStarted===undefined?0:Math.max(0,port.now()-skillStarted),budgetMs:COMBAT_BUDGET_MS,cooldownMs:port.cooldownMs(),nextSwingInMs:Math.max(0,port.cooldownMs()-(port.now()-lastStrike)),attacksSent:record.attacksSent??0,...(mode==='finished'?{outcome:record.outcome}:{})});
  try {
    if(action==='attack'){await port.equipWeapon();signal.throwIfAborted();lastStrike=port.now();}
    const others=(s:{enemies:Enemy[]})=>s.enemies.filter(e=>e.id!==target.id&&e.distance<=FLEE_SAFE_DISTANCE).map(e=>({...e.position}));
    if(action==='flee'&&!port.retreat(lastSeen,others(initial))){record.outcome='no_known_retreat_path';return record;}
    const start=port.now();skillStarted=start;
    let retargetAt=start+FLEE_RETARGET_MS;
    while(port.now()-start<(action==='flee'?FLEE_BUDGET_MS:COMBAT_BUDGET_MS)){
      signal.throwIfAborted();
      const s=port.observe();record.healthAfter=s.health;
      if(s.health<=0){record.outcome='dead';break;}
      const evidence=port.targetEvidence?.(target.id);
      if(evidence?.deathObserved){record.outcome=evidence.ownKillConfirmed?'target_defeated':'target_death_observed';break;}
      const current=s.enemies.find(e=>e.id===target.id);
      if(action==='attack'){
        if(!selection?.modelSelected&&s.health<=6){record.outcome='low_health_stop';break;}
        if(!current){
          report('reobserve');port.stop();
          if(!port.faceLastSeen){record.outcome='target_left_view';break;}
          lostSince??=port.now();
          if(port.now()-lostSince>=REACQUIRE_MS){record.outcome='target_left_view';break;}
          // Turn only toward a previously observed point. Never read hidden coordinates.
          await port.faceLastSeen(lastSeen,signal);signal.throwIfAborted();
          await port.wait(100,signal);continue;
        }
        lostSince=undefined;
        lastSeen={...current.position};
        if(current.distance>COMBAT_REACH){report('approach',current);port.approach(current);}
        else {
          const ready=port.now()-lastStrike>=port.cooldownMs();
          report(ready?'strike':'cooldown',current);
          if(ready||current.distance>=BACKSTEP_DISTANCE||!port.backstep?.(current,others(s)))port.stop();
          if(ready){
            if(await port.strike(current.id)){record.attacksSent=(record.attacksSent ?? 0)+1;lastStrike=port.now();}
            else {record.outcome='target_left_view';break;}
          }
        }
      } else {
        report('retreat',current);if(current)lastSeen={...current.position};
        // If hidden, use its last visible location, never hidden live coordinates.
        const near=others(s);
        if(!near.length&&distance(s.position,lastSeen)>=Math.max(FLEE_SAFE_DISTANCE,distance(initial.position,target.position)+2)){record.outcome='distance_increased';break;}
        if(port.now()>=retargetAt){retargetAt=port.now()+FLEE_RETARGET_MS;port.retreat(lastSeen,near);}
      }
      await port.wait(100,signal);
    }
    return record;
  } catch(e){record.outcome=signal.aborted?'cancelled':'failed';throw e;}
  finally {record.healthAfter=port.observe().health;const e=port.targetEvidence?.(target.id);if(e){record.confirmedOwnHits=e.confirmedOwnHits;record.targetDeathObserved=e.deathObserved;record.ownKillConfirmed=e.ownKillConfirmed;if(action==='attack'&&record.outcome==='time_limit'&&e.deathObserved)record.outcome=e.ownKillConfirmed?'target_defeated':'target_death_observed';}report('finished',port.observe().enemies.find(e=>e.id===target.id));port.stop();}
}

export function combatExecutionContract(s:import('./types.js').Snapshot,e:{action:string}|null|undefined){
 if(!e||!['attack','flee'].includes(e.action))return undefined;
 const held=s.equipment?.find(i=>i.slot==='hand')?.name;
 return {heldItem:held??null,budgetMs:COMBAT_BUDGET_MS,reach:COMBAT_REACH,...(held?{initialAndBetweenSwingDelayMs:combatCooldownMs(held)}:{}),meaning:'Local execution mechanics, not enemy strength. Attack includes approach and repeated swings. A new attack waits the initial delay again; continue does not restart it. motor.combat reports actual phase/timing when available. Missing swing telemetry is unknown, not zero. Stopping remains available; the contract does not recommend an action.'};
}

// Melee preference: swords by material tier, then axes by tier; 0 for anything else.
const TIERS=['wooden','golden','stone','iron','diamond','netherite'];
export function weaponRank(name:string){
 const m=/^(wooden|golden|stone|iron|diamond|netherite)_(sword|axe)$/.exec(name);if(!m)return 0;
 return (m[2]==='sword'?10:1)+TIERS.indexOf(m[1]);
}
