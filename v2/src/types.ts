import {supportsFeet} from './building.js';
import {reachedCell} from './reach.js';
import {compatible} from './equipment.js';
export type Action = 'idle' | 'mine' | 'deposit' | 'eat' | 'follow' | 'move' | 'craft' | 'look' | 'attack' | 'flee' | 'place_table' | 'inspect_container' | 'withdraw' | 'give' | 'place_block' | 'pickup' | 'equip';
export type Interaction = {equip?:import('./equipment.js').EquipRequest;pickup?:import('./pickup.js').PickupRequest;build?:import('./building.js').BuildRequest;mine?:import('./building.js').DigRequest;container?: {x:number;y:number;z:number}; transfer?: {item:string;count:number;recipient?:string;slot?:'input'|'fuel'|'output'}};
export type Plan = Interaction & { userRequest?:string|null; goalUpdates?:import('./goals.js').GoalDraft[]; activeGoalId?:string|null; speech?:import('./social.js').Speech; activeStepId?: string; longTermGoal?: string; goalRevisionReason?: string; steps?: import('./planning.js').Step[]; goal: string; preferred: Action; say?: string; destination?: { x: number; y: number; z: number }; craft?: { item: string; count: number }; look?: { yaw: number; pitch: number } };
export type DecisionPlan = Omit<Plan,'preferred'> & {preferred?:Action;recentOutcome?:{action:Action;outcome:import('./planning.js').Outcome;result:string;changes:ReturnType<typeof import('./planning.js').changes>}};
export type Snapshot = {
  dimension?:string;environment?:{inWater:boolean;inLava:boolean;onGround:boolean;oxygen?:number};
  lifecycle?:{generation:number;deathCount:number;phase:'alive'|'dead'|'connecting';lastDeath?:import('./recovery.js').DeathExperience};
  recovery?:ReturnType<import('./recovery.js').RecoveryMemory['context']>;
  visibleItems?:import('./pickup.js').VisibleItem[];
  placeableItems?:string[];
  containers?: {kind?:string;progress?:number|null;fuel?:number|null;slots?:{input:{name:string;count:number}|null;fuel:{name:string;count:number}|null;output:{name:string;count:number}|null};position:{x:number;y:number;z:number};observedAt:number;items:{name:string;count:number}[]}[];
  canPlaceTable?: boolean;
  nearbyPlayers?:{name:string;position:{x:number;y:number;z:number}}[];
  chatEvents?:import('./social.js').ChatEvent[];
  social?:ReturnType<import('./social.js').SocialMemory['context']>;
  memoryGuidance?: import('./experience-memory.js').Guide[];
  incomingDamage?: import('./incoming-damage.js').IncomingEvent[];
  combatEvents?: import("./combat-evidence.js").CombatEvidence[];
  enemies?: import('./combat.js').Enemy[];
  equipment?: { slot: string; name: string; durabilityUsed?: number }[];
  encounters?: import('./combat.js').Encounter[];
  inventory?: { name: string; count: number; slot: number; enchants?:{name:string;lvl:number}[];durabilityUsed?:number }[];
  vision?: { yaw: number; pitch: number; blocks: import('./vision.js').SeenBlock[] };
  places?: import('./vision.js').SeenBlock[];
  craftable?: string[];
  ready: boolean; health: number; food: number; logs: number;
  canMine: boolean; canDeposit: boolean; canEat: boolean; canFollow: boolean;
  position: { x: number; y: number; z: number };
  messages: string[];
  recipeBook: { initialized: boolean; unlocked: string[] };
};
export interface World {
  snapshot(): Snapshot;
  execute(action: Action, signal: AbortSignal, plan?: Plan): Promise<string>;
  stop(): void;
  chat(text: string): void;
  close(): void;
}
export type Log = (event: string, fields?: Record<string, unknown>) => void;
export type Decision = { action: Action; confidence: number };
export interface Brain {
  reviewGoals?(state:Snapshot,context:import('./planning.js').PlanningContext,signal:AbortSignal):Promise<{goalUpdates:import('./goals.js').GoalDraft[];activeGoalId:string|null;recoveryDecision?:{deathId:string;strategy:'recover'|'prepare'|'defer'|'abandon'|'resolved';reason:string}}>;
  supervise?(state:Snapshot,input:import('./supervision.js').SupervisorInput,signal:AbortSignal):Promise<import('./supervision.js').Supervision>;
  communicate?(state:Snapshot,plan:Plan,signal:AbortSignal,execution?:{activeAction:Action|null;planPending:boolean}):Promise<import('./social.js').Speech|null>;
  readonly reflectionModel?:string;
  reflect?(input:import('./experience-memory.js').Reflection,signal:AbortSignal):Promise<unknown>;
  plan(state: Snapshot, history: string[], signal: AbortSignal, userGoal?: string | null, context?: import('./planning.js').PlanningContext): Promise<Plan>;
  choose(state: Snapshot, plan: DecisionPlan, candidates: Action[], signal: AbortSignal): Promise<Decision>;
}
export const actions: Action[] = ['idle', 'mine', 'deposit', 'eat', 'follow', 'move', 'craft', 'look', 'attack', 'flee', 'place_table', 'inspect_container', 'withdraw', 'give', 'place_block', 'pickup', 'equip'];
export function hasMiningTool(s:Snapshot,r:import('./building.js').DigRequest){return !r.tool&&r.toolSlot===undefined||!!s.inventory?.some(i=>(!r.tool||i.name===r.tool)&&(r.toolSlot===undefined||i.slot===r.toolSlot));}
export function knownDestination(s:Pick<Snapshot,'places'|'dimension'|'recovery'>,p:Snapshot['position']){return s.places?.some(b=>b.position.x===p.x&&b.position.y===p.y&&b.position.z===p.z)||s.recovery?.deaths.some(d=>!!s.dimension&&d.dimension===s.dimension&&Math.floor(d.position.x)===p.x&&Math.floor(d.position.y)===p.y&&Math.floor(d.position.z)===p.z);}
export function candidates(s: Snapshot, plan?: Plan): Action[] {
  if (!s.ready || s.health <= 0) return ['idle'];
  if(s.health<=6)return s.enemies?.length ? ['idle','flee'] : s.canEat&&s.food<20 ? ['idle','eat'] : ['idle'];
  const chest=!!plan?.container && s.vision?.blocks.some(b=>['chest','furnace','blast_furnace','smoker'].includes(b.name)&&['x','y','z'].every(k=>(b.position as any)[k]===(plan.container as any)[k]));
  const t=plan?.transfer; const carried=t && (s.inventory??[]).filter(i=>i.name===t.item&&i.slot>=9&&i.slot<=44).reduce((n,i)=>n+i.count,0)>=t.count;
  const build=plan?.build,dig=plan?.mine;
  const seen=(p:{x:number;y:number;z:number})=>s.vision?.blocks.find(b=>b.position.x===p.x&&b.position.y===p.y&&b.position.z===p.z);
  return ['idle', ...(plan?.equip && (plan.equip.item===null || compatible(plan.equip.item,plan.equip.destination)&&s.inventory?.some(i=>i.name===plan.equip!.item&&(plan.equip!.sourceSlot===undefined||i.slot===plan.equip!.sourceSlot))) ? ['equip'] : []), ...(plan?.pickup && !s.enemies?.length && s.visibleItems?.some(i=>i.id===plan.pickup!.entityId&&i.name===plan.pickup!.expected) ? ['pickup'] : []), ...(build && s.placeableItems?.includes(build.item) && seen(build.reference) ? ['place_block'] : []), ...(dig && hasMiningTool(s,dig) && !supportsFeet(dig.position,s.position) && seen(dig.position)?.name===dig.expected ? ['mine'] : []), ...(s.canPlaceTable ? ['place_table'] : []), ...(chest ? ['inspect_container'] : []), ...(chest && t ? ['withdraw'] : []), ...(carried && s.nearbyPlayers?.some(p=>p.name===t!.recipient) ? ['give'] : []), ...(s.enemies?.length ? ['attack','flee'] : []), ...(s.vision ? ['look'] : []), ...(plan?.destination && !reachedCell(s.position,plan.destination,2) && knownDestination(s,plan.destination) ? ['move'] : []), ...(plan?.craft && s.inventory ? ['craft'] : []), ...(chest && carried ? ['deposit'] : []),
    ...(s.canEat ? ['eat'] : []), ...(s.canFollow ? ['follow'] : [])] as Action[];
}
