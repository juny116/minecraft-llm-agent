import type { Position } from './vision.js';
export type Enemy = { id: number; kind: string; position: Position; distance: number };
export type Encounter = { kind: string; action: 'attack'|'flee'; startedAt: number; healthBefore: number; healthAfter: number; attacksSent: number | null; outcome: string; targetId?:number; confirmedOwnHits?:number; targetDeathObserved?:boolean; ownKillConfirmed?:boolean };
// Species identification only: no damage, HP, armor, difficulty or danger scores.
export const hostileKinds = new Set(['zombie','husk','drowned','zombie_villager','skeleton','stray','bogged','wither_skeleton','creeper','spider','cave_spider','slime','magma_cube','silverfish','endermite','witch','pillager','vindicator','evoker','ravager','vex','blaze','ghast','phantom','guardian','elder_guardian','hoglin','piglin_brute','warden','wither']);
export const distance = (a: Position,b: Position) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
export interface CombatPort {
  observe(): { health: number; position: Position; enemies: Enemy[] };
  faceLastSeen?(position:Position,signal:AbortSignal):Promise<void>;
  targetEvidence?(id:number): {confirmedOwnHits:number;deathObserved:boolean;ownKillConfirmed:boolean}|undefined;
  equipWeapon(): Promise<void>;
  cooldownMs(): number;
  approach(enemy: Enemy): void;
  strike(id: number): Promise<boolean>;
  retreat(from: Position): boolean;
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
  if(!target) throw new Error('No visible hostile target');
  const record:Encounter={targetId:target.id,kind:target.kind,action,startedAt:port.now(),healthBefore:initial.health,healthAfter:initial.health,attacksSent:0,outcome:'time_limit'};
  let lastSeen={...target.position}, lastStrike=-Infinity, lostSince:number|undefined;
  try {
    if(action==='attack'){await port.equipWeapon();signal.throwIfAborted();lastStrike=port.now();}
    if(action==='flee'&&!port.retreat(lastSeen)){record.outcome='no_known_retreat_path';return record;}
    const start=port.now();
    while(port.now()-start<3000){
      signal.throwIfAborted();
      const s=port.observe();record.healthAfter=s.health;
      if(s.health<=0){record.outcome='dead';break;}
      const evidence=port.targetEvidence?.(target.id);
      if(evidence?.deathObserved){record.outcome=evidence.ownKillConfirmed?'target_defeated':'target_death_observed';break;}
      const current=s.enemies.find(e=>e.id===target.id);
      if(action==='attack'){
        if(!selection?.modelSelected&&s.health<=6){record.outcome='low_health_stop';break;}
        if(!current){
          port.stop();
          if(!port.faceLastSeen){record.outcome='target_left_view';break;}
          lostSince??=port.now();
          if(port.now()-lostSince>=800){record.outcome='target_left_view';break;}
          // Turn only toward a previously observed point. Never read hidden coordinates.
          await port.faceLastSeen(lastSeen,signal);signal.throwIfAborted();
          await port.wait(100,signal);continue;
        }
        lostSince=undefined;
        lastSeen={...current.position};
        if(current.distance>2.8)port.approach(current);
        else {
          port.stop();
          if(port.now()-lastStrike>=port.cooldownMs()){
            if(await port.strike(current.id)){record.attacksSent=(record.attacksSent ?? 0)+1;lastStrike=port.now();}
            else {record.outcome='target_left_view';break;}
          }
        }
      } else {
        if(current)lastSeen={...current.position};
        // If hidden, use its last visible location, never hidden live coordinates.
        if(distance(s.position,lastSeen)>=distance(initial.position,target.position)+2){record.outcome='distance_increased';break;}
      }
      await port.wait(100,signal);
    }
    return record;
  } catch(e){record.outcome=signal.aborted?'cancelled':'failed';throw e;}
  finally {record.healthAfter=port.observe().health;const e=port.targetEvidence?.(target.id);if(e){record.confirmedOwnHits=e.confirmedOwnHits;record.targetDeathObserved=e.deathObserved;record.ownKillConfirmed=e.ownKillConfirmed;if(action==='attack'&&record.outcome==='time_limit'&&e.deathObserved)record.outcome=e.ownKillConfirmed?'target_defeated':'target_death_observed';}port.stop();}
}
