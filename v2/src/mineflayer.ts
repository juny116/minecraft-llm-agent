import {craftingState,feasibleExecutions,recipeBatchAvailable} from './crafting-state.js';
import {settleCraftInventory} from './craft-settlement.js';
import {DropMemory} from './pickup.js';
import {recipeFact,type RecipeFact} from './procedure.js';
import {NavigationFailure,navigationEvidence} from './execution-evidence.js';
import {MOVE_RADIUS,moveReached,MINE_APPROACH_RADIUS,MINE_SIGHT_APPROACH_RADIUS,MINE_PICKUP_MS} from './action-contracts.js';
import {ImportantPlaces} from './important-places.js';
import {localNavigationTargets} from './navigation.js';
import {tableSupportMaterial} from './building.js';
import {knownDestination,referencedDestination} from './types.js';
import {RecoveryMemory} from './recovery.js';
import {craftFailure} from './craft-feedback.js';
import {observedMovements,PickupGoal} from './navigation.js';
import {SpatialMemory} from './spatial-memory.js';
import {botMemoryLocation} from './experience-memory.js';
import {join} from 'node:path';
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {RESPAWN_SET_RESULT} from './beds.js';
import {executeEquip} from './equipment.js';
import {validatePickup,type PickupResult} from './pickup.js';
import {miningResult,inventoryGains,miningTiming} from './mining.js';
import {fastRaycast} from './fast-raycast.js';
import {escapeMovements} from './navigation.js';
import {dayTime} from './day-time.js';
import {weaponRank} from './combat.js';
import {buildingMaterial,validateBuild,validateDig,sameCell,overlapsCell,supportsFeet} from './building.js';
import {randomUUID} from 'node:crypto';
import {IncomingDamage} from './incoming-damage.js';
import {CombatEvidenceStore} from './combat-evidence.js';
import {isBed,bedHead,bedYaw} from './beds.js';
import { combat,combatCooldownMs, animalKinds, hostileKinds, distance, type Enemy, type Encounter } from './combat.js';
import { PlaceMemory, sampleView, sampleNearSurfaces, sampleSurroundings, summarizePlaces, viewDirection, visibleBlockFace, VISION } from './vision.js';
import { RecipeBook } from "./recipe-book.js";
import { protocolOverrides } from "./protocol.js";
import mineflayer from 'mineflayer';
import {fixRecipeTypeMapping} from './protocol-fixes.js';
import pathfinderPackage from 'mineflayer-pathfinder';
import { setTimeout as delay } from 'node:timers/promises';
import type { Config } from './config.js';
import type { Action, Log, Snapshot, World, Plan } from './types.js';

const { pathfinder, goals } = pathfinderPackage;
function samePosition(a:{x:number;y:number;z:number},b:{x:number;y:number;z:number}){return a.x===b.x&&a.y===b.y&&a.z===b.z;}
// Cells a placed block may fill: empty, or plants that vanilla replaces on placement.
const replaceable=(name?:string)=>!!name&&/^(air|cave_air|short_grass|tall_grass|fern|large_fern)$/.test(name);
// Server messages for a refused bed use; texts follow the vanilla English strings.
const BED_REFUSALS:Record<string,string>={'block.minecraft.bed.obstructed':'this bed is obstructed (the cells above the bed must be free)','block.minecraft.bed.not_safe':'you may not rest now; there are monsters nearby','block.minecraft.bed.too_far_away':'you may not rest now; the bed is too far away','block.minecraft.bed.no_sleep':'you can sleep only at night or during thunderstorms','block.minecraft.bed.occupied':'this bed is occupied'};
export class MineflayerWorld implements World {
  private spatial?:SpatialMemory;
 readonly importantPlaces:ImportantPlaces;
  private lastAlivePossessions?:import('./recovery.js').AlivePossessions;
  private recovery:RecoveryMemory;private generation=0;private deathCount=0;private dead=false;
  private bot: mineflayer.Bot;
  private ready = false;
  private dropMemory=new DropMemory();
  private recipeBook = new RecipeBook();
  private memory = new PlaceMemory();
  private visible: import('./vision.js').SeenBlock[] = [];
  private observedAt = 0;
  private occlusion:NonNullable<Snapshot['perception']>['occlusion']=[];
  private navigationHintMovements?:ReturnType<typeof observedMovements>;private navigationHintsAt=0;private navigationHints:import('./vision.js').Position[]=[];
  private navigationTargets(){
    if(!this.ready)return [];const now=Date.now();if(now-this.navigationHintsAt<2000)return structuredClone(this.navigationHints);this.navigationHintsAt=now;
    this.navigationHints=localNavigationTargets(this.bot.entity.position,this.memory.snapshot(),p=>{
      if(moveReached(this.bot.entity.position,p))return false;
      try{
        this.navigationHintMovements??=observedMovements(this.bot,this.memory);
        // getPathTo mutates pathfinder's shared A* context. Queries must be isolated from active goto.
        const search=this.bot.pathfinder.getPathFromTo(this.navigationHintMovements,this.bot.entity.position,new goals.GoalNear(p.x,p.y,p.z,MOVE_RADIUS),{timeout:40,tickTimeout:8,searchRadius:12,optimizePath:false});
        return search.next().value?.result.status==='success';
      }catch{return false;}
    });return structuredClone(this.navigationHints);
  }
  private observationDimension = '';
  private incomingDamage=new IncomingDamage();
  private combatEvidence=new CombatEvidenceStore();
  private encounters: Encounter[] = [];
  private messages: string[] = [];
  private chatEvents:import('./social.js').ChatEvent[]=[];
  constructor(name: string, private c: Config, private log: Log) {
    const location=botMemoryLocation('--live',name,c);this.importantPlaces=new ImportantPlaces(join(location.dir,'important-places.json'),location.profile);this.spatial=new SpatialMemory(join(location.dir,'spatial.json'),location.profile);this.recovery=new RecoveryMemory(join(location.dir,'recovery.json'));this.respawnFile=join(location.dir,'respawn.json');try{this.respawnBed=existsSync(this.respawnFile)?JSON.parse(readFileSync(this.respawnFile,'utf8')):undefined;}catch{this.respawnBed=undefined;}
    fixRecipeTypeMapping(c.version);
    this.bot = mineflayer.createBot({ host: c.host, port: c.port, version: c.version,
      customPackets: protocolOverrides(c.version),
      username: name, auth: c.auth, respawn:true, profilesFolder: './runs/auth' });
    this.bot.loadPlugin(pathfinder);
    // The full declare_recipes catalog is intentionally never added to observations.
    this.bot._client.on('declare_recipes', packet => {this.recipeBook.declare(packet);this.log('recipe_catalog',{recipes:this.recipeBook.catalogSize});});
    this.bot._client.on('unlock_recipes', packet => this.recipeBook.apply(packet));
    this.bot.on('spawn', () => {
      this.dropMemory.clear();this.generation++;this.dead=false;this.lastAlivePossessions=undefined;this.memory.clear();this.knownCacheAt=-1;this.knownCache=[];this.navigationHints=[];this.navigationHintsAt=0;this.visible=[];this.containers=[];this.combatEvidence.clear();this.incomingDamage.clear();
      const movement = observedMovements(this.bot,this.memory);
      this.bot.pathfinder.setMovements(movement); this.ready = true;
      this.recovery.respawn(this.snapshot());log('spawn',{generation:this.generation});
    });
    this.bot.on('health',()=>this.incomingDamage.health(this.bot.health,Date.now()));
    // Raw damage_event distinguishes source attribution from duplicate hurt animations.
    this.bot._client.on('damage_event',(packet:any)=>{
      if(packet.entityId===this.bot.entity?.id){
        const source=this.bot.entities[packet.sourceCauseId-1];
        const visible=source&&this.ready&&this.entityVisible(source);
        this.incomingDamage.hit(Date.now(),visible?{id:source.id,kind:source.name??'unknown'}:undefined);
      }
      const entity=this.bot.entities[packet.entityId];
      if(entity)this.combatEvidence.hurt(entity.id,packet.sourceCauseId===this.bot.entity?.id+1,this.entityVisible(entity),Date.now());
    });
    // Observation is skipped while nothing it depends on changed; block changes in range and new chunks mark it stale.
    this.bot.on('blockUpdate',(_old,next)=>{const e=this.bot.entity;if(next&&e&&next.position.distanceTo(e.position)<=50)this.observeStale=true;});
    this.bot.on('chunkColumnLoad',()=>{this.observeStale=true;});
    this.bot.on('playerCollect',(collector,collected)=>{if(collector.id===this.bot.entity?.id)this.dropMemory.forget(collected.id);});
    this.bot.on('entityDead',entity=>{if(entity&&this.entityVisible(entity))this.combatEvidence.death(entity.id,Date.now());});
    this.bot.on('death', () => { const death=this.recovery.death(this.snapshot(),this.lastAlivePossessions);this.deathCount++;this.dead=true;this.ready=false;this.stop();log('death',{death}); });
    this.bot.on('end', () => { this.saveSpatial(true); this.ready = false; this.recipeBook.reset(); this.memory.clear();this.knownCacheAt=-1;this.knownCache=[];this.navigationHints=[];this.navigationHintsAt=0; this.containers=[]; this.visible=[]; this.combatEvidence.clear();this.incomingDamage.clear(); log('disconnected'); });
    this.bot.on('message',(m:unknown)=>{const key=(m as {translate?:string}|null)?.translate;if(key==='block.minecraft.spawn.not_valid'&&this.respawnBed){log('respawn_bed_lost',{bed:this.respawnBed.position});this.setRespawnBed(undefined);}});
    this.bot.on('kicked', () => { this.ready = false; log('kicked'); });
    this.bot.on('error', () => log('connection_error')); // no raw credentials/packets
    this.bot.on('chat', (sender, message) => {
      if (sender === this.bot.username) return;
      this.chatEvents.push({id:randomUUID(),at:Date.now(),speaker:sender,text:message.slice(0,250)});this.chatEvents=this.chatEvents.slice(-32);
      this.messages.push(`${sender}: ${message.slice(0, 250)}`);
      this.messages = this.messages.slice(-6);
    });
  }
  private visibleItems(){const visible=Object.values(this.bot.entities).filter(e=>e.name==='item'&&this.entityVisible(e)).flatMap(e=>{const i=e.getDroppedItem();return i?[{id:e.id,name:i.name,count:i.count,position:{x:e.position.x,y:e.position.y,z:e.position.z}}]:[];});(this.dropMemory??=new DropMemory()).observe(visible);return visible;}
  // Shared by standalone pickup and mine's bounded post-break collection.
  private async collectVisibleDrop(id:number,signal:AbortSignal,modelSelected=false){
    signal.throwIfAborted();const e=this.bot.entities[id];
    if(!e||e.name!=='item'||!this.entityVisible(e))throw Error('Dropped item no longer visible');
    if(!modelSelected&&this.enemies().length)throw Error('Visible danger prevents pickup');
    const p=e.position.offset(0,0,0);
    await this.bot.lookAt(p.offset(0,.05,0),false);this.observe(true);signal.throwIfAborted();
    let abort=()=>{};let rejectDanger:(error:Error)=>void=()=>{};
    const interrupted=new Promise<never>((_,reject)=>{rejectDanger=reject;abort=()=>{this.stop();reject(signal.reason);};signal.addEventListener('abort',abort,{once:true});});
    const monitor=setInterval(()=>{// Occlusion does not invalidate the frozen last-seen destination.
      if(!modelSelected&&this.enemies().length){this.stop();rejectDanger(new Error('Visible danger interrupted pickup'));}},50);
    try{await Promise.race([this.navigate(new PickupGoal({x:p.x,y:p.y,z:p.z}),signal),interrupted]);}
    finally{clearInterval(monitor);signal.removeEventListener('abort',abort);this.stop();}
  }
  private async pickupItem(signal:AbortSignal,plan?:Plan){
    const started=Date.now(),result:PickupResult={kind:'pickup',target:plan?.pickup??null,inventoryGained:[],status:'failed',elapsedMs:0,attribution:'inventory_delta_not_proof_of_target_origin'};
    const totals=()=>{const t:Record<string,number>={};for(const i of this.bot.inventory.items())t[i.name]=(t[i.name]??0)+i.count;return t;};
    const before=totals(),health=this.bot.health,damage=new AbortController();
    const onHealth=()=>{if(this.bot.health<=0||!plan?.modelSelected&&this.bot.health<health)damage.abort(new Error('Damaged during pickup'));};
    this.bot.on('health',onHealth);const active=AbortSignal.any([signal,damage.signal,AbortSignal.timeout(8000)]);
    try{
      validatePickup(plan?.pickup!);const request=plan!.pickup!;
      const visible=this.visibleItems();
      const seen=visible.find(i=>i.id===request.entityId&&i.name===request.expected);
      const remembered=this.dropMemory.remembered(visible).find(i=>i.id===request.entityId&&i.name===request.expected);
      if(!seen&&!remembered)throw Error('Pickup target has no recent observation');
      if(!seen&&remembered){
        this.phase('approach','Reapproaching last observed drop position; current existence and position unknown.');
        await this.navigate(new PickupGoal(remembered.position),active);this.observe(true);
        if(!this.visibleItems().some(i=>i.id===request.entityId&&i.name===request.expected)){
          this.dropMemory.forget(request.entityId);
          if((totals()[request.expected]??0)>(before[request.expected]??0)){result.status='finished';return JSON.stringify({...result,inventoryGained:inventoryGains(before,totals()),elapsedMs:Date.now()-started});}
          throw Error('Drop not reobserved at last seen position; existence unknown');
        }
      }
      await this.collectVisibleDrop(request.entityId,active,plan?.modelSelected);
      await delay(450,undefined,{signal:active});result.status='finished';
    }catch(error){result.status=active.aborted?'cancelled':'failed';result.detail=error instanceof Error?error.message.slice(0,180):'Pickup failed';if(error instanceof NavigationFailure)Object.assign(result,{navigation:error.evidence});}
    finally{this.stop();this.bot.removeListener('health',onHealth);result.inventoryGained=inventoryGains(before,totals());result.elapsedMs=Date.now()-started;}
    if(!signal.aborted&&result.detail?.startsWith('Pickup target lost')&&result.inventoryGained.some(i=>i.name===result.target?.expected&&i.count>0)){result.status='finished';result.detail='Target lost and matching inventory gain observed; origin remains unconfirmed';}
    if(result.inventoryGained.some(i=>i.name===result.target?.expected&&i.count>0))this.dropMemory.forget(result.target!.entityId);
    if(result.status==='finished'&&!result.inventoryGained.some(i=>i.name===result.target?.expected&&i.count>0)){result.status='failed';result.detail='No matching inventory gain observed; disappearance is not receipt';}
    return JSON.stringify(result);
  }
  private actionReceipt?:Record<string,unknown>;
  private transferEvidence?:{item:string;requested:number;inventoryBefore:number;containerBefore:number;containerAfter?:number};
  private transferSnapshot(){return this.transferEvidence;}
  private phase(value:import('./types.js').MotorProgress['phase'],meaning:string){this.motor={phase:value,at:Date.now(),blockBroken:false,phaseMeaning:meaning};}
  private placementReceipt?:Record<string,unknown>;
  executionReceipt(){return this.placementReceipt||this.actionReceipt?structuredClone({...this.placementReceipt,...(this.actionReceipt?{actionEvidence:this.actionReceipt}:{})}):undefined;}
  private motor?:{combat?:import('./combat.js').CombatProgress;placementRequestIssued?:boolean;phaseMeaning?:string;phase:import('./types.js').MotorProgress['phase'];at:number;estimatedDigMs?:number;digBudgetMs?:number;estimateCapped?:boolean;blockBroken:boolean};
  executionProgress():import('./types.js').MotorProgress|undefined{return this.motor?{combat:this.motor.combat?structuredClone(this.motor.combat):undefined,phase:this.motor.phase,placementRequestIssued:this.motor.placementRequestIssued,phaseMeaning:this.motor.phaseMeaning,phaseElapsedMs:Math.max(0,Date.now()-this.motor.at),estimatedDigMs:this.motor.estimatedDigMs,digBudgetMs:this.motor.digBudgetMs,estimateCapped:this.motor.estimateCapped,estimatedRemainingMs:this.motor.phase==='digging'&&this.motor.estimatedDigMs!==undefined?Math.max(0,this.motor.estimatedDigMs-(Date.now()-this.motor.at)):undefined,blockBroken:this.motor.blockBroken}:undefined;}
  private async mineBlock(signal:AbortSignal,plan?:Plan){
    const result=miningResult(plan?.mine??null),started=Date.now();this.motor={phase:'approach',at:started,blockBroken:false};
    const totals=()=>{const out:Record<string,number>={};for(const i of this.bot.inventory.items())out[i.name]=(out[i.name]??0)+i.count;return out;};
    const before=totals(),initialIds=new Set(Object.keys(this.bot.entities));
    let digStarted:number|undefined;let digEnded:number|undefined;let target:ReturnType<mineflayer.Bot['blockAt']>;
    const damage=new AbortController(),initialHealth=this.bot.health;
    const onHealth=()=>{if(this.bot.health<=0||!plan?.modelSelected&&this.bot.health<initialHealth)damage.abort(new Error('Damaged during mining'));};
    this.bot.on('health',onHealth);
    const active=AbortSignal.any([signal,damage.signal]);
    const abort=()=>this.stop();active.addEventListener('abort',abort,{once:true});
    const scan=()=>{
      this.visibleItems();
      if(!plan?.mine)return [];
      const p=plan.mine.position;
      const drops=Object.values(this.bot.entities).filter(e=>e.name==='item'&&!initialIds.has(String(e.id))&&Math.hypot(e.position.x-p.x,e.position.y-p.y,e.position.z-p.z)<4&&this.entityVisible(e));
      for(const e of drops){const item=e.getDroppedItem();if(!result.drops.some(d=>d.id===e.id))result.drops.push({id:e.id,name:item?.name??null,count:item?.count??null,firstSeen:Date.now()});}
      result.dropObservation=result.drops.length?'observed_near_target':'none_observed';return drops;
    };
    const onDrop=()=>{scan();};
    try{
      validateDig(plan?.mine!);const request=plan!.mine!;
      if(!this.visible.some(b=>sameCell(b.position,request.position)&&b.name===request.expected)&&!this.knownPlaces().some(b=>sameCell(b.position,request.position)&&b.name===request.expected))throw Error('Block target has no observation evidence');
      const cell=request.position,vec=this.bot.entity.position.scaled(0).offset(cell.x,cell.y,cell.z);
      if(!this.visible.some(b=>sameCell(b.position,cell))) {await this.navigate(new goals.GoalNear(cell.x,cell.y,cell.z,MINE_APPROACH_RADIUS),active);this.observe(true);if(!this.visible.some(b=>sameCell(b.position,cell)))throw Error('Remembered mining target not observable after approach');}
      target=this.bot.blockAt(vec);if(!target||target.name!==request.expected)throw Error('Block target changed');const stateId=target.stateId;
      if(!this.bot.canDigBlock(target))await this.navigate(new goals.GoalNear(cell.x,cell.y,cell.z,MINE_APPROACH_RADIUS),active);
      active.throwIfAborted();await this.bot.lookAt(vec.offset(.5,.5,.5),false);active.throwIfAborted();
      if(!this.blockInSight(target)){await this.navigate(new goals.GoalNear(cell.x,Math.floor(this.bot.entity.position.y),cell.z,MINE_SIGHT_APPROACH_RADIUS),active);active.throwIfAborted();await this.bot.lookAt(vec.offset(.5,.5,.5),false);active.throwIfAborted();}
      const fresh=()=>{const b=this.bot.blockAt(vec),feet=this.bot.entity.position;
        if(!b||b.stateId!==stateId)throw Error('Block target changed');
        if(!b.diggable)throw Error('Block is not diggable with current interaction');
        if(!this.bot.canDigBlock(b))throw Error('Block is outside current mining reach; reposition');
        if(!this.blockInSight(b))throw Error('Block is visible only partially; no clear mining face from current position. Reposition or choose another target');
        if(!plan?.modelSelected&&supportsFeet(cell,feet))throw Error('Block supports own feet');return b;};
      this.motor={phase:'prepare',at:Date.now(),blockBroken:false};target=fresh();const tool=request.toolSlot!==undefined?this.bot.inventory.items().find(i=>i.slot===request.toolSlot&&(!request.tool||i.name===request.tool)):request.tool?this.bot.inventory.items().find(i=>i.name===request.tool):request.keepTool?undefined:this.bot.pathfinder.bestHarvestTool(target);
      if((request.tool||request.toolSlot!==undefined)&&!tool)throw Error('Requested mining tool not carried');
      const original=this.bot.clickWindow;
      this.bot.clickWindow=((...args:Parameters<typeof original>)=>{active.throwIfAborted();return original.apply(this.bot,args);}) as typeof original;
      try{if(tool)await this.bot.equip(tool,'hand');}finally{this.bot.clickWindow=original;}
      active.throwIfAborted();target=fresh();const held=this.bot.heldItem;
      result.tool=held?{name:held.name,enchants:structuredClone(held.enchants??[]),durabilityUsed:held.durabilityUsed}:null;
      // Game data, not inference: blocks such as stone and ores drop nothing unless broken with a listed tool.
      // canHarvest returns null/undefined for a hand or non-tool, which JSON dropped: in CONT5 Bob broke stone 20+
      // times with a stick after his pickaxe broke, every record reading succeeded without heldToolDropsItem.
      const harvestIds=Object.keys((target as unknown as {harvestTools?:Record<string,boolean>}).harvestTools??{});
      if(typeof target.canHarvest==='function')result.harvest={heldToolDropsItem:!!target.canHarvest(held?.type??null),toolsThatDropItem:harvestIds.length?harvestIds.map(id=>this.bot.registry.items[Number(id)]?.name).filter((n):n is string=>!!n):null,meaning:'From game block data. heldToolDropsItem=false means breaking this block with the held tool yields no item; one of toolsThatDropItem is required. toolsThatDropItem=null means any tool or bare hand drops it.'};
      this.bot.on('itemDrop',onDrop);digStarted=Date.now();const timing=miningTiming(this.bot.digTime?.(target));Object.assign(result,timing);this.motor={phase:'digging',at:digStarted,...timing,blockBroken:false};
      const clock=new AbortController(),timer=setTimeout(()=>clock.abort(new DOMException('Mining attempt budget exhausted','TimeoutError')),timing.digBudgetMs),timeout=clock.signal,digSignal=AbortSignal.any([active,timeout]);
      let stopDig:()=>void=()=>{};
      const interrupted=new Promise<never>((_,reject)=>{stopDig=()=>{this.bot.stopDigging();reject(digSignal.reason);};if(digSignal.aborted)stopDig();else digSignal.addEventListener('abort',stopDig,{once:true});});
      try{const face=this.miningFace(target);if(!face)throw Error('Block has no currently visible mining face');await Promise.race([this.bot.dig(target,false,face),interrupted]);}catch(error){
        result.blockBroken=['air','cave_air','void_air'].includes(this.bot.blockAt(vec)?.name??'');
        if(timeout.aborted&&!active.aborted){result.status='time_limit';result.detail='Not completed within attempt budget; this does not establish impossibility';}else throw error;
      }finally{clearTimeout(timer);digSignal.removeEventListener('abort',stopDig);digEnded=Date.now();}
      result.blockBroken=['air','cave_air','void_air'].includes(this.bot.blockAt(vec)?.name??'');
      if(!result.blockBroken)throw Error(result.status==='time_limit'?'Attempt budget exhausted; impossibility not established':'Block break not confirmed');
      this.memory.observe([{name:'air',position:{...cell},lastSeen:Date.now()}]);this.containers=this.containers.filter(c=>!samePosition(c.position,cell));
      active.throwIfAborted();result.pickup='no_inventory_gain';this.motor={phase:'collecting',at:Date.now(),blockBroken:true};
      // Bounded post-break observation/pickup; danger or cancellation stops this phase.
      const pickupSignal=AbortSignal.any([active,AbortSignal.timeout(MINE_PICKUP_MS)]);
      const stopPickup=()=>this.stop();pickupSignal.addEventListener('abort',stopPickup,{once:true});
      try{
        await delay(100,undefined,{signal:pickupSignal});
        let drops=scan();while(!drops.length){await delay(50,undefined,{signal:pickupSignal});drops=scan();}
        if(drops.length&&(plan?.modelSelected||!this.enemies().length)){
          await this.collectVisibleDrop(drops[0].id,pickupSignal,plan?.modelSelected);
          await delay(250,undefined,{signal:pickupSignal});scan();
        }
      }catch(error){if(error instanceof NavigationFailure)Object.assign(result,{navigation:error.evidence});result.pickup='interrupted';result.detail=error instanceof Error?error.message.slice(0,180):'Pickup interrupted';}finally{pickupSignal.removeEventListener('abort',stopPickup);this.stop();}
      await delay(200,undefined,{signal:active});scan();
      active.throwIfAborted();result.status='finished';
    }catch(error){if(error instanceof NavigationFailure)Object.assign(result,{navigation:error.evidence});result.status=active.aborted?'cancelled':result.status==='time_limit'?'time_limit':'failed';result.detail=error instanceof Error?error.message.slice(0,200):'Mining failed';}
    finally{
      this.bot.removeListener('itemDrop',onDrop);this.bot.removeListener('health',onHealth);active.removeEventListener('abort',abort);
      result.attemptMs=digStarted===undefined?0:(digEnded??Date.now())-digStarted;result.elapsedMs=Date.now()-started;
      result.inventoryGained=inventoryGains(before,totals());if(result.inventoryGained.length){result.pickup='inventory_gain_observed';if(result.detail?.startsWith('Pickup target lost'))result.detail='Matching inventory gain observed after target disappeared; origin remains unconfirmed';}this.motor=undefined;
    }
    return JSON.stringify(result);
  }

  // Nearest standable cell (free feet and head, solid floor) that keeps the body out of the given cells and stays
  // within placement reach of the reference block.
  private stepAsideSpot(avoid:import('./vision.js').Position[],reference:import('./vision.js').Position){
    const here=this.bot.entity.position,base=here.floored(),spots:{x:number;y:number;z:number;d:number}[]=[];
    const at=(x:number,y:number,z:number)=>this.bot.blockAt(base.scaled(0).offset(x,y,z));
    for(let dx=-3;dx<=3;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-3;dz<=3;dz++){
      const x=base.x+dx,y=base.y+dy,z=base.z+dz,feet={x:x+.5,y,z:z+.5};
      if(at(x,y,z)?.boundingBox!=='empty'||at(x,y+1,z)?.boundingBox!=='empty'||at(x,y-1,z)?.boundingBox!=='block')continue;
      if(avoid.some(c=>overlapsCell(c,feet)))continue;
      if(Math.hypot(x+.5-(reference.x+.5),y+1.62-(reference.y+.5),z+.5-(reference.z+.5))>4)continue;
      spots.push({x,y,z,d:Math.hypot(feet.x-here.x,feet.y-here.y,feet.z-here.z)});
    }
    return spots.sort((a,b)=>a.d-b.d)[0];
  }
  // Blocks this bot placed and still observes in place; mining options keep them out of the default per-type pick.
  // Bed the server confirmed as respawn point (block.minecraft.set_spawn), kept across processes; cleared when the
  // server reports it missing on respawn.
  private respawnBed?:{position:import('./vision.js').Position;dimension:string;at:number};private respawnFile?:string;
  private setRespawnBed(b:MineflayerWorld['respawnBed']){this.respawnBed=b;if(!this.respawnFile)return;try{mkdirSync(dirname(this.respawnFile),{recursive:true,mode:0o700});writeFileSync(this.respawnFile,JSON.stringify(b??null),{mode:0o600});}catch{}}
  private ownPlaced=new Map<string,{name:string;position:import('./vision.js').Position;at:number}>();
  private async buildAction(action:'place_block',signal:AbortSignal,plan?:Plan){
    validateBuild(plan?.build!);
    const build=plan!.build!,cell=build.reference;
    const head=isBed(build.item)?bedHead(build.position,build.facing!):undefined;
    const initialCount=this.itemCount(build.item);let issued=false;
    const phase=(value:import('./types.js').MotorProgress['phase'],meaning:string)=>{this.motor={phase:value,at:Date.now(),blockBroken:false,placementRequestIssued:issued,phaseMeaning:meaning};};
    phase('approach','Approaching the selected support; no placement request issued.');
    try{
    const eye=this.bot.entity.position.offset(0,1.62,0);
    if(Math.hypot(build.position.x+.5-eye.x,build.position.y+.5-eye.y,build.position.z+.5-eye.z)>12)throw Error('Placement outside local 12-block scope; move and observe first');
    const observed=this.visible.find(b=>sameCell(b.position,cell));
    if(!observed)throw Error('Block target not currently observed');
    const vec=this.bot.entity.position.scaled(0).offset(cell.x,cell.y,cell.z);
    let block=this.bot.blockAt(vec);
    if(!block||block.name!==observed.name)throw Error('Block target changed');
    const stateId=block.stateId;
    if(vec.distanceTo(this.bot.entity.position)>3)await this.navigate(new goals.GoalNear(cell.x,cell.y,cell.z,3),signal);
    signal.throwIfAborted();phase('prepare','Orienting toward support; rotation is preparation, not placement failure.');await this.bot.lookAt(vec.offset(.5,.5,.5),false);signal.throwIfAborted();
    const fresh=()=>{const b=this.bot.blockAt(vec);if(!b||b.stateId!==stateId||vec.distanceTo(this.bot.entity.position)>4.5)throw Error('Block target changed or unreachable');return b;};
    block=fresh();
    const target=vec.scaled(0).offset(build.position.x,build.position.y,build.position.z),face=target.minus(vec);
    const free=()=>{
      if(!replaceable(this.bot.blockAt(target)?.name))throw Error('Block placement target occupied');
      if(head){
        const support={...head,y:head.y-1},sv=target.scaled(0).offset(support.x,support.y,support.z),hv=sv.offset(0,1,0);
        if(!this.visible.some(b=>sameCell(b.position,support))||this.bot.blockAt(sv)?.boundingBox!=='block')throw Error('Bed head floor not currently observed and solid');
        if(this.bot.blockAt(hv)?.name!=='air')throw Error('Bed head cell occupied');
      }
      const entities=[this.bot.entity,...Object.values(this.bot.entities)];
      if(entities.some(e=>[build.position,...(head?[head]:[])].some(c=>overlapsCell(c,e.position,e.width??.6,e.height??1.8))))throw Error('Block placement overlaps entity');
    };
    // Standing in the cell to fill is a local positioning problem, not a model choice: step to a nearby free
    // standing cell that still reaches the reference block, then place (FREE3: three own-body overlaps).
    const cellsToFill=[build.position,...(head?[head]:[])];
    if(cellsToFill.some(c=>overlapsCell(c,this.bot.entity.position))){
      phase('approach','Own body occupies the placement cell; stepping aside before placing.');
      const spot=this.stepAsideSpot(cellsToFill,cell);
      if(!spot)throw Error('Own body occupies the placement cell and no free standing cell within reach was found');
      await this.navigate(new goals.GoalNear(spot.x,spot.y,spot.z,0),signal);signal.throwIfAborted();
      block=fresh();
    }
    const item=this.bot.inventory.items().find(i=>i.name===build.item);
    if(!item||!this.bot.registry.blocksByName[build.item])throw Error('Block material unavailable');
    free();const before=this.itemCount(build.item);
    const original=this.bot.clickWindow;const sneaking=this.bot.getControlState('sneak');
    this.bot.clickWindow=((...args:Parameters<typeof original>)=>{signal.throwIfAborted();return original.apply(this.bot,args);}) as typeof original;
    try{
      phase('equipping','Equipping the selected item; no placement request issued.');await this.bot.equip(item,'hand');signal.throwIfAborted();block=fresh();free();
      const contact=vec.offset(.5+face.x*.5,.5+face.y*.5,.5+face.z*.5);
      phase('aiming','Aiming at the selected face; no placement request issued.');await this.bot.lookAt(contact,false);signal.throwIfAborted();
      const eye=this.bot.entity.position.offset(0,1.62,0),delta=contact.minus(eye),length=delta.norm();
      if(length>4.5)throw Error('Selected placement face remains outside reach after approach');
      if(length<.05||this.bot.world.raycast(eye,delta.scaled(1/length),length-.02))throw Error('Selected placement face occluded after approach');
      block=fresh();free();signal.throwIfAborted();this.bot.setControlState('sneak',true);
      if(head){await this.bot.look(bedYaw(build.facing!),0,true);await this.bot.waitForTicks(2);signal.throwIfAborted();free();}
      issued=true;phase('placing','Placement operation requested; server effect may occur even if cancelled.');if(head)await (this.bot as any)._placeBlockWithOptions(block,face,{forceLook:'ignore',swingArm:'right'});else await this.bot.placeBlock(block,face);phase('confirming','Checking block and inventory evidence; cancellation cannot undo a server placement.');signal.throwIfAborted();
      for(let i=0;i<20&&(this.bot.blockAt(target)?.name!==build.item||this.itemCount(build.item)!==before-1);i++)await delay(50,undefined,{signal});
      if(this.bot.blockAt(target)?.name!==build.item||this.itemCount(build.item)!==before-1)throw Error('Block placement not confirmed');
      if(head){const hb=this.bot.blockAt(target.scaled(0).offset(head.x,head.y,head.z)),fb=this.bot.blockAt(target);if(hb?.name!==build.item||hb.getProperties().part!=='head'||fb?.getProperties().part!=='foot'||fb.getProperties().facing!==build.facing)throw Error('Bed footprint or facing not confirmed');}
      this.memory.observe([build.position,...head?[head]:[]].map(position=>({name:build.item,position:{...position},lastSeen:Date.now()})));this.observe(true);
      return `Placed ${build.item} at ${target.x},${target.y},${target.z}`;
    }finally{this.bot.clickWindow=original;this.bot.setControlState('sneak',signal.aborted?false:sneaking);}
    }finally{
      // Observe effects of an already-issued operation, without sending another action.
      if(issued&&signal.aborted)await delay(200);
      const target=this.bot.entity.position.scaled(0).offset(build.position.x,build.position.y,build.position.z);
      const matched=issued&&this.bot.blockAt(target)?.name===build.item&&(!head||(this.bot.blockAt(target.scaled(0).offset(head.x,head.y,head.z))?.name===build.item&&this.bot.blockAt(target)?.getProperties().facing===build.facing)),consumed=initialCount-this.itemCount(build.item);
      const placedFoot=this.bot.blockAt(target),placed=placedFoot?.name===build.item?{position:{...build.position},...(head&&placedFoot.getProperties().facing?{facing:placedFoot.getProperties().facing,head:bedHead(build.position,placedFoot.getProperties().facing as any)}:{})}:null;
      this.placementReceipt={kind:'placement',requestIssued:issued,cancelRequested:signal.aborted,blockMatched:matched,itemDelta:consumed===0?0:-consumed,confirmed:matched&&consumed===1,position:{...build.position},...(head?{head,facing:build.facing}:{}),observedPlacement:placed,item:build.item,observedAt:Date.now(),meaning:'Execution cancellation and world effect are separate. No request means no placement attempted; absent confirmation does not prove no delayed effect.'};
      if(matched)this.memory.observe([{name:build.item,position:{...build.position},lastSeen:Date.now()}]);
      if(matched){(this.ownPlaced??=new Map()).set(`${build.position.x},${build.position.y},${build.position.z}`,{name:build.item,position:{...build.position},at:Date.now()});while(this.ownPlaced.size>128)this.ownPlaced.delete(this.ownPlaced.keys().next().value!);}
      this.motor=undefined;
    }
  }

  private recentDrops=new Map<string,number>();
  private containers:NonNullable<Snapshot['containers']>=[];
  private itemCount(name:string){return this.bot.inventory.items().filter(i=>i.name===name).reduce((n,i)=>n+i.count,0);}
  private rememberChest(window:Awaited<ReturnType<mineflayer.Bot['openChest']>>,position:Plan['container']){
    if(!position)return;
    this.containers=this.containers.filter(c=>!samePosition(c.position,position));
    this.containers.push({position:{...position},observedAt:Date.now(),items:window.containerItems().map(i=>({name:i.name,count:i.count}))});
    this.containers=this.containers.slice(-16);
  }
  // Exact ray to a known target supplements the sparse observation grid; it never discovers hidden targets.
  private miningFace(block:NonNullable<ReturnType<mineflayer.Bot['blockAt']>>){
    const entity=this.bot.entity,eye=entity.position.offset(0,(entity as typeof entity & {eyeHeight?:number}).eyeHeight??1.62,0);
    const point=visibleBlockFace(eye,this.bot.entity.yaw,this.bot.entity.pitch,block.position,(d,length)=>(this.bot.world.raycast(eye,eye.scaled(0).offset(d.x,d.y,d.z),length) as any)?.position??null,true);
    if(!point)return;
    const delta=eye.scaled(0).offset(point.x-eye.x,point.y-eye.y,point.z-eye.z),length=delta.norm();
    const hit=this.bot.world.raycast(eye,delta.scaled(1/length),length+.01) as any;
    if(!hit||!sameCell(hit.position,block.position))return;
    const normal=[[0,-1,0],[0,1,0],[0,0,-1],[0,0,1],[-1,0,0],[1,0,0]][hit.face];
    if(normal)return eye.scaled(0).offset(normal[0],normal[1],normal[2]);
  }
  private blockInSight(block:NonNullable<ReturnType<mineflayer.Bot['blockAt']>>){
    const eye=this.bot.entity.position.offset(0,1.62,0);
    return !!visibleBlockFace(eye,this.bot.entity.yaw,this.bot.entity.pitch,block.position,(d,length)=>{
      const hit=this.bot.world.raycast(eye,eye.scaled(0).offset(d.x,d.y,d.z),length) as unknown as {position:import('./vision.js').Position}|null;
      return hit?.position??null;
    },true);
  }
  private placementSupport(expected?:import('./vision.js').Position){
    this.observe();
    return this.visible.filter(b=>(!expected||samePosition(b.position,expected))&&tableSupportMaterial(b.name)&&b.position.y===Math.floor(this.bot.entity.position.y)-1)
      .map(b=>this.bot.blockAt(this.bot.entity.position.scaled(0).offset(b.position.x,b.position.y,b.position.z)))
      .find(b=>b&&b.position.distanceTo(this.bot.entity.position)<4&&b.boundingBox==='block'&&
        this.bot.blockAt(b.position.offset(0,1,0))?.name==='air'&&this.bot.blockAt(b.position.offset(0,2,0))?.name==='air'&&
        !Object.values(this.bot.entities).some(e=>Math.abs(e.position.x-b.position.x-.5)<1&&Math.abs(e.position.z-b.position.z-.5)<1&&Math.abs(e.position.y-b.position.y-1)<2)&&
        !(Math.abs(this.bot.entity.position.x-b.position.x-.5)<1&&Math.abs(this.bot.entity.position.z-b.position.z-.5)<1));
  }
  private async furnaceInteraction(block:NonNullable<ReturnType<mineflayer.Bot['blockAt']>>,action:Action,signal:AbortSignal,plan:Plan){
    let window:Awaited<ReturnType<mineflayer.Bot['openFurnace']>>|undefined;
    const remember=()=>{if(!window)return;const item=(i:{name:string;count:number}|null)=>i?{name:i.name,count:i.count}:null;
      const slots={input:item(window.inputItem()),fuel:item(window.fuelItem()),output:item(window.outputItem())};
      this.containers=this.containers.filter(c=>!samePosition(c.position,plan.container!));
      this.containers.push({kind:block.name,position:{...plan.container!},observedAt:Date.now(),slots,items:Object.values(slots).filter((i):i is {name:string;count:number}=>!!i),progress:window.progress??null,fuel:window.fuel??null});this.containers=this.containers.slice(-16);
    };
    try{
      window=await this.bot.openFurnace(block);signal.throwIfAborted();await delay(100,undefined,{signal});remember();
      if(action==='inspect_container')return JSON.stringify({outcome:'container_observed',...this.containers.at(-1)});
      const r=plan.transfer;if(!r||!r.slot||!['input','fuel','output'].includes(r.slot)||!Number.isInteger(r.count)||r.count<1||r.count>64)throw Error('Invalid furnace transfer');
      if(action==='deposit'&&r.slot==='output')throw Error('Invalid furnace output deposit');
      const before=this.itemCount(r.item),slot={input:0,fuel:1,output:2}[r.slot];
      this.transferEvidence={item:r.item,requested:r.count,inventoryBefore:before,containerBefore:window.slots[slot]?.name===r.item?window.slots[slot].count:0};this.phase('transferring','Furnace transfer: processing may change slots; inventory alone is not paired confirmation.');
      const item=action==='deposit'?this.bot.inventory.items().find(i=>i.name===r.item):window.slots[slot];
      if(!item||item.name!==r.item||(action==='deposit'?this.itemCount(r.item):item.count)<r.count)throw Error('Insufficient furnace transfer stock');
      signal.throwIfAborted();
      if(action==='deposit'){if(r.slot==='input')await window.putInput(item.type,item.metadata,r.count);else await window.putFuel(item.type,item.metadata,r.count);}
      else await this.bot.transfer({window,itemType:item.type,metadata:item.metadata,count:r.count,sourceStart:slot,sourceEnd:slot+1,destStart:window.inventoryStart,destEnd:window.inventoryEnd});
      signal.throwIfAborted();if(this.transferEvidence)this.transferEvidence.containerAfter=window.slots[slot]?.name===r.item?window.slots[slot].count:0;remember();window.close();window=undefined;
      const expected=action==='deposit'?-r.count:r.count;
      for(let i=0;i<20&&this.itemCount(r.item)-before!==expected;i++)await delay(50,undefined,{signal});
      if(this.itemCount(r.item)-before!==expected)throw Error('Furnace transfer not confirmed');
      return JSON.stringify({kind:'furnace_transfer',action,item:r.item,count:r.count,slot:r.slot,inventoryDelta:expected,processingComplete:false});
    }finally{if(window){if(this.transferEvidence&&plan?.transfer?.slot){const slot={input:0,fuel:1,output:2}[plan.transfer.slot];this.transferEvidence.containerAfter=window.slots[slot]?.name===this.transferEvidence.item?window.slots[slot].count:0;}remember();window.close();}}
  }
  private async approachPlayer(name:string,signal:AbortSignal,radius=2){
    const deadline=Date.now()+8000;
    while(Date.now()<deadline){
      signal.throwIfAborted();const e=this.bot.players[name]?.entity;
      if(!e||!this.entityVisible(e))throw Error('Player target lost; last seen position is not current tracking');
      if(e.position.distanceTo(this.bot.entity.position)<=radius)return;
      const point={x:e.position.x,y:e.position.y,z:e.position.z},update=new AbortController();let moved=false;
      this.phase('tracking','Approaching the selected visible player; recheck visibility and target movement.');
      const monitor=setInterval(()=>{const now=this.bot.players[name]?.entity;if(!now||!this.entityVisible(now)){update.abort(new Error('Player target lost during approach'));return;}if(distance(now.position,point)>1){moved=true;update.abort(new Error('Visible player moved; update same target'));}},100);
      // GoalNear counts block cells; aim one cell closer so the measured distance lands inside the radius.
      try{await this.navigate(new goals.GoalNear(point.x,point.y,point.z,Math.max(1,radius-1)),AbortSignal.any([signal,update.signal]));}
      catch(e){if(signal.aborted)throw signal.reason;if(!moved)throw update.signal.reason??e;}
      finally{clearInterval(monitor);}
      if(!moved){const current=this.bot.players[name]?.entity;if(!current||!this.entityVisible(current))throw Error('Player target lost after approach');if(current.position.distanceTo(this.bot.entity.position)>radius+.5)throw Error('Player approach ended outside requested distance; reassess');}
    }
    throw Error('Player approach time limit; target not reached');
  }
  private async interact(action:Action,signal:AbortSignal,plan?:Plan){
    // Inventory helpers perform multiple clicks. Stop before every new click after cancellation.
    const original=this.bot.clickWindow;
    this.bot.clickWindow=((...args:Parameters<typeof original>)=>{signal.throwIfAborted();return original.apply(this.bot,args);}) as typeof original;
    let window:Awaited<ReturnType<mineflayer.Bot['openChest']>>|undefined;
    try{
      if(action==='place_table'){
        const item=this.bot.inventory.items().find(i=>i.name==='crafting_table');
        const support=this.placementSupport();if(!item||!support)throw Error('No carried table or safe visible placement surface');
        const target=support.position.offset(0,1,0),before=this.itemCount('crafting_table');
        await this.bot.lookAt(support.position.offset(.5,1,.5),false);signal.throwIfAborted();
        if(!this.blockInSight(support))throw Error('No visible placement support');
        await this.bot.equip(item,'hand');signal.throwIfAborted();
        if(this.bot.blockAt(target)?.name!=='air'||!this.placementSupport(support.position)||!this.blockInSight(support))throw Error('No safe placement space');
        await this.bot.placeBlock(support,support.position.scaled(0).offset(0,1,0));signal.throwIfAborted();
        for(let i=0;i<20&&(this.bot.blockAt(target)?.name!=='crafting_table'||this.itemCount('crafting_table')!==before-1);i++)await delay(50,undefined,{signal});
        if(this.bot.blockAt(target)?.name!=='crafting_table'||this.itemCount('crafting_table')!==before-1)throw Error('Placement not confirmed');
        await this.bot.lookAt(target.offset(.5,.5,.5),false);this.observe(true);
        return `Placed crafting_table at ${target.x},${target.y},${target.z}`;
      }
      if(action==='give'){
        const request=plan?.transfer;if(!request?.recipient||!Number.isInteger(request.count)||request.count<1||request.count>64)throw Error('Invalid transfer');
        const dropKey=request.recipient+':'+request.item;
        if(!plan?.modelSelected&&Date.now()-(this.recentDrops.get(dropKey)??0)<30000)throw Error('Transfer receipt pending; do not repeat drop');
        let target=this.bot.players[request.recipient]?.entity;
        if(!target||!this.entityVisible(target))throw Error('Player not visible');
        const before=this.itemCount(request.item);if(before<request.count)throw Error('Insufficient carried items');
        await this.approachPlayer(request.recipient,signal,2);
        signal.throwIfAborted();target=this.bot.players[request.recipient]?.entity;
        if(!target||!this.entityVisible(target)||target.position.distanceTo(this.bot.entity.position)>3)throw Error('Player moved out of reach');
        await this.bot.lookAt(target.position.offset(0,1,0),false);signal.throwIfAborted();
        const item=this.bot.inventory.items().find(i=>i.name===request.item);if(!item||this.itemCount(request.item)<request.count)throw Error('Insufficient carried items');
        signal.throwIfAborted();this.recentDrops.set(dropKey,Date.now());
        this.phase('transferring','Dropping toward selected visible recipient; receipt remains unconfirmed.');await this.bot.toss(item.type,item.metadata,request.count);signal.throwIfAborted();
        const removed=before-this.itemCount(request.item);
        if(removed!==request.count)throw Error('Transfer drop not confirmed');
        return JSON.stringify({outcome:'dropped_receipt_unconfirmed',recipient:request.recipient,item:request.item,count:removed,receiptConfirmed:false});
      }
      const p=plan?.container;if(!p)throw Error('Missing container');
      if(!this.visible.some(b=>['chest','furnace','blast_furnace','smoker'].includes(b.name)&&samePosition(b.position,p))&&!this.knownPlaces().some(b=>['chest','furnace','blast_furnace','smoker'].includes(b.name)&&samePosition(b.position,p)))throw Error('Requested container has no observation evidence');
      const vec=this.bot.entity.position.scaled(0).offset(p.x,p.y,p.z);
      this.phase('approach','Approaching selected container; no transfer yet.');await this.navigate(new goals.GoalNear(p.x,p.y,p.z,2),signal);signal.throwIfAborted();
      await this.bot.lookAt(vec.offset(.5,.5,.5),false);signal.throwIfAborted();
      const chest=this.bot.blockAt(vec);if(!chest||!['chest','furnace','blast_furnace','smoker'].includes(chest.name)||!this.blockInSight(chest))throw Error('No visible requested container');
      if(chest.name!=='chest')return await this.furnaceInteraction(chest,action,signal,plan!);
      if(plan?.transfer?.slot)throw Error('Invalid transfer slot for chest');
      this.phase('opening','Opening selected observed container; contents are not yet confirmed.');window=await this.bot.openChest(chest);signal.throwIfAborted();this.rememberChest(window,p);
      if(action==='inspect_container')return JSON.stringify({outcome:'chest_observed',...this.containers.at(-1)});
      const request=plan?.transfer;if(!request||!Number.isInteger(request.count)||request.count<1||request.count>64)throw Error('Invalid transfer');
      const depositing=action==='deposit';
      const stock=depositing?this.bot.inventory.items():window.containerItems();
      const item=stock.find(i=>i.name===request.item);
      if(!item||stock.filter(i=>i.name===request.item&&i.metadata===item.metadata).reduce((n,i)=>n+i.count,0)<request.count)throw Error(depositing?'Insufficient carried items':'Insufficient items in chest');
      const before=this.itemCount(request.item),chestBefore=window.containerItems().filter(i=>i.name===request.item).reduce((n,i)=>n+i.count,0);
      this.transferEvidence={item:request.item,requested:request.count,inventoryBefore:before,containerBefore:chestBefore};this.phase('transferring','Transfer may partially apply before confirmation or cancellation.');
      signal.throwIfAborted();
      if(depositing)await window.deposit(item.type,item.metadata,request.count);else await window.withdraw(item.type,item.metadata,request.count);
      signal.throwIfAborted();
      const direction=depositing?1:-1;
      for(let i=0;i<20&&window.containerItems().filter(i=>i.name===request.item).reduce((n,i)=>n+i.count,0)-chestBefore!==direction*request.count;i++)await delay(50,undefined,{signal});
      const chestAfter=window.containerItems().filter(i=>i.name===request.item).reduce((n,i)=>n+i.count,0);
      this.transferEvidence.containerAfter=chestAfter;
      this.rememberChest(window,p);window.close();window=undefined;
      for(let i=0;i<20&&before-this.itemCount(request.item)!==direction*request.count;i++)await delay(50,undefined,{signal});
      if(before-this.itemCount(request.item)!==direction*request.count||chestAfter-chestBefore!==direction*request.count)throw Error(depositing?'Deposit not confirmed':'Withdrawal not confirmed');
      return `${depositing?'Deposited':'Withdrew'} ${request.count} ${request.item}`;
    }finally{if(window){if(this.transferEvidence)this.transferEvidence.containerAfter=window.containerItems().filter(i=>i.name===this.transferEvidence!.item).reduce((n,i)=>n+i.count,0);this.rememberChest(window,plan?.container);window.close();}this.bot.clickWindow=original;}
  }

  private logs() { return this.bot.inventory.items().filter(i => /(_log|_stem)$/.test(i.name)); }
  private count() { return this.logs().reduce((n, i) => n + i.count, 0); }
  private observeStale=true;private observedEye?:ReturnType<mineflayer.Bot['entity']['position']['clone']>;
  // Name and collision shape from the chunk palette; building a full Block for each of ~7000 cells per observation
  // dominated CPU. Unloaded chunks stay unknown (null), never air.
  private cellAt(p:import('./vision.js').Position){
    const v=this.bot.entity.position.scaled(0).offset(p.x,p.y,p.z),world=this.bot.world as unknown as {getColumnAt(v:unknown):unknown;getBlockStateId(v:unknown):number};
    if(typeof world.getColumnAt!=='function')return this.bot.blockAt(v,false);
    if(!world.getColumnAt(v))return null;const b=this.bot.registry.blocksByStateId[world.getBlockStateId(v)];
    return b?{name:b.name,boundingBox:b.boundingBox}:null;
  }
  private shapes=new Map<number,{name:string;shapes:number[][]}>();
  private cellShape(x:number,y:number,z:number){
    const v=this.bot.entity.position.scaled(0).offset(x,y,z),world=this.bot.world as unknown as {getColumnAt(v:unknown):unknown;getBlockStateId(v:unknown):number};
    if(!world.getColumnAt(v))return null;const id=world.getBlockStateId(v);let shape=this.shapes.get(id);
    if(!shape){const b=this.bot.blockAt(v,false) as unknown as {name:string;shapes:number[][];stateId:number}|null;if(!b)return null;shape={name:b.name,shapes:b.shapes};this.shapes.set(b.stateId,shape);}
    return shape;
  }
  // Observation rays only need the first hit's name and cell.
  private cast(from:import('./vision.js').Position,dir:import('./vision.js').Position,range:number){
    // Worlds without chunk access (test doubles) keep prismarine's raycast.
    if(typeof (this.bot.world as unknown as {getColumnAt?:unknown}).getColumnAt!=='function'){const v=this.bot.entity.position.scaled(0),hit=this.bot.world.raycast(v.offset(from.x,from.y,from.z),v.offset(dir.x,dir.y,dir.z),range) as unknown as {name:string;position:import('./vision.js').Position}|null;return hit?{name:hit.name,position:hit.position}:null;}
    return fastRaycast(from,dir,range,(x,y,z)=>this.cellShape(x,y,z));
  }
  private observe(force = false) {
    if (!this.ready || !this.bot.entity) return;
    const dimension = String(this.bot.game.dimension);
    if (dimension !== this.observationDimension) { this.saveSpatial(true);this.memory.clear();this.knownCacheAt=-1;this.knownCache=[];this.navigationHints=[];this.navigationHintsAt=0; this.containers=this.spatial?.get(dimension,this.bot.entity.position).containers??[]; this.observationDimension = dimension; }
    if (!force && Date.now()-this.observedAt<500) return;
    const e=this.bot.entity, eye=e.position.offset(0, (e as typeof e & {eyeHeight?:number}).eyeHeight ?? 1.62, 0);
    if (!force && !this.observeStale && this.observedEye && eye.distanceTo(this.observedEye)<.25 && Date.now()-this.observedAt<3000) return;
    this.observedAt=Date.now();this.observeStale=false;this.observedEye=eye.clone();
    const cast=(d:import('./vision.js').Position) => {
      return this.cast(eye,d,48);
    };
    const near=sampleNearSurfaces(eye,p=>this.cellAt(p),(d,length)=>{
      return this.cast(eye,d,length)?.position??null;
    },this.observedAt,this.knownPlaces());
    const observed=[...sampleSurroundings(cast,this.observedAt),...near];
    this.occlusion=[['east',1,0,0],['west',-1,0,0],['up',0,1,0],['down',0,-1,0],['south',0,0,1],['north',0,0,-1]].map(([direction,x,y,z])=>{const hit=cast({x:Number(x),y:Number(y),z:Number(z)});return {direction:String(direction),surface:hit?{name:hit.name,position:{...hit.position},lastSeen:this.observedAt}:null};});
    this.visible=[...new Map(observed.map(b=>[`${b.position.x},${b.position.y},${b.position.z}`,b])).values()];
    this.memory.observe(this.visible);
    this.containers=this.containers.filter(c=>!this.visible.some(b=>samePosition(b.position,c.position)&&!['chest','furnace','blast_furnace','smoker'].includes(b.name)));
    this.saveSpatial();
  }
  private saveSpatial(force=false){if(!this.spatial||!this.observationDimension)return;this.spatial.update(this.observationDimension,this.memory.snapshot(),this.containers);this.spatial.flush(force);}
  private knownCacheAt=-1;private knownCacheDimension='';private knownCache:import('./vision.js').SeenBlock[]=[];
  private knownPlaces(){
    if(!this.knownCache||this.knownCacheAt!==this.observedAt||this.knownCacheDimension!==this.observationDimension){const m=new PlaceMemory();m.observe(this.spatial?.get(this.observationDimension,this.bot.entity?.position).places??[]);m.observe(this.memory.snapshot());this.knownCache=m.snapshot();this.knownCacheAt=this.observedAt;this.knownCacheDimension=this.observationDimension;}
    return structuredClone(this.knownCache);
  }
  private visibleBlock(matches: (name: string, position: import('./vision.js').Position) => boolean) {
    this.observe();
    const seen=this.visible.filter(b=>matches(b.name,b.position)).sort((a,b)=>this.bot.entity.position.distanceTo(this.bot.entity.position.scaled(0).offset(a.position.x,a.position.y,a.position.z))-this.bot.entity.position.distanceTo(this.bot.entity.position.scaled(0).offset(b.position.x,b.position.y,b.position.z)))[0];
    return seen ? this.bot.blockAt(this.bot.entity.position.scaled(0).offset(seen.position.x,seen.position.y,seen.position.z)) : null;
  }
  private chest() { return this.visibleBlock(name => name === 'chest'); }
  private table() { return this.visibleBlock(name => name === 'crafting_table'); }
  private entityVisible(entity: mineflayer.Bot['entity']) {
    const eye=this.bot.entity.position.offset(0,1.62,0), target=entity.position.offset(0,entity.height/2,0);
    const offset=target.minus(eye), distance=offset.norm();
    if(!distance || distance>48)return false;
    const d=offset.scaled(1/distance), f=viewDirection(this.bot.entity.yaw,this.bot.entity.pitch);
    // Automatic surrounding sensing still requires an unobstructed ray.
    return !this.bot.world.raycast(eye,d,Math.max(0,distance-.1));
  }
  private async navigate(goal: InstanceType<typeof goals.GoalNear>,signal?:AbortSignal,options:{escape?:boolean}={}) {
    // Traverse only observed supports, then look again from the reached frontier.
    // Do not pass an incomplete/no-path search to goto: upstream can reject its
    // Promise while continuing to walk a partial path.
    try{
      for(let leg=0;leg<8;leg++){
        signal?.throwIfAborted();
        const observed=new Map<string,import("./vision.js").SeenBlock>();const capture=()=>{for(const block of this.visible??[])observed.set(JSON.stringify(block.position),block);};capture();
        const feet=this.bot.entity.position.floored();
        if(goal.isEnd(feet as any))return;
        const p=this.bot.entity.position,yaw=Math.atan2(-(goal.x+.5-p.x),-(goal.z+.5-p.z));
        await this.bot.look(yaw,-Math.PI/4,false);signal?.throwIfAborted();this.observe(true);capture();
        let scanned=false;let path=this.bot.pathfinder.getPathTo(this.bot.pathfinder.movements,goal,200);
        let end=path.path.at(-1);
        if(!end||end.x===feet.x&&end.y===feet.y&&end.z===feet.z){
          // A detour may begin beside/behind us. Turn the actual camera before
          // admitting those footholds; never query unseen supports as knowledge.
          scanned=true;for(const turn of [Math.PI/2,Math.PI,-Math.PI/2]){
            await this.bot.look(yaw+turn,-Math.PI/4,false);signal?.throwIfAborted();this.observe(true);capture();
          }
          path=this.bot.pathfinder.getPathTo(this.bot.pathfinder.movements,goal,200);end=path.path.at(-1);
        }
        if(options.escape&&(!end||end.x===feet.x&&end.y===feet.y&&end.z===feet.z)){
          // No walkable route: for a chosen move only, try once more allowing digging and pillaring (escape from a pit
          // or enclosure). Approaches for placing, mining or using things never dig: in CONT4 Alice's approach to a
          // placement site dug her out of her own night shelter, and a zombie outside killed her.
          let escape:ReturnType<typeof escapeMovements>|undefined;try{escape=escapeMovements(this.bot,p=>!!this.ownPlaced?.has(`${p.x},${p.y},${p.z}`));}catch{escape=undefined;}
          const dug=escape?this.bot.pathfinder.getPathTo(escape,goal,400):{path:[] as {x:number;y:number;z:number}[],status:'noPath'},dugEnd=dug.path.at(-1);
          if(dugEnd&&!(dugEnd.x===feet.x&&dugEnd.y===feet.y&&dugEnd.z===feet.z)){
            this.log('navigation_escape',{from:{x:feet.x,y:feet.y,z:feet.z},to:{x:goal.x,y:goal.y,z:goal.z},status:dug.status,steps:dug.path.length});
            const previous=this.bot.pathfinder.movements;this.bot.pathfinder.setMovements(escape!);
            try{await this.bot.pathfinder.goto(dug.status==='success'?goal:new goals.GoalNear(dugEnd.x,dugEnd.y,dugEnd.z,0));}finally{this.bot.pathfinder.setGoal(null);this.bot.clearControlStates();this.bot.pathfinder.setMovements(previous);}
            signal?.throwIfAborted();this.observe(true);continue;
          }
        }
        if(!end||end.x===feet.x&&end.y===feet.y&&end.z===feet.z)throw new NavigationFailure(navigationEvidence('no observed route after local scan',this.bot.entity.position,{x:goal.x,y:goal.y,z:goal.z},Math.sqrt((goal as any).rangeSq),path,[...observed.values()],scanned));
        const waypoint=path.status==='success'?goal:new goals.GoalNear(end.x,end.y,end.z,0);
        try{await this.bot.pathfinder.goto(waypoint);}finally{this.bot.pathfinder.setGoal(null);this.bot.clearControlStates();}
        signal?.throwIfAborted();
        if(!waypoint.isEnd(this.bot.entity.position.floored() as any))throw Error('Destination not reached: waypoint');
      }
      if(!goal.isEnd(this.bot.entity.position.floored() as any))throw Error('Destination not reached: approach limit');
    }finally{this.bot.pathfinder.setGoal(null);this.bot.clearControlStates();}
  }
  private food() { return this.bot.inventory.items().find(i => this.bot.registry.foodsByName[i.name]); }
  private enemies(): Enemy[] {
    if(!this.ready)return [];
    return Object.values(this.bot.entities).filter(e=>hostileKinds.has(e.name ?? '') && !this.combatEvidence?.get(e.id)?.deathObserved && this.entityVisible(e))
      .map(e=>{this.combatEvidence?.seen(e.id,e.name!,Date.now());return {id:e.id,kind:e.name!,position:{x:e.position.x,y:e.position.y,z:e.position.z},distance:e.position.distanceTo(this.bot.entity.position)};})
      .sort((a,b)=>a.distance-b.distance).slice(0,16);
  }
  private animals():Enemy[]{
    if(!this.ready)return [];
    return Object.values(this.bot.entities).filter(e=>animalKinds.has(e.name??'')&&!this.combatEvidence?.get(e.id)?.deathObserved&&this.entityVisible(e)).map(e=>{this.combatEvidence?.seen(e.id,e.name!,Date.now());return {id:e.id,kind:e.name!,position:{x:e.position.x,y:e.position.y,z:e.position.z},distance:e.position.distanceTo(this.bot.entity.position)};});
  }
  private equipment() {
    const slots: [string,number][]=[['head',5],['chest',6],['legs',7],['feet',8],['offhand',45]];
    const result=slots.flatMap(([slot,n])=>{const i=this.bot.inventory.slots[n];return i?[{slot,name:i.name,durabilityUsed:i.durabilityUsed}]:[];});
    const held=this.bot.heldItem;
    if(held)result.push({slot:'hand',name:held.name,durabilityUsed:held.durabilityUsed});
    return result;
  }
  private async fight(action:'attack'|'flee',signal:AbortSignal,plan?:Plan) {
    const before=this.bot.health;
    const targets=()=>action==='attack'?[...this.enemies(),...this.animals()]:this.enemies();
    const kind=(plan?.targetEntityId===undefined?targets()[0]:targets().find(e=>e.id===plan.targetEntityId))?.kind ?? 'unknown';
    let result:Encounter | undefined;
    let lastApproach: {x:number;y:number;z:number;at:number}|undefined;
    try {
      result=await combat({
        progress:value=>{if(this.motor)this.motor.combat=value;},
        observe:()=>({health:this.bot.health,position:this.bot.entity.position,enemies:targets()}),
        faceLastSeen:async(p,s)=>{
          s.throwIfAborted();await this.bot.lookAt(this.bot.entity.position.scaled(0).offset(p.x,p.y+1,p.z),false);s.throwIfAborted();
        },
        targetEvidence:id=>this.combatEvidence.get(id),
        // Fight with the best carried weapon even when the model chose the attack; DUO3 bots fought holding an axe
        // while an iron sword sat in the next slot.
        equipWeapon:async()=>{
          const best=[...this.bot.inventory.items()].sort((a,b)=>weaponRank(b.name)-weaponRank(a.name))[0];
          if(best&&weaponRank(best.name)>weaponRank(this.bot.heldItem?.name??''))await this.bot.equip(best,'hand');
        },
        // Conservative local timing by OWN tool class, not opponent strength.
        cooldownMs:()=>combatCooldownMs(this.bot.heldItem?.name),
        approach:e=>{
          this.bot.setControlState('back',false);
          const now=Date.now();
          if(lastApproach&&distance(lastApproach,e.position)<.6&&now-lastApproach.at<500)return;
          lastApproach={...e.position,at:now};
          this.bot.pathfinder.setGoal(new goals.GoalNear(e.position.x,e.position.y,e.position.z,2));
        },
        strike:async id=>{
          const e=this.bot.entities[id];
          if(!e || !(hostileKinds.has(e.name ?? '')||animalKinds.has(e.name??'')) || !this.entityVisible(e) || e.position.distanceTo(this.bot.entity.position)>2.8)return false;
          await this.bot.lookAt(e.position.offset(0,e.height/2,0),false);
          signal.throwIfAborted();
          if(!this.entityVisible(e) || e.position.distanceTo(this.bot.entity.position)>2.8)return false;
          this.bot.attack(e);return true;
        },
        backstep:(e,others)=>{
          const here=this.bot.entity.position,dx=here.x-e.position.x,dz=here.z-e.position.z,len=Math.hypot(dx,dz);
          if(len<.1)return false;
          const behind=here.offset(dx/len*1.2,0,dz/len*1.2),feet=this.bot.blockAt(behind),floor=this.bot.blockAt(behind.offset(0,-1,0));
          // Only onto solid ground at the same level, never into a drop, liquid or another hostile.
          if(!floor||floor.boundingBox!=='block'||!feet||feet.boundingBox!=='empty'||/lava|water/.test(feet.name+floor.name))return false;
          if(others.some(o=>distance(o,behind)<3))return false;
          this.bot.pathfinder.setGoal(null);
          void this.bot.lookAt(here.scaled(0).offset(e.position.x,e.position.y+1.5,e.position.z),true);
          this.bot.setControlState('forward',false);this.bot.setControlState('back',true);return true;
        },
        retreat:(from,others=[])=>{
          const here=this.bot.entity.position,threats=[from,...others],nearest=(p:{x:number;y:number;z:number})=>Math.min(...threats.map(t=>distance(p,t)));
          // Known floor up to 24 blocks away (one block of height change), farthest from the nearest threat first:
          // fleeing one zombie of a group ran toward the others.
          const options=this.memory.snapshot().filter(b=>Math.abs(b.position.y-(Math.floor(here.y)-1))<=1 && distance(b.position,here)<=24)
            .map(b=>({x:b.position.x+.5,y:b.position.y+1,z:b.position.z+.5}))
            .filter(p=>nearest(p)>nearest(here)+4).sort((a,b)=>nearest(b)-nearest(a));
          if(!options.length)return false;
          const p=options[0];this.bot.pathfinder.setGoal(new goals.GoalNear(p.x,p.y,p.z,1));return true;
        },
        stop:()=>{lastApproach=undefined;this.stop();},wait:(ms,s)=>delay(ms,undefined,{signal:s}),now:()=>Date.now(),
      },action,signal,plan?.targetEntityId===undefined?undefined:{targetId:plan.targetEntityId,modelSelected:plan.modelSelected});
      return JSON.stringify(result);
    } finally {
      this.encounters.push(result ?? {kind,action,startedAt:Date.now(),healthBefore:before,healthAfter:this.bot.health,attacksSent:null,outcome:signal.aborted?'cancelled_partial_actions_unknown':'failed_partial_actions_unknown'});
      this.encounters=this.encounters.slice(-12);
    }
  }
  private sitesCacheAt=-1;private sitesCache:NonNullable<Snapshot['placementSites']>=[];
  private observedPlacementSites(){
    if(Number.isFinite(this.observedAt)&&this.sitesCacheAt===this.observedAt)return this.sitesCache;
    const sites:NonNullable<Snapshot['placementSites']>=[],eye=this.bot.entity.position.offset(0,1.62,0);
    for(const b of this.visible){
      if(['air','cave_air','void_air','water','lava'].includes(b.name))continue;
      const ref=this.bot.entity.position.scaled(0).offset(b.position.x,b.position.y,b.position.z);
      for(const [x,y,z] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){
        const target=ref.offset(x,y,z),contact=ref.offset(.5+x*.5,.5+y*.5,.5+z*.5),delta=contact.minus(eye),length=delta.norm();
        if(target.offset(.5,.5,.5).distanceTo(eye)>12||length<.05||this.cast(eye,delta.scaled(1/length),length-.02))continue;
        if(!replaceable(this.bot.blockAt(target)?.name)||overlapsCell(target,this.bot.entity.position))continue;
        sites.push({position:{x:target.x,y:target.y,z:target.z},reference:{...b.position}});
      }
    }
    this.sitesCacheAt=this.observedAt;this.sitesCache=sites;return sites;
  }
  private catalogMissingLogged=false;
  // Permitted recipes per unlocked output, rebuilt only when the unlocked set or recipe catalog changes.
  private recipeIndex?:{book:unknown;key:string;byName:Map<string,{recipes:any[];facts?:RecipeFact[]}>};
  private unlockedRecipes(){
    const unlocked=this.recipeBook.snapshot().unlocked,key=String(this.recipeBook.revision);
    if(this.recipeIndex?.key!==key||this.recipeIndex.book!==this.recipeBook){
      const byName=new Map<string,{recipes:any[]}>();
      for(const name of new Set(unlocked.map(id=>id.replace(/^minecraft:/,'')))){const id=this.bot.registry.itemsByName[name]?.id;if(id!==undefined)byName.set(name,{recipes:this.bot.recipesAll(id,null,true).filter(r=>this.recipeBook.permits?.(r)??true)});}
      this.recipeIndex={book:this.recipeBook,key,byName};
    }
    return this.recipeIndex.byName;
  }
  recipes(item:string):RecipeFact[]{
    if(!this.ready)return [];const entry=this.unlockedRecipes().get(item);if(!entry)return [];
    return entry.facts??=entry.recipes.flatMap(r=>{const fact=recipeFact(r,this.bot.registry.items);return fact?[fact]:[];});
  }
  private craftCache?:{key:string;craftable:string[];inventoryCraftable:string[];crafting?:Snapshot['crafting']};
  snapshot(): Snapshot {
    this.observe();
    const position = this.bot.entity?.position ?? { x: 0, y: 0, z: 0 };
    const logs = this.ready ? this.count() : 0;
    const table=this.ready ? this.table() : null;
    const knownTables=this.ready?this.knownPlaces().some(b=>b.name==='crafting_table'&&distance(b.position,position)<=48):false;
    // Recipe feasibility scans every unlocked recipe (over a second with ~1300 unlocked), so it is recomputed only
    // when inventory, unlocked recipes or workstation access change.
    const craftKey=this.ready?JSON.stringify([this.bot.inventory.items().map(i=>[i.type,i.metadata,i.count]),this.recipeBook.revision,table?.position?[table.position.x,table.position.y,table.position.z]:null,knownTables]):'';
    if(craftKey!==this.craftCache?.key){
      // Same test as mineflayer's recipesFor(item,null,1,table) on the cached permitted recipes.
      const counts=new Map<string,number>(),count=(id:number,metadata:number|null)=>{const k=id+':'+metadata;let n=counts.get(k);if(n===undefined){n=this.bot.inventory.count(id,metadata);counts.set(k,n);}return n;};
      const met=(r:any)=>r.delta.every((d:any)=>count(d.id,d.metadata)+d.count*Math.ceil(1/r.result.count)>=0);
      const inventoryCraftable:string[]=[],craftable:string[]=[];
      if(this.ready)for(const [name,{recipes}] of this.unlockedRecipes()){
        const byHand=recipes.some(r=>!r.requiresTable&&met(r));if(byHand)inventoryCraftable.push(name);
        if(byHand||!!(table??knownTables)&&recipes.some(met))craftable.push(name);
      }
      this.craftCache={key:craftKey,craftable,inventoryCraftable};
    }
    const craftable=[...this.craftCache!.craftable],inventoryCraftable=[...this.craftCache!.inventoryCraftable];
    const knownPlaces=this.knownPlaces();
    const snapshot:Snapshot={selfName:this.bot.username,sleeping:this.bot.isSleeping,timeOfDay:this.bot.time?.timeOfDay,time:dayTime(this.bot.time?.timeOfDay),animals:this.animals(), inventoryCraftable,perception:{mode:'panorama',range:48,occlusion:this.occlusion,semantics:'Automatic all-direction observation: per-block visible-face checks within 12 blocks of eyes and sampled first hits up to 48; no look needed. First-hit surfaces occlude space behind them. occlusion lists six sampled axis rays only, not entire sectors: a surface blocks that ray beyond it; null means no surface hit within range, not a known empty volume. Unsampled or beyond-range space is unknown, not empty; remembered cells are past observations.'},importantPlaces:this.importantPlaces?.snapshot()??[],placementSites:this.ready?this.observedPlacementSites():[],edibleItems:this.ready?[...new Set(this.bot.inventory.items().filter(i=>this.bot.registry.foodsByName[i.name]).map(i=>i.name))]:[],observedDestinationKeys:knownPlaces.map(b=>[b.position.x,b.position.y,b.position.z].join(',')),navigationTargets:this.navigationTargets(),visibleItems:this.ready?this.visibleItems():[],rememberedItems:this.ready?this.dropMemory.remembered(this.visibleItems()):[],respawnPoint:this.respawnBed?{kind:'bed',position:this.respawnBed.position,dimension:this.respawnBed.dimension}:{kind:'world_spawn'},ownPlacedBlocks:!this.ready||!this.bot.entity||!this.ownPlaced?[]:[...this.ownPlaced.values()].filter(b=>{const now=this.bot.blockAt(this.bot.entity.position.scaled(0).offset(b.position.x,b.position.y,b.position.z));if(now&&now.name!==b.name){this.ownPlaced.delete(`${b.position.x},${b.position.y},${b.position.z}`);return false;}return true;}).map(b=>({name:b.name,position:b.position})),placeableItems:this.ready?[...new Set(this.bot.inventory.items().filter(i=>buildingMaterial(i.name)&&this.bot.registry.blocksByName[i.name]).map(i=>i.name))]:[],containers:structuredClone(this.containers),canPlaceTable:this.ready&&this.itemCount('crafting_table')>0&&!!this.placementSupport(),onlinePlayers:this.ready?Object.keys(this.bot.players).filter(n=>n!==this.bot.username).sort():[],nearbyPlayers:this.ready?Object.values(this.bot.entities).filter(e=>e.type==='player'&&e.username&&e.username!==this.bot.username&&this.entityVisible(e)).map(e=>({name:e.username!,position:{x:e.position.x,y:e.position.y,z:e.position.z}})):[],incomingDamage:this.incomingDamage.snapshot(Date.now()),combatEvents:this.combatEvidence.snapshot(),enemies:this.enemies(),equipment:this.ready?this.equipment():[],encounters:structuredClone(this.encounters), inventory: this.ready ? this.bot.inventory.slots.flatMap((i,slot)=>i && slot>=5 ? [{name:i.name,count:i.count,slot,enchants:structuredClone(i.enchants??[]),durabilityUsed:i.durabilityUsed}] : []) : [],
      vision: {yaw:this.bot.entity?.yaw ?? 0,pitch:this.bot.entity?.pitch ?? 0,blocks:structuredClone(this.visible)}, places:structuredClone(knownPlaces),craftable,
      dimension:String(this.bot.game?.dimension??'unknown'),environment:{inWater:!!(this.bot.entity as any)?.isInWater,inLava:!!(this.bot.entity as any)?.isInLava,onGround:!!this.bot.entity?.onGround,oxygen:(this.bot as any).oxygenLevel},lifecycle:{generation:this.generation,deathCount:this.deathCount,phase:this.dead?'dead':this.ready?'alive':'connecting',lastDeath:this.recovery.context().deaths.at(-1)},recovery:this.recovery.view(),
      ready: this.ready, health: this.bot.health ?? 0, food: this.bot.food ?? 0, logs,
      canMine: this.ready && this.visible.some(b=>!['bedrock','water','lava','air'].includes(b.name)), canDeposit: this.ready && this.bot.inventory.items().length>0 && this.visible.some(b=>['chest','furnace','blast_furnace','smoker'].includes(b.name)),
      foodAvailable: this.ready && !!this.food(),
      canEat: this.ready && (this.bot.food ?? 20) < 20 && !!this.food(),
      canFollow: this.ready && !!this.bot.players[this.c.follow]?.entity && this.entityVisible(this.bot.players[this.c.follow].entity!),
      position: { x: position.x, y: position.y, z: position.z }, chatEvents:structuredClone(this.chatEvents),messages: [...this.messages], recipeBook: this.recipeBook.snapshot() };
    if(this.ready&&this.recipeBook.snapshot().unlocked.length&&!this.recipeBook.catalogSize&&!this.catalogMissingLogged){this.catalogMissingLogged=true;this.log('recipe_catalog_missing',{unlocked:this.recipeBook.snapshot().unlocked.length,meaning:'declare_recipes not received; recipes are gated by unlocked names only'});}
    // Same inputs as craftable (inventory, recipes, workstation access), so it shares the cache key.
    this.craftCache!.crafting??=craftingState(snapshot,item=>this.recipes(item),item=>{const id=this.bot.registry.itemsByName[item]?.id;return id===undefined||!craftable.includes(item)?0:feasibleExecutions(count=>this.bot.recipesAll(id,null,table??knownTables).some(r=>this.recipeBook.permits(r)&&recipeBatchAvailable(r,count,(id,metadata)=>this.bot.inventory.count(id,metadata??null))));});
    snapshot.crafting=structuredClone(this.craftCache!.crafting);
    if(snapshot.ready&&snapshot.health>0&&!this.dead)this.lastAlivePossessions={at:Date.now(),inventory:structuredClone(snapshot.inventory),equipment:structuredClone(snapshot.equipment)};
    return snapshot;
  }
  async execute(action: Action, signal: AbortSignal, plan?: Plan) {
    this.actionReceipt=undefined;this.placementReceipt=undefined;this.transferEvidence=undefined;
    const totals=()=>{const t:Record<string,number>={};for(const i of this.bot?.inventory?.items?.()??[])if(i.name)t[i.name]=(t[i.name]??0)+i.count;return t;};
    const position=()=>{const p=this.bot?.entity?.position;return p?{x:p.x,y:p.y,z:p.z}:null;};
    const before=totals(),from=position(),started=Date.now();let returned:string|undefined,failure:string|undefined,phaseAtEnd:string|undefined;
    this.phase('prepare','Validating selected action; no completion claimed.');
    try{returned=await this.executeAction(action,signal,plan);return returned;}
    catch(e){failure=e instanceof Error?e.message:String(e);throw e;}
    finally{
      phaseAtEnd=this.motor?.phase;const after=totals();const inventoryDelta=Object.keys({...before,...after}).map(item=>({item,delta:(after[item]??0)-(before[item]??0)})).filter(x=>x.delta);
      let parsed:any;try{parsed=JSON.parse(returned??'');}catch{}
      const t=this.transferSnapshot(),delta=t?(after[t.item]??0)-t.inventoryBefore:undefined;
      const transfer=t?{item:t.item,requested:t.requested,inventoryDelta:delta,containerDelta:t.containerAfter===undefined?null:t.containerAfter-t.containerBefore,confirmedTransferred:t.containerAfter!==undefined&&delta===-(t.containerAfter-t.containerBefore)?Math.max(0,Math.min(t.requested,action==='deposit'?-delta!:delta!)):null}:undefined;
      this.actionReceipt={action,target:plan?.mine??plan?.build??plan?.craft??plan?.container??plan?.pickup??plan?.followPlayer??plan?.destination??plan?.targetEntityId??null,phaseAtEnd,motorAtEnd:this.executionProgress(),elapsedMs:Date.now()-started,cancelRequested:signal.aborted,returned:returned!==undefined,failureReason:failure??parsed?.detail,reportedStatus:parsed?.status??parsed?.outcome,from,to:position(),inventoryDelta,...(transfer?{transfer:{...transfer,remaining:transfer.confirmedTransferred===null?null:t!.requested-transfer.confirmedTransferred}}:{}),meaning:'Observed changes and execution outcome are separate. Inventory deltas alone do not prove item origin, recipient receipt or task completion. Missing confirmation is unknown, not zero effect.'};
      this.motor=undefined;
    }
  }
  private async executeAction(action: Action, signal: AbortSignal, plan?: Plan) {
    this.placementReceipt=undefined;signal.throwIfAborted();
    const cancel = () => this.stop(); signal.addEventListener('abort', cancel, { once: true });
    let window: Awaited<ReturnType<mineflayer.Bot['openChest']>> | undefined;
    try {
      this.observe(true);
      if(action==='sleep'){
        const p=plan?.bed;if(!p)throw Error('Missing selected bed');
        if(!['overworld','minecraft:overworld'].includes(String(this.bot.game.dimension)))throw Error('Sleep only supported in Overworld');
        const known=this.knownPlaces().find(b=>sameCell(b.position,p));if(!known||!isBed(known.name)||distance(p,this.bot.entity.position)>13.62)throw Error('Bed not known in local scope');
        this.phase('approach','Approaching selected bed; sleep not yet confirmed.');await this.navigate(new goals.GoalNear(p.x,p.y,p.z,2),signal);signal.throwIfAborted();this.observe(true);
        const bed=this.bot.blockAt(this.bot.entity.position.scaled(0).offset(p.x,p.y,p.z));if(!bed||!isBed(bed.name)||!this.blockInSight(bed))throw Error('Selected bed changed or occluded');
        this.phase('opening','Requesting server-confirmed sleep in selected bed.');
        // The server states why it refused (for example a block above the bed); without it the bot only saw
        // "bot is not sleeping" and kept retrying an obstructed bed in DUO4.
        let refusal:string|undefined,spawnSet=false;const onMessage=(m:unknown)=>{const key=(m as {translate?:string}|null)?.translate;if(key==='block.minecraft.set_spawn')spawnSet=true;else if(typeof key==='string'&&key.startsWith('block.minecraft.bed.'))refusal=key;};
        this.bot.on?.('message',onMessage);
        const dimension=String(this.bot.game.dimension),night=this.bot.time.timeOfDay>=12541&&this.bot.time.timeOfDay<=23458,thunder=this.bot.isRaining&&(this.bot as any).thunderState>0;
        // mineflayer refuses before contacting the server in daytime, but vanilla still sets the respawn point
        // when a bed is used by day. Use the bed directly and report what the server said.
        if(!night&&!thunder){
         try{await this.bot.activateBlock(bed);const until=Date.now()+1500;while(!spawnSet&&!refusal&&Date.now()<until)await delay(50,undefined,{signal});}
         finally{this.bot.removeListener?.('message',onMessage);}
         if(spawnSet){this.setRespawnBed({position:{...p},dimension,at:Date.now()});this.log('respawn_set',{bed:p});}
         if(refusal&&refusal!=='block.minecraft.bed.no_sleep')throw Error(`Server refused bed use: ${BED_REFUSALS[refusal]??refusal} (${refusal})`);
         if(!spawnSet)throw Error('Bed used in daytime; the server did not confirm a respawn point');
         return RESPAWN_SET_RESULT;
        }
        try{await this.bot.sleep(bed);this.setRespawnBed({position:{...p},dimension,at:Date.now()});this.log('sleep_confirmed',{bed:p,timeOfDay:this.bot.time.timeOfDay});signal.throwIfAborted();while(this.bot.isSleeping){await delay(100,undefined,{signal});}return 'Sleep confirmed, then woke';}
        catch(error){if(!refusal&&!signal.aborted)await delay(100);if(refusal)throw Error(`Server refused sleep: ${BED_REFUSALS[refusal]??refusal} (${refusal})`);throw error;}
        finally{this.bot.removeListener?.('message',onMessage);if(this.bot.isSleeping)await this.bot.wake();}
      }
      if(action==='equip')return await executeEquip(this.bot,plan?.equip!,signal);
      if(action==='pickup')return await this.pickupItem(signal,plan);
      if(action==='mine')return await this.mineBlock(signal,plan);
      if(action==='place_block'||action==='place_table'&&plan?.modelSelected)return await this.buildAction('place_block',signal,plan);
      if(['place_table','inspect_container','withdraw','deposit','give'].includes(action))return await this.interact(action,signal,plan);
      if(action==='attack'||action==='flee'){this.phase('tracking','Bounded interaction with the selected visible enemy or passive animal; motor.combat distinguishes approach, swing delay and attacks. Target loss is not death.');return await this.fight(action,signal,plan);}
      if (action === 'look') {
        await this.bot.look(plan?.look?.yaw ?? this.bot.entity.yaw+Math.PI/2, plan?.look?.pitch ?? (Math.abs(this.bot.entity.pitch)<.2?-Math.PI/4:0), false);
        this.observe(true);
      }
      if (action === 'move') {
        const p=plan?.destination;
        if (!p || !(knownDestination({places:this.knownPlaces(),dimension:String(this.bot?.game?.dimension??''),recovery:this.recovery?.context(),importantPlaces:this.importantPlaces?.snapshot()??[]},p)||referencedDestination(plan))) throw new Error('Destination not observed');
        this.phase('approach','Moving to selected coordinate; arrival is not proof of task reach or safety.');await this.navigate(new goals.GoalNear(p.x,p.y,p.z,MOVE_RADIUS),signal,{escape:true});
        this.observe(true);return JSON.stringify({kind:'move',outcome:'arrived_within_radius',target:p,radius:MOVE_RADIUS,meaning:'Arrival is not proof of route safety or reach for another task.'});
      }
      if (action === 'craft') {
        const request=plan?.craft;
        if(!request || !Number.isInteger(request.count) || request.count<1 || request.count>16) throw new Error('Invalid crafting request');
        const item=this.bot.registry.itemsByName[request.item];
        if(!item) throw new Error('Unknown item');
        const matches=(r:any)=>(!request.recipeKey||recipeFact(r,this.bot.registry.items)?.key===request.recipeKey)&&(!this.recipeBook.snapshot().unlocked.some(id=>id.replace(/^minecraft:/,'')===request.item)||(this.recipeBook.permits?.(r)??true));
        if(request.recipeKey&&!this.recipes(request.item).some(r=>r.key===request.recipeKey))throw Error('Invalid crafting recipe: not unlocked or no longer available');
        const inventoryRecipe=this.bot.recipesFor(item.id,null,1,null).find(r=>matches(r)&&recipeBatchAvailable(r,request.count,(id,metadata)=>this.bot.inventory.count(id,metadata??null)));
        let table=inventoryRecipe ? null : this.table();
        if(!inventoryRecipe&&request.workstation){
          const p=request.workstation,known=this.visible?.find(b=>samePosition(b.position,p))??this.knownPlaces().find(b=>samePosition(b.position,p));
          if(known?.name!=='crafting_table')throw Error('No observed selected workstation');
          this.phase('approach','Approaching selected workstation; crafting has not started.');
          await this.navigate(new goals.GoalNear(p.x,p.y,p.z,2),signal);signal.throwIfAborted();this.observe(true);
          const v=this.bot.entity.position.scaled(0).offset(p.x,p.y,p.z),observed=this.bot.blockAt(v);
          if(observed?.name!=='crafting_table'||!this.blockInSight(observed))throw Error('Selected workstation changed or occluded after approach');
          table=observed;
        }else if(!inventoryRecipe&&!table&&!plan?.modelSelected){
          const remembered=this.knownPlaces().filter(b=>b.name==='crafting_table').sort((a,b)=>Math.hypot(a.position.x-this.bot.entity.position.x,a.position.y-this.bot.entity.position.y,a.position.z-this.bot.entity.position.z)-Math.hypot(b.position.x-this.bot.entity.position.x,b.position.y-this.bot.entity.position.y,b.position.z-this.bot.entity.position.z))[0];
          if(remembered&&Math.hypot(remembered.position.x-this.bot.entity.position.x,remembered.position.y-this.bot.entity.position.y,remembered.position.z-this.bot.entity.position.z)<=48){
            this.phase('approach','Approaching remembered workstation; existence remains unconfirmed.');
            await this.navigate(new goals.GoalNear(remembered.position.x,remembered.position.y,remembered.position.z,2),signal);
            signal.throwIfAborted();await this.bot.lookAt(this.bot.entity.position.scaled(0).offset(remembered.position.x+.5,remembered.position.y+.5,remembered.position.z+.5),false);signal.throwIfAborted();this.observe(true);table=this.table();
          }
        }
        if(table) {
          this.phase('approach','Approaching workstation; crafting has not started.');
          await this.navigate(new goals.GoalNear(table.position.x,table.position.y,table.position.z,2),signal);
          signal.throwIfAborted(); await this.bot.lookAt(table.position.offset(.5,.5,.5),false);signal.throwIfAborted();this.observe(true);
          const observed=this.bot.blockAt(table.position);
          table=observed?.name==='crafting_table'&&this.blockInSight(observed)?observed:null;
        }
        const recipe=inventoryRecipe ?? this.bot.recipesFor(item.id,null,1,table).find(r=>matches(r)&&recipeBatchAvailable(r,request.count,(id,metadata)=>this.bot.inventory.count(id,metadata??null)));
        if(!recipe) throw new Error(craftFailure(this.bot,request,this.recipeBook.snapshot().unlocked,table,r=>this.recipeBook.permits?.(r)??true));
        await settleCraftInventory(this.bot);
        const before=this.bot.inventory.items().filter(i=>i.type===item.id).reduce((n,i)=>n+i.count,0);
        signal.throwIfAborted(); if(recipe.delta.some(d=>this.bot.inventory.count(d.id,d.metadata)+d.count*request.count<0)) throw new Error(craftFailure(this.bot,request,this.recipeBook.snapshot().unlocked,table,r=>this.recipeBook.permits?.(r)??true));
        // Mineflayer has no craft AbortSignal: guard every inventory click and
        // finish one recipe at a time so cancellation cannot start another batch.
        const originalClick=this.bot.clickWindow;
        this.bot.clickWindow=((...args: Parameters<typeof originalClick>)=>{
          signal.throwIfAborted(); return originalClick.apply(this.bot,args);
        }) as typeof originalClick;
        this.phase('crafting','Executing selected recipe batches; inventory changes, not requested count, establish progress.');
        try { for(let i=0;i<request.count;i++){
          signal.throwIfAborted();
          try{await this.bot.craft(recipe,1,table ?? undefined);}
          finally{
            this.bot.clickWindow=originalClick;
            await settleCraftInventory(this.bot);
            this.bot.clickWindow=((...args: Parameters<typeof originalClick>)=>{signal.throwIfAborted();return originalClick.apply(this.bot,args);}) as typeof originalClick;
          }
        } } finally { this.bot.clickWindow=originalClick; }
        signal.throwIfAborted();
        const after=this.bot.inventory.items().filter(i=>i.type===item.id).reduce((n,i)=>n+i.count,0);
        if(after-before<recipe.result.count*request.count) throw new Error('Crafting not confirmed');
        return `Crafted ${after-before} ${request.item}`;
      }
      if (action === 'idle') await delay(plan?.modelSelected?Math.max(100,Math.min(10000,plan.waitMs??300)):300, undefined, { signal });
      if (action === 'follow') {
        const target = this.bot.players[plan?.followPlayer??this.c.follow]?.entity;
        if (!target || !this.entityVisible(target)) throw new Error('Player not visible');
        await this.approachPlayer(plan?.followPlayer??this.c.follow,signal,2);
        return JSON.stringify({kind:'follow',outcome:'within_distance',player:plan?.followPlayer??this.c.follow,radius:2,meaning:'Reached selected visible player for this bounded action; not a promise of continuous following.'});
      }
      if (action === 'eat') {
        const item = plan?.modelSelected?this.bot.inventory.items().find(i=>i.name===plan.foodItem&&this.bot.registry.foodsByName[i.name]):this.food(); if (!item) throw new Error('No food');
        const before = this.bot.food;
        await this.bot.equip(item, 'hand'); signal.throwIfAborted(); await this.bot.consume();
        if (this.bot.food <= before) throw new Error('Eating not confirmed');
      }
      signal.throwIfAborted(); return `Completed ${action}`;
    } finally { window?.close(); signal.removeEventListener('abort', cancel); }
  }
  stop() {
    this.bot.pathfinder?.setGoal(null); this.bot.clearControlStates();
    this.bot.stopDigging(); this.bot.deactivateItem();
  }
  chat(text: string) {
    const clean = text.replace(/[\r\n]/g, ' ').trim();
    if (this.ready && clean && !clean.startsWith('/')) this.bot.chat(clean.slice(0, 180));
  }
  close() { this.saveSpatial(true);this.ready = false; this.recipeBook.reset(); this.bot.quit(); }
}
