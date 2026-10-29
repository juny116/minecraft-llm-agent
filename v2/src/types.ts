import {pickupTargets} from './pickup.js';
import {supportsFeet} from './building.js';
import {moveReached} from './action-contracts.js';
import {compatible} from './equipment.js';
export type Action = 'idle' | 'mine' | 'deposit' | 'eat' | 'follow' | 'move' | 'craft' | 'look' | 'attack' | 'flee' | 'place_table' | 'inspect_container' | 'withdraw' | 'give' | 'place_block' | 'pickup' | 'equip' | 'sleep';
export type Interaction = {bed?:{x:number;y:number;z:number};equip?:import('./equipment.js').EquipRequest;pickup?:import('./pickup.js').PickupRequest;build?:import('./building.js').BuildRequest;mine?:import('./building.js').DigRequest;container?: {x:number;y:number;z:number}; transfer?: {item:string;count:number;recipient?:string;slot?:'input'|'fuel'|'output'}};
export type WorkIntent={taskId?:string;completionCriteria?:{id:string;text:string}[];continuationNote?:{notAppliedDone?:string[];notAppliedDesiredInventory?:{item:string;count:number}[];meaning:string};description:string;desiredInventory:{item:string;count:number}[];constraints:string[]};
// Long-term review's assessment of the operator request; the request text itself is unchanged.
// Goal-layer decision on a message addressed to this bot; dialogue replies follow it.
export type MessageDecision={messageId:string;decision:'accept'|'decline'|'defer'|'no_request'|'keep_advice'|'not_for_me';reason:string};
export type UserRequestStatus={request:string;status:'in_progress'|'fulfilled';reason:string;assessedAt:number};
export type Plan = Interaction & {threatResponse?:import('./threat-response.js').ThreatResponse;destinationTarget?:{kind:string;label:string;source?:string};procedure?:import("./procedure.js").Procedure;taskReview?:import('./task-review.js').TaskReview;modelSelected?:boolean;waitMs?:number;foodItem?:string;followPlayer?:string;targetEntityId?:number;placeUpdates?:import('./important-places.js').PlaceUpdate[];intent?:WorkIntent;proposals?:Plan[]; userRequest?:string|null; goalUpdates?:import('./goals.js').GoalDraft[]; activeGoalId?:string|null; speech?:import('./social.js').Speech; activeStepId?: string; longTermGoal?: string; goalRevisionReason?: string; steps?: import('./planning.js').Step[]; goal: string; preferred: Action; say?: string; destination?: { x: number; y: number; z: number }; craft?: { recipeKey?:string; item: string; count: number; workstation?:{x:number;y:number;z:number} }; look?: { yaw: number; pitch: number } };
export type DecisionPlan = Omit<Plan,'preferred'> & {preferred?:Action;recentOutcome?:{action:Action;outcome:import('./planning.js').Outcome;result:string;changes:ReturnType<typeof import('./planning.js').changes>}};
export type Snapshot = {
  actionAvailability?:ReturnType<typeof import('./selection-facts.js').actionAvailability>;
  actionScopes?:ReturnType<typeof import('./action-domains.js').actionScopes>;
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
  rememberedItems?:import('./pickup.js').RememberedItem[];
  placeableItems?:string[];
  /** Blocks this bot placed that are still in place. */
  respawnPoint?:{kind:'bed';position:{x:number;y:number;z:number};dimension:string}|{kind:'world_spawn'};
  ownPlacedBlocks?:{name:string;position:{x:number;y:number;z:number}}[];
  /** Targets and actions temporarily removed from the offered options after repeated non-progress. */
  stuck?:ReturnType<import('./stuck-guard.js').StuckGuard['view']>;
  edibleItems?:string[];
  inventoryCraftable?:string[];
  placementSites?:{position:Snapshot["position"];reference:Snapshot["position"]}[];
  containers?: {kind?:string;progress?:number|null;fuel?:number|null;slots?:{input:{name:string;count:number}|null;fuel:{name:string;count:number}|null;output:{name:string;count:number}|null};position:{x:number;y:number;z:number};observedAt:number;items:{name:string;count:number}[]}[];
  canPlaceTable?: boolean;
  nearbyPlayers?:{name:string;position:{x:number;y:number;z:number}}[];
  /** Other players currently connected to the server, visible or not; chat reaches all of them. */
  onlinePlayers?:string[];
  chatEvents?:import('./social.js').ChatEvent[];
  selfName?:string;
  social?:ReturnType<import('./social.js').SocialMemory['context']>;
  memoryGuidance?: import('./experience-memory.js').Guide[];
  incomingDamage?: import('./incoming-damage.js').IncomingEvent[];
  combatEvents?: import("./combat-evidence.js").CombatEvidence[];
  sleeping?:boolean;timeOfDay?:number;time?:import('./day-time.js').DayTime;animals?:import('./combat.js').Enemy[];
  enemies?: import('./combat.js').Enemy[];
  equipment?: { slot: string; name: string; durabilityUsed?: number }[];
  encounters?: import('./combat.js').Encounter[];
  inventory?: { name: string; count: number; slot: number; enchants?:{name:string;lvl:number}[];durabilityUsed?:number }[];
  vision?: { yaw: number; pitch: number; blocks: import('./vision.js').SeenBlock[] };
  places?: import('./vision.js').SeenBlock[];
  crafting?:ReturnType<typeof import('./crafting-state.js').craftingState>;
  craftable?: string[];
  ready: boolean; health: number; food: number; logs: number;
  canMine: boolean; canDeposit: boolean; foodAvailable?:boolean; canEat: boolean; canFollow: boolean;
  position: { x: number; y: number; z: number };
  messages: string[];
  recipeBook: { initialized: boolean; unlocked: string[] };
};
export type MotorProgress={combat?:import('./combat.js').CombatProgress;phase:'approach'|'prepare'|'digging'|'collecting'|'equipping'|'aiming'|'placing'|'confirming'|'opening'|'transferring'|'crafting'|'tracking';phaseElapsedMs:number;estimatedDigMs?:number;estimatedRemainingMs?:number;digBudgetMs?:number;estimateCapped?:boolean;blockBroken:boolean;placementRequestIssued?:boolean;phaseMeaning?:string};
export interface World {
 recipes?(item:string):import("./procedure.js").RecipeFact[];
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
 readonly workflowMode?:'direct'|'procedural';
 readonly parameterSelection?:boolean;
  reviewGoals?(state:Snapshot,context:import('./planning.js').PlanningContext,signal:AbortSignal):Promise<{goalUpdates:import('./goals.js').GoalDraft[];activeGoalId:string|null;userRequestStatus?:{status:'in_progress'|'fulfilled';reason:string};messageDecisions?:MessageDecision[];recoveryDecision?:{deathId:string;strategy:'recover'|'prepare'|'defer'|'abandon'|'resolved';reason:string}}>;
  supervise?(state:Snapshot,input:import('./supervision.js').SupervisorInput,signal:AbortSignal):Promise<import('./supervision.js').Supervision>;
  communicate?(state:Snapshot,plan:Plan,signal:AbortSignal,execution?:{activeAction:Action|null;planPending:boolean;feedback?:string;goalDecisions?:unknown[];deliveries?:unknown;placements?:unknown[]}):Promise<import('./social.js').Speech|null>;
  readonly reflectionModel?:string;
  reflect?(input:import('./experience-memory.js').Reflection,signal:AbortSignal):Promise<unknown>;
  plan(state: Snapshot, history: string[], signal: AbortSignal, userGoal?: string | null, context?: import('./planning.js').PlanningContext): Promise<Plan>;
  choose(state: Snapshot, plan: DecisionPlan, candidates: Action[], signal: AbortSignal): Promise<Decision>;
}
export const actions: Action[] = ['idle', 'mine', 'deposit', 'eat', 'follow', 'move', 'craft', 'look', 'attack', 'flee', 'place_table', 'inspect_container', 'withdraw', 'give', 'place_block', 'pickup', 'equip', 'sleep'];
export function hasMiningTool(s:Snapshot,r:import('./building.js').DigRequest){return !r.tool&&r.toolSlot===undefined||!!s.inventory?.some(i=>(!r.tool||i.name===r.tool)&&(r.toolSlot===undefined||i.slot===r.toolSlot));}
// Entity, plan and chat coordinates are selected references, not remembered cells; navigation still validates the route.
export function referencedDestination(plan:Pick<Plan,'destinationTarget'>){return ['entity','plan_coordinate','chat_coordinate'].includes(plan.destinationTarget?.kind??'');}
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
  return ['idle', ...(plan?.bed && seen(plan.bed)?.name.endsWith('_bed') ? ['sleep'] : []), ...(plan?.equip && (plan.equip.item===null || compatible(plan.equip.item,plan.equip.destination)&&s.inventory?.some(i=>i.name===plan.equip!.item&&(plan.equip!.sourceSlot===undefined||i.slot===plan.equip!.sourceSlot))) ? ['equip'] : []), ...(plan?.pickup && (plan?.modelSelected||!s.enemies?.length) && pickupTargets(s).some(i=>i.id===plan.pickup!.entityId&&i.name===plan.pickup!.expected) ? ['pickup'] : []), ...(build && s.placeableItems?.includes(build.item) && seen(build.reference) ? ['place_block'] : []), ...(dig && hasMiningTool(s,dig) && (plan?.modelSelected||!supportsFeet(dig.position,s.position)) && seen(dig.position)?.name===dig.expected ? ['mine'] : []), ...((s.perception?.mode==='panorama'?false:plan?.modelSelected?!!build&&build.item==='crafting_table'&&!!seen(build.reference):s.canPlaceTable) ? ['place_table'] : []), ...(chest ? ['inspect_container'] : []), ...(chest && t ? ['withdraw'] : []), ...(carried && s.nearbyPlayers?.some(p=>p.name===t!.recipient) ? ['give'] : []), ...((plan?.modelSelected?[...s.enemies??[],...s.animals??[]].some(e=>e.id===plan.targetEntityId):s.enemies?.length) ? ['attack'] : []), ...((plan?.modelSelected?s.enemies?.some(e=>e.id===plan.targetEntityId):s.enemies?.length) ? ['flee'] : []), ...((s.perception?.mode!=='panorama'&&s.vision&&(!plan?.modelSelected||!!plan.look&&Number.isFinite(plan.look.yaw)&&Number.isFinite(plan.look.pitch))) ? ['look'] : []), ...(plan?.destination && !moveReached(s.position,plan.destination) && (knownDestination(s,plan.destination)||referencedDestination(plan)) ? ['move'] : []), ...(plan?.craft && s.inventory ? ['craft'] : []), ...(chest && carried ? ['deposit'] : []),
    ...((s.canEat&&(!plan?.modelSelected||s.edibleItems?.includes(plan.foodItem??''))) ? ['eat'] : []), ...((plan?.modelSelected?s.nearbyPlayers?.some(p=>p.name===plan.followPlayer):s.canFollow) ? ['follow'] : [])] as Action[];
}
