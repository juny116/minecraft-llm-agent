import {supportsFeet} from './building.js';
import {moveReached} from './action-contracts.js';
import {compatible} from './equipment.js';
export type Action = 'idle' | 'mine' | 'deposit' | 'eat' | 'follow' | 'move' | 'craft' | 'look' | 'attack' | 'flee' | 'place_table' | 'inspect_container' | 'withdraw' | 'give' | 'place_block' | 'pickup' | 'equip';
export type Interaction = {equip?:import('./equipment.js').EquipRequest;pickup?:import('./pickup.js').PickupRequest;build?:import('./building.js').BuildRequest;mine?:import('./building.js').DigRequest;container?: {x:number;y:number;z:number}; transfer?: {item:string;count:number;recipient?:string;slot?:'input'|'fuel'|'output'}};
export type WorkIntent={description:string;desiredInventory:{item:string;count:number}[];constraints:string[]};
export type Plan = Interaction & {modelSelected?:boolean;waitMs?:number;foodItem?:string;followPlayer?:string;targetEntityId?:number;placeUpdates?:import('./important-places.js').PlaceUpdate[];intent?:WorkIntent;proposals?:Plan[]; userRequest?:string|null; goalUpdates?:import('./goals.js').GoalDraft[]; activeGoalId?:string|null; speech?:import('./social.js').Speech; activeStepId?: string; longTermGoal?: string; goalRevisionReason?: string; steps?: import('./planning.js').Step[]; goal: string; preferred: Action; say?: string; destination?: { x: number; y: number; z: number }; craft?: { item: string; count: number; workstation?:{x:number;y:number;z:number} }; look?: { yaw: number; pitch: number } };
export type DecisionPlan = Omit<Plan,'preferred'> & {preferred?:Action;recentOutcome?:{action:Action;outcome:import('./planning.js').Outcome;result:string;changes:ReturnType<typeof import('./planning.js').changes>}};
export type Snapshot = {
  perception?:{mode:'panorama';range:number;semantics?:string;occlusion?:{direction:string;surface:import('./vision.js').SeenBlock|null}[]};
  spatial?:ReturnType<typeof import('./spatial-context.js').spatialContext>;
  importantPlaces?:import('./important-places.js').ImportantPlace[];
  placeEvidence?:import('./important-places.js').PlaceEvidence[];
  // Motor validation only; never sent to model prompts.
  observedDestinationKeys?: string[];
  navigationTargets?: {x:number;y:number;z:number}[];
  dimension?:string;environment?:{inWater:boolean;inLava:boolean;onGround:boolean;oxygen?:number};
  lifecycle?:{generation:number;deathCount:number;phase:'alive'|'dead'|'connecting';lastDeath?:import('./recovery.js').DeathExperience};
  recovery?:ReturnType<import('./recovery.js').RecoveryMemory['context']>;
  visibleItems?:import('./pickup.js').VisibleItem[];
  placeableItems?:string[];
  edibleItems?:string[];
  inventoryCraftable?:string[];
  placementSites?:{position:Snapshot["position"];reference:Snapshot["position"]}[];
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
  canMine: boolean; canDeposit: boolean; foodAvailable?:boolean; canEat: boolean; canFollow: boolean;
  position: { x: number; y: number; z: number };
  messages: string[];
  recipeBook: { initialized: boolean; unlocked: string[] };
};
export type MotorProgress={phase:'approach'|'prepare'|'digging'|'collecting'|'equipping'|'aiming'|'placing'|'confirming'|'opening'|'transferring'|'crafting'|'tracking';phaseElapsedMs:number;estimatedDigMs?:number;estimatedRemainingMs?:number;digBudgetMs?:number;estimateCapped?:boolean;blockBroken:boolean;placementRequestIssued?:boolean;phaseMeaning?:string};
export interface World {
 importantPlaces?:import('./important-places.js').ImportantPlaces;
  executionProgress?():MotorProgress|undefined;
  executionReceipt?():Record<string,unknown>|undefined;
  snapshot(): Snapshot;
  execute(action: Action, signal: AbortSignal, plan?: Plan): Promise<string>;
  stop(): void;
  chat(text: string): void;
  close(): void;
}
export type Log = (event: string, fields?: Record<string, unknown>) => void;
export type Decision = { action: Action; confidence: number };
export interface Brain {
 readonly parameterSelection?:boolean;
  reviewGoals?(state:Snapshot,context:import('./planning.js').PlanningContext,signal:AbortSignal):Promise<{goalUpdates:import('./goals.js').GoalDraft[];activeGoalId:string|null;recoveryDecision?:{deathId:string;strategy:'recover'|'prepare'|'defer'|'abandon'|'resolved';reason:string}}>;
  supervise?(state:Snapshot,input:import('./supervision.js').SupervisorInput,signal:AbortSignal):Promise<import('./supervision.js').Supervision>;
  communicate?(state:Snapshot,plan:Plan,signal:AbortSignal,execution?:{activeAction:Action|null;planPending:boolean;feedback?:string}):Promise<import('./social.js').Speech|null>;
  readonly reflectionModel?:string;
  reflect?(input:import('./experience-memory.js').Reflection,signal:AbortSignal):Promise<unknown>;
  plan(state: Snapshot, history: string[], signal: AbortSignal, userGoal?: string | null, context?: import('./planning.js').PlanningContext): Promise<Plan>;
  choose(state: Snapshot, plan: DecisionPlan, candidates: Action[], signal: AbortSignal): Promise<Decision>;
}
export const actions: Action[] = ['idle', 'mine', 'deposit', 'eat', 'follow', 'move', 'craft', 'look', 'attack', 'flee', 'place_table', 'inspect_container', 'withdraw', 'give', 'place_block', 'pickup', 'equip'];
export function hasMiningTool(s:Snapshot,r:import('./building.js').DigRequest){return !r.tool&&r.toolSlot===undefined||!!s.inventory?.some(i=>(!r.tool||i.name===r.tool)&&(r.toolSlot===undefined||i.slot===r.toolSlot));}
export function knownDestination(s:Pick<Snapshot,'places'|'dimension'|'recovery'|'navigationTargets'|'observedDestinationKeys'|'importantPlaces'>,p:Snapshot['position']){return !!(s.importantPlaces?.some(b=>b.dimension===s.dimension&&b.position.x===p.x&&b.position.y===p.y&&b.position.z===p.z)||s.observedDestinationKeys?.includes([p.x,p.y,p.z].join(','))||s.navigationTargets?.some(b=>b.x===p.x&&b.y===p.y&&b.z===p.z)||s.places?.some(b=>b.position.x===p.x&&b.position.y===p.y&&b.position.z===p.z)||s.recovery?.deaths.some(d=>!!s.dimension&&d.dimension===s.dimension&&Math.floor(d.position.x)===p.x&&Math.floor(d.position.y)===p.y&&Math.floor(d.position.z)===p.z));}
// Current observations override fallible remembered cells; keep the work domain local.
export function workBlocks(s:Pick<Snapshot,'vision'|'places'|'position'>){
 const cells=new Map<string,NonNullable<Snapshot['vision']>['blocks'][number]>();
 for(const b of [...s.places??[],...s.vision?.blocks??[]])if(s.vision?.blocks.includes(b)||Math.hypot(b.position.x-s.position.x,b.position.y-s.position.y,b.position.z-s.position.z)<=48)cells.set(`${b.position.x},${b.position.y},${b.position.z}`,b);
 return [...cells.values()];
}
export function candidates(s: Snapshot, plan?: Plan): Action[] {
  if (!s.ready || s.health <= 0) return ['idle'];
  if(!plan?.modelSelected&&s.health<=6)return s.enemies?.length ? ['idle','flee'] : s.canEat&&s.food<20 ? ['idle','eat'] : ['idle'];
  const chest=!!plan?.container && workBlocks(s).some(b=>['chest','furnace','blast_furnace','smoker'].includes(b.name)&&['x','y','z'].every(k=>(b.position as any)[k]===(plan.container as any)[k]));
  const t=plan?.transfer; const carried=t && (s.inventory??[]).filter(i=>i.name===t.item&&i.slot>=9&&i.slot<=44).reduce((n,i)=>n+i.count,0)>=t.count;
  const build=plan?.build,dig=plan?.mine;
  const seen=(p:{x:number;y:number;z:number})=>workBlocks(s).find(b=>b.position.x===p.x&&b.position.y===p.y&&b.position.z===p.z);
  return ['idle', ...(plan?.equip && (plan.equip.item===null || compatible(plan.equip.item,plan.equip.destination)&&s.inventory?.some(i=>i.name===plan.equip!.item&&(plan.equip!.sourceSlot===undefined||i.slot===plan.equip!.sourceSlot))) ? ['equip'] : []), ...(plan?.pickup && (plan?.modelSelected||!s.enemies?.length) && s.visibleItems?.some(i=>i.id===plan.pickup!.entityId&&i.name===plan.pickup!.expected) ? ['pickup'] : []), ...(build && s.placeableItems?.includes(build.item) && seen(build.reference) ? ['place_block'] : []), ...(dig && hasMiningTool(s,dig) && (plan?.modelSelected||!supportsFeet(dig.position,s.position)) && seen(dig.position)?.name===dig.expected ? ['mine'] : []), ...((s.perception?.mode==='panorama'?false:plan?.modelSelected?!!build&&build.item==='crafting_table'&&!!seen(build.reference):s.canPlaceTable) ? ['place_table'] : []), ...(chest ? ['inspect_container'] : []), ...(chest && t ? ['withdraw'] : []), ...(carried && s.nearbyPlayers?.some(p=>p.name===t!.recipient) ? ['give'] : []), ...((plan?.modelSelected?s.enemies?.some(e=>e.id===plan.targetEntityId):s.enemies?.length) ? ['attack','flee'] : []), ...((s.perception?.mode!=='panorama'&&s.vision&&(!plan?.modelSelected||!!plan.look&&Number.isFinite(plan.look.yaw)&&Number.isFinite(plan.look.pitch))) ? ['look'] : []), ...(plan?.destination && !moveReached(s.position,plan.destination) && knownDestination(s,plan.destination) ? ['move'] : []), ...(plan?.craft && s.inventory ? ['craft'] : []), ...(chest && carried ? ['deposit'] : []),
    ...((s.canEat&&(!plan?.modelSelected||s.edibleItems?.includes(plan.foodItem??''))) ? ['eat'] : []), ...((plan?.modelSelected?s.nearbyPlayers?.some(p=>p.name===plan.followPlayer):s.canFollow) ? ['follow'] : [])] as Action[];
}
