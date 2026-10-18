import {ImportantPlaces} from './important-places.js';
import {reachedCell} from './reach.js';
import {localNavigationTargets} from './navigation.js';
import {tableSupportMaterial} from './building.js';
import {knownDestination} from './types.js';
import {RecoveryMemory} from './recovery.js';
import {craftFailure} from './craft-feedback.js';
import {observedMovements} from './navigation.js';
import {SpatialMemory} from './spatial-memory.js';
import {botMemoryLocation} from './experience-memory.js';
import {join} from 'node:path';
import {executeEquip} from './equipment.js';
import {validatePickup,type PickupResult} from './pickup.js';
import {miningResult,inventoryGains} from './mining.js';
import {buildingMaterial,validateBuild,validateDig,sameCell,overlapsCell,supportsFeet} from './building.js';
import {randomUUID} from 'node:crypto';
import {IncomingDamage} from './incoming-damage.js';
import {CombatEvidenceStore} from './combat-evidence.js';
import { combat, hostileKinds, distance, type Enemy, type Encounter } from './combat.js';
import { PlaceMemory, sampleView, summarizePlaces, viewDirection, visibleBlockFace, VISION } from './vision.js';
import { RecipeBook } from "./recipe-book.js";
import { protocolOverrides } from "./protocol.js";
import mineflayer from 'mineflayer';
import pathfinderPackage from 'mineflayer-pathfinder';
import { setTimeout as delay } from 'node:timers/promises';
import type { Config } from './config.js';
import type { Action, Log, Snapshot, World, Plan } from './types.js';

const { pathfinder, goals } = pathfinderPackage;
function samePosition(a:{x:number;y:number;z:number},b:{x:number;y:number;z:number}){return a.x===b.x&&a.y===b.y&&a.z===b.z;}
export class MineflayerWorld implements World {
  private spatial?:SpatialMemory;
 readonly importantPlaces:ImportantPlaces;
  private lastAlivePossessions?:import('./recovery.js').AlivePossessions;
  private recovery:RecoveryMemory;private generation=0;private deathCount=0;private dead=false;
  private bot: mineflayer.Bot;
  private ready = false;
  private recipeBook = new RecipeBook();
  private memory = new PlaceMemory();
  private visible: import('./vision.js').SeenBlock[] = [];
  private observedAt = 0;
  private navigationHintMovements?:ReturnType<typeof observedMovements>;private navigationHintsAt=0;private navigationHints:import('./vision.js').Position[]=[];
  private navigationTargets(){
    if(!this.ready)return [];const now=Date.now();if(now-this.navigationHintsAt<2000)return structuredClone(this.navigationHints);this.navigationHintsAt=now;
    this.navigationHints=localNavigationTargets(this.bot.entity.position,this.memory.snapshot(),p=>{
      if(reachedCell(this.bot.entity.position,p,2))return false;
      try{
        this.navigationHintMovements??=observedMovements(this.bot,this.memory);
        // getPathTo mutates pathfinder's shared A* context. Queries must be isolated from active goto.
        const search=this.bot.pathfinder.getPathFromTo(this.navigationHintMovements,this.bot.entity.position,new goals.GoalNear(p.x,p.y,p.z,2),{timeout:40,tickTimeout:8,searchRadius:12,optimizePath:false});
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
  constructor(name: string, private c: Config, log: Log) {
    const location=botMemoryLocation('--live',name,c);this.importantPlaces=new ImportantPlaces(join(location.dir,'important-places.json'),location.profile);this.spatial=new SpatialMemory(join(location.dir,'spatial.json'),location.profile);this.recovery=new RecoveryMemory(join(location.dir,'recovery.json'));
    this.bot = mineflayer.createBot({ host: c.host, port: c.port, version: c.version,
      customPackets: protocolOverrides(c.version),
      username: name, auth: c.auth, respawn:true, profilesFolder: './runs/auth' });
    this.bot.loadPlugin(pathfinder);
    // The full declare_recipes catalog is intentionally never added to observations.
    this.bot._client.on('unlock_recipes', packet => this.recipeBook.apply(packet));
    this.bot.on('spawn', () => {
      this.generation++;this.dead=false;this.lastAlivePossessions=undefined;this.memory.clear();this.knownCacheAt=-1;this.knownCache=[];this.navigationHints=[];this.navigationHintsAt=0;this.visible=[];this.containers=[];this.combatEvidence.clear();this.incomingDamage.clear();
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
    this.bot.on('entityDead',entity=>{if(entity&&this.entityVisible(entity))this.combatEvidence.death(entity.id,Date.now());});
    this.bot.on('death', () => { const death=this.recovery.death(this.snapshot(),this.lastAlivePossessions);this.deathCount++;this.dead=true;this.ready=false;this.stop();log('death',{death}); });
    this.bot.on('end', () => { this.saveSpatial(true); this.ready = false; this.recipeBook.reset(); this.memory.clear();this.knownCacheAt=-1;this.knownCache=[];this.navigationHints=[];this.navigationHintsAt=0; this.containers=[]; this.visible=[]; this.combatEvidence.clear();this.incomingDamage.clear(); log('disconnected'); });
    this.bot.on('kicked', () => { this.ready = false; log('kicked'); });
    this.bot.on('error', () => log('connection_error')); // no raw credentials/packets
    this.bot.on('chat', (sender, message) => {
      if (sender === this.bot.username) return;
      this.chatEvents.push({id:randomUUID(),at:Date.now(),speaker:sender,text:message.slice(0,250)});this.chatEvents=this.chatEvents.slice(-32);
      this.messages.push(`${sender}: ${message.slice(0, 250)}`);
      this.messages = this.messages.slice(-6);
    });
  }
  private visibleItems(){return Object.values(this.bot.entities).filter(e=>e.name==='item'&&this.entityVisible(e)).flatMap(e=>{const i=e.getDroppedItem();return i?[{id:e.id,name:i.name,count:i.count,position:{x:e.position.x,y:e.position.y,z:e.position.z}}]:[];});}
  // Shared by standalone pickup and mine's bounded post-break collection.
  private async collectVisibleDrop(id:number,signal:AbortSignal){
    signal.throwIfAborted();const e=this.bot.entities[id];
    if(!e||e.name!=='item'||!this.entityVisible(e))throw Error('Dropped item no longer visible');
    if(this.enemies().length)throw Error('Visible danger prevents pickup');
    const p=e.position.clone?e.position.clone():e.position;
    await this.bot.lookAt(p.offset(0,.05,0),false);this.observe(true);signal.throwIfAborted();
    let abort=()=>{};let rejectDanger:(error:Error)=>void=()=>{};
    const interrupted=new Promise<never>((_,reject)=>{rejectDanger=reject;abort=()=>{this.stop();reject(signal.reason);};signal.addEventListener('abort',abort,{once:true});});
    const monitor=setInterval(()=>{if(this.enemies().length){this.stop();rejectDanger(new Error('Visible danger interrupted pickup'));}},50);
    try{await Promise.race([this.navigate(new goals.GoalNear(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z),0),signal),interrupted]);}
    finally{clearInterval(monitor);signal.removeEventListener('abort',abort);this.stop();}
  }
  private async pickupItem(signal:AbortSignal,plan?:Plan){
    const started=Date.now(),result:PickupResult={kind:'pickup',target:plan?.pickup??null,inventoryGained:[],status:'failed',elapsedMs:0,attribution:'inventory_delta_not_proof_of_target_origin'};
    const totals=()=>{const t:Record<string,number>={};for(const i of this.bot.inventory.items())t[i.name]=(t[i.name]??0)+i.count;return t;};
    const before=totals(),health=this.bot.health,damage=new AbortController();
    const onHealth=()=>{if(this.bot.health<health)damage.abort(new Error('Damaged during pickup'));};
    this.bot.on('health',onHealth);const active=AbortSignal.any([signal,damage.signal,AbortSignal.timeout(8000)]);
    try{
      validatePickup(plan?.pickup!);const request=plan!.pickup!;
      if(!this.visibleItems().some(i=>i.id===request.entityId&&i.name===request.expected))throw Error('Pickup target changed or not visible');
      await this.collectVisibleDrop(request.entityId,active);
      await delay(450,undefined,{signal:active});result.status='finished';
    }catch(error){result.status=active.aborted?'cancelled':'failed';result.detail=error instanceof Error?error.message.slice(0,180):'Pickup failed';}
    finally{this.stop();this.bot.removeListener('health',onHealth);result.inventoryGained=inventoryGains(before,totals());result.elapsedMs=Date.now()-started;}
    if(result.status==='finished'&&!result.inventoryGained.some(i=>i.name===result.target?.expected&&i.count>0)){result.status='failed';result.detail='No matching inventory gain observed; disappearance is not receipt';}
    return JSON.stringify(result);
  }
  private motor?:{phase:import('./types.js').MotorProgress['phase'];at:number;estimatedDigMs?:number;blockBroken:boolean};
  executionProgress():import('./types.js').MotorProgress|undefined{return this.motor?{phase:this.motor.phase,phaseElapsedMs:Math.max(0,Date.now()-this.motor.at),estimatedDigMs:this.motor.estimatedDigMs,blockBroken:this.motor.blockBroken}:undefined;}
  private async mineBlock(signal:AbortSignal,plan?:Plan){
    const result=miningResult(plan?.mine??null),started=Date.now();this.motor={phase:'approach',at:started,blockBroken:false};
    const totals=()=>{const out:Record<string,number>={};for(const i of this.bot.inventory.items())out[i.name]=(out[i.name]??0)+i.count;return out;};
    const before=totals(),initialIds=new Set(Object.keys(this.bot.entities));
    let digStarted:number|undefined;let digEnded:number|undefined;let target:ReturnType<mineflayer.Bot['blockAt']>;
    const damage=new AbortController(),initialHealth=this.bot.health;
    const onHealth=()=>{if(this.bot.health<initialHealth)damage.abort(new Error('Damaged during mining'));};
    this.bot.on('health',onHealth);
    const active=AbortSignal.any([signal,damage.signal]);
    const abort=()=>this.stop();active.addEventListener('abort',abort,{once:true});
    const scan=()=>{
      if(!plan?.mine)return [];
      const p=plan.mine.position;
      const drops=Object.values(this.bot.entities).filter(e=>e.name==='item'&&!initialIds.has(String(e.id))&&Math.hypot(e.position.x-p.x,e.position.y-p.y,e.position.z-p.z)<4&&this.entityVisible(e));
      for(const e of drops){const item=e.getDroppedItem();if(!result.drops.some(d=>d.id===e.id))result.drops.push({id:e.id,name:item?.name??null,count:item?.count??null,firstSeen:Date.now()});}
      result.dropObservation=result.drops.length?'observed_near_target':'none_observed';return drops;
    };
    const onDrop=()=>{scan();};
    try{
      validateDig(plan?.mine!);const request=plan!.mine!;
      if(!this.visible.some(b=>sameCell(b.position,request.position)&&b.name===request.expected))throw Error('Block target not currently observed');
      const cell=request.position,vec=this.bot.entity.position.scaled(0).offset(cell.x,cell.y,cell.z);
      target=this.bot.blockAt(vec);if(!target||target.name!==request.expected)throw Error('Block target changed');const stateId=target.stateId;
      if(!this.bot.canDigBlock(target))await this.navigate(new goals.GoalNear(cell.x,cell.y,cell.z,3),active);
      active.throwIfAborted();await this.bot.lookAt(vec.offset(.5,.5,.5),false);active.throwIfAborted();
      if(!this.blockInSight(target)){await this.navigate(new goals.GoalNear(cell.x,Math.floor(this.bot.entity.position.y),cell.z,1),active);active.throwIfAborted();await this.bot.lookAt(vec.offset(.5,.5,.5),false);active.throwIfAborted();}
      const fresh=()=>{const b=this.bot.blockAt(vec),feet=this.bot.entity.position;
        if(!b||b.stateId!==stateId)throw Error('Block target changed');
        if(!b.diggable)throw Error('Block is not diggable with current interaction');
        if(!this.bot.canDigBlock(b))throw Error('Block is outside current mining reach; reposition');
        if(!this.blockInSight(b))throw Error('Block is visible only partially; no clear mining face from current position. Reposition or choose another target');
        if(supportsFeet(cell,feet))throw Error('Block supports own feet');return b;};
      this.motor={phase:'prepare',at:Date.now(),blockBroken:false};target=fresh();const tool=request.toolSlot!==undefined?this.bot.inventory.items().find(i=>i.slot===request.toolSlot&&(!request.tool||i.name===request.tool)):request.tool?this.bot.inventory.items().find(i=>i.name===request.tool):this.bot.pathfinder.bestHarvestTool(target);
      if((request.tool||request.toolSlot!==undefined)&&!tool)throw Error('Requested mining tool not carried');
      const original=this.bot.clickWindow;
      this.bot.clickWindow=((...args:Parameters<typeof original>)=>{active.throwIfAborted();return original.apply(this.bot,args);}) as typeof original;
      try{if(tool)await this.bot.equip(tool,'hand');}finally{this.bot.clickWindow=original;}
      active.throwIfAborted();target=fresh();const held=this.bot.heldItem;
      result.tool=held?{name:held.name,enchants:structuredClone(held.enchants??[]),durabilityUsed:held.durabilityUsed}:null;
      this.bot.on('itemDrop',onDrop);digStarted=Date.now();const estimate=this.bot.digTime?.(target);this.motor={phase:'digging',at:digStarted,estimatedDigMs:Number.isFinite(estimate)?estimate:undefined,blockBroken:false};
      const clock=new AbortController(),timer=setTimeout(()=>clock.abort(new DOMException('Mining attempt budget exhausted','TimeoutError')),request.maxMs??30000),timeout=clock.signal,digSignal=AbortSignal.any([active,timeout]);
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
      const pickupSignal=AbortSignal.any([active,AbortSignal.timeout(2000)]);
      const stopPickup=()=>this.stop();pickupSignal.addEventListener('abort',stopPickup,{once:true});
      try{
        await delay(250,undefined,{signal:pickupSignal});
        const drops=scan();
        if(drops.length&&!this.enemies().length){
          await this.collectVisibleDrop(drops[0].id,pickupSignal);
          await delay(250,undefined,{signal:pickupSignal});scan();
        }
      }catch(error){result.pickup='interrupted';result.detail=error instanceof Error?error.message.slice(0,180):'Pickup interrupted';}finally{pickupSignal.removeEventListener('abort',stopPickup);this.stop();}
      await delay(200,undefined,{signal:active});scan();
      active.throwIfAborted();result.status='finished';
    }catch(error){result.status=active.aborted?'cancelled':result.status==='time_limit'?'time_limit':'failed';result.detail=error instanceof Error?error.message.slice(0,200):'Mining failed';}
    finally{
      this.bot.removeListener('itemDrop',onDrop);this.bot.removeListener('health',onHealth);active.removeEventListener('abort',abort);
      result.attemptMs=digStarted===undefined?0:(digEnded??Date.now())-digStarted;result.elapsedMs=Date.now()-started;
      result.inventoryGained=inventoryGains(before,totals());if(result.inventoryGained.length)result.pickup='inventory_gain_observed';this.motor=undefined;
    }
    return JSON.stringify(result);
  }

  private async buildAction(action:'place_block',signal:AbortSignal,plan?:Plan){
    validateBuild(plan?.build!);
    const cell=plan!.build!.reference;
    const observed=this.visible.find(b=>sameCell(b.position,cell));
    if(!observed)throw Error('Block target not currently observed');
    const vec=this.bot.entity.position.scaled(0).offset(cell.x,cell.y,cell.z);
    let block=this.bot.blockAt(vec);
    if(!block||block.name!==observed.name)throw Error('Block target changed');
    const stateId=block.stateId;
    if(vec.distanceTo(this.bot.entity.position)>3)await this.navigate(new goals.GoalNear(cell.x,cell.y,cell.z,3),signal);
    signal.throwIfAborted();await this.bot.lookAt(vec.offset(.5,.5,.5),false);signal.throwIfAborted();
    const fresh=()=>{const b=this.bot.blockAt(vec);if(!b||b.stateId!==stateId||vec.distanceTo(this.bot.entity.position)>4.5)throw Error('Block target changed or unreachable');return b;};
    block=fresh();
    const build=plan!.build!,target=vec.scaled(0).offset(build.position.x,build.position.y,build.position.z),face=target.minus(vec);
    const free=()=>{
      if(this.bot.blockAt(target)?.name!=='air')throw Error('Block placement target occupied');
      const entities=[this.bot.entity,...Object.values(this.bot.entities)];
      if(entities.some(e=>overlapsCell(build.position,e.position,e.width??.6,e.height??1.8)))throw Error('Block placement overlaps entity');
    };
    const item=this.bot.inventory.items().find(i=>i.name===build.item);
    if(!item||!this.bot.registry.blocksByName[build.item])throw Error('Block material unavailable');
    free();const before=this.itemCount(build.item);
    const original=this.bot.clickWindow;const sneaking=this.bot.getControlState('sneak');
    this.bot.clickWindow=((...args:Parameters<typeof original>)=>{signal.throwIfAborted();return original.apply(this.bot,args);}) as typeof original;
    try{
      await this.bot.equip(item,'hand');signal.throwIfAborted();block=fresh();free();
      const contact=vec.offset(.5+face.x*.5,.5+face.y*.5,.5+face.z*.5);
      await this.bot.lookAt(contact,false);signal.throwIfAborted();
      const eye=this.bot.entity.position.offset(0,1.62,0),delta=contact.minus(eye),length=delta.norm();
      if(length>4.5||length<.05||this.bot.world.raycast(eye,delta.scaled(1/length),length-.02))throw Error('Block placement face occluded');
      block=fresh();free();signal.throwIfAborted();this.bot.setControlState('sneak',true);
      await this.bot.placeBlock(block,face);signal.throwIfAborted();
      for(let i=0;i<20&&(this.bot.blockAt(target)?.name!==build.item||this.itemCount(build.item)!==before-1);i++)await delay(50,undefined,{signal});
      if(this.bot.blockAt(target)?.name!==build.item||this.itemCount(build.item)!==before-1)throw Error('Block placement not confirmed');
      this.memory.observe([{name:build.item,position:{...build.position},lastSeen:Date.now()}]);this.observe(true);
      return `Placed ${build.item} at ${target.x},${target.y},${target.z}`;
    }finally{this.bot.clickWindow=original;this.bot.setControlState('sneak',signal.aborted?false:sneaking);}
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
    const point=visibleBlockFace(eye,this.bot.entity.yaw,this.bot.entity.pitch,block.position,(d,length)=>(this.bot.world.raycast(eye,eye.scaled(0).offset(d.x,d.y,d.z),length) as any)?.position??null);
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
    });
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
      const item=action==='deposit'?this.bot.inventory.items().find(i=>i.name===r.item):window.slots[slot];
      if(!item||item.name!==r.item||(action==='deposit'?this.itemCount(r.item):item.count)<r.count)throw Error('Insufficient furnace transfer stock');
      signal.throwIfAborted();
      if(action==='deposit'){if(r.slot==='input')await window.putInput(item.type,item.metadata,r.count);else await window.putFuel(item.type,item.metadata,r.count);}
      else await this.bot.transfer({window,itemType:item.type,metadata:item.metadata,count:r.count,sourceStart:slot,sourceEnd:slot+1,destStart:window.inventoryStart,destEnd:window.inventoryEnd});
      signal.throwIfAborted();remember();window.close();window=undefined;
      const expected=action==='deposit'?-r.count:r.count;
      for(let i=0;i<20&&this.itemCount(r.item)-before!==expected;i++)await delay(50,undefined,{signal});
      if(this.itemCount(r.item)-before!==expected)throw Error('Furnace transfer not confirmed');
      return JSON.stringify({kind:'furnace_transfer',action,item:r.item,count:r.count,slot:r.slot,inventoryDelta:expected,processingComplete:false});
    }finally{if(window){remember();window.close();}}
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
        if(Date.now()-(this.recentDrops.get(dropKey)??0)<30000)throw Error('Transfer receipt pending; do not repeat drop');
        let target=this.bot.players[request.recipient]?.entity;
        if(!target||!this.entityVisible(target))throw Error('Player not visible');
        const before=this.itemCount(request.item);if(before<request.count)throw Error('Insufficient carried items');
        if(target.position.distanceTo(this.bot.entity.position)>2)await this.navigate(new goals.GoalNear(target.position.x,target.position.y,target.position.z,2),signal);
        signal.throwIfAborted();target=this.bot.players[request.recipient]?.entity;
        if(!target||!this.entityVisible(target)||target.position.distanceTo(this.bot.entity.position)>3)throw Error('Player moved out of reach');
        await this.bot.lookAt(target.position.offset(0,1,0),false);signal.throwIfAborted();
        const item=this.bot.inventory.items().find(i=>i.name===request.item);if(!item||this.itemCount(request.item)<request.count)throw Error('Insufficient carried items');
        signal.throwIfAborted();this.recentDrops.set(dropKey,Date.now());
        await this.bot.toss(item.type,item.metadata,request.count);signal.throwIfAborted();
        const removed=before-this.itemCount(request.item);
        if(removed!==request.count)throw Error('Transfer drop not confirmed');
        return JSON.stringify({outcome:'dropped_receipt_unconfirmed',recipient:request.recipient,item:request.item,count:removed,receiptConfirmed:false});
      }
      const p=plan?.container;if(!p)throw Error('Missing container');
      if(!this.visible.some(b=>['chest','furnace','blast_furnace','smoker'].includes(b.name)&&samePosition(b.position,p)))throw Error('No visible requested container');
      const vec=this.bot.entity.position.scaled(0).offset(p.x,p.y,p.z);
      await this.navigate(new goals.GoalNear(p.x,p.y,p.z,2),signal);signal.throwIfAborted();
      await this.bot.lookAt(vec.offset(.5,.5,.5),false);signal.throwIfAborted();
      const chest=this.bot.blockAt(vec);if(!chest||!['chest','furnace','blast_furnace','smoker'].includes(chest.name)||!this.blockInSight(chest))throw Error('No visible requested container');
      if(chest.name!=='chest')return await this.furnaceInteraction(chest,action,signal,plan!);
      if(plan?.transfer?.slot)throw Error('Invalid transfer slot for chest');
      window=await this.bot.openChest(chest);signal.throwIfAborted();this.rememberChest(window,p);
      if(action==='inspect_container')return JSON.stringify({outcome:'chest_observed',...this.containers.at(-1)});
      const request=plan?.transfer;if(!request||!Number.isInteger(request.count)||request.count<1||request.count>64)throw Error('Invalid transfer');
      const depositing=action==='deposit';
      const stock=depositing?this.bot.inventory.items():window.containerItems();
      const item=stock.find(i=>i.name===request.item);
      if(!item||stock.filter(i=>i.name===request.item&&i.metadata===item.metadata).reduce((n,i)=>n+i.count,0)<request.count)throw Error(depositing?'Insufficient carried items':'Insufficient items in chest');
      const before=this.itemCount(request.item),chestBefore=window.containerItems().filter(i=>i.name===request.item).reduce((n,i)=>n+i.count,0);
      signal.throwIfAborted();
      if(depositing)await window.deposit(item.type,item.metadata,request.count);else await window.withdraw(item.type,item.metadata,request.count);
      signal.throwIfAborted();
      const direction=depositing?1:-1;
      for(let i=0;i<20&&window.containerItems().filter(i=>i.name===request.item).reduce((n,i)=>n+i.count,0)-chestBefore!==direction*request.count;i++)await delay(50,undefined,{signal});
      const chestAfter=window.containerItems().filter(i=>i.name===request.item).reduce((n,i)=>n+i.count,0);
      this.rememberChest(window,p);window.close();window=undefined;
      for(let i=0;i<20&&before-this.itemCount(request.item)!==direction*request.count;i++)await delay(50,undefined,{signal});
      if(before-this.itemCount(request.item)!==direction*request.count||chestAfter-chestBefore!==direction*request.count)throw Error(depositing?'Deposit not confirmed':'Withdrawal not confirmed');
      return `${depositing?'Deposited':'Withdrew'} ${request.count} ${request.item}`;
    }finally{if(window){this.rememberChest(window,plan?.container);window.close();}this.bot.clickWindow=original;}
  }

  private logs() { return this.bot.inventory.items().filter(i => /(_log|_stem)$/.test(i.name)); }
  private count() { return this.logs().reduce((n, i) => n + i.count, 0); }
  private observe(force = false) {
    if (!this.ready || !this.bot.entity) return;
    const dimension = String(this.bot.game.dimension);
    if (dimension !== this.observationDimension) { this.saveSpatial(true);this.memory.clear();this.knownCacheAt=-1;this.knownCache=[];this.navigationHints=[];this.navigationHintsAt=0; this.containers=this.spatial?.get(dimension).containers??[]; this.observationDimension = dimension; }
    if (!force && Date.now()-this.observedAt<500) return;
    this.observedAt=Date.now();
    const e=this.bot.entity, eye=e.position.offset(0, (e as typeof e & {eyeHeight?:number}).eyeHeight ?? 1.62, 0);
    this.visible=sampleView(e.yaw,e.pitch,d => {
      const hit=this.bot.world.raycast(eye,eye.scaled(0).offset(d.x,d.y,d.z),VISION.range) as unknown as {name:string;position:typeof eye} | null;
      return hit ? {name:hit.name,position:hit.position} : null;
    },this.observedAt);
    this.memory.observe(this.visible);
    this.containers=this.containers.filter(c=>!this.visible.some(b=>samePosition(b.position,c.position)&&!['chest','furnace','blast_furnace','smoker'].includes(b.name)));
    this.saveSpatial();
  }
  private saveSpatial(force=false){if(!this.spatial||!this.observationDimension)return;this.spatial.update(this.observationDimension,this.memory.snapshot(),this.containers);this.spatial.flush(force);}
  private knownCacheAt=-1;private knownCacheDimension='';private knownCache:import('./vision.js').SeenBlock[]=[];
  private knownPlaces(){
    if(!this.knownCache||this.knownCacheAt!==this.observedAt||this.knownCacheDimension!==this.observationDimension){const m=new PlaceMemory();m.observe(this.spatial?.get(this.observationDimension).places??[]);m.observe(this.memory.snapshot());this.knownCache=m.snapshot();this.knownCacheAt=this.observedAt;this.knownCacheDimension=this.observationDimension;}
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
    if(!distance || distance>VISION.range)return false;
    const d=offset.scaled(1/distance), f=viewDirection(this.bot.entity.yaw,this.bot.entity.pitch);
    if(d.x*f.x+d.y*f.y+d.z*f.z<Math.cos(Math.PI/6))return false;
    return !this.bot.world.raycast(eye,d,Math.max(0,distance-.1));
  }
  private async navigate(goal: InstanceType<typeof goals.GoalNear>,signal?:AbortSignal) {
    // Traverse only observed supports, then look again from the reached frontier.
    // Do not pass an incomplete/no-path search to goto: upstream can reject its
    // Promise while continuing to walk a partial path.
    try{
      for(let leg=0;leg<8;leg++){
        signal?.throwIfAborted();
        const feet=this.bot.entity.position.floored();
        if(goal.isEnd(feet as any))return;
        const p=this.bot.entity.position,yaw=Math.atan2(-(goal.x+.5-p.x),-(goal.z+.5-p.z));
        await this.bot.look(yaw,-Math.PI/4,false);signal?.throwIfAborted();this.observe(true);
        let path=this.bot.pathfinder.getPathTo(this.bot.pathfinder.movements,goal,200);
        let end=path.path.at(-1);
        if(!end||end.x===feet.x&&end.y===feet.y&&end.z===feet.z){
          // A detour may begin beside/behind us. Turn the actual camera before
          // admitting those footholds; never query unseen supports as knowledge.
          for(const turn of [Math.PI/2,Math.PI,-Math.PI/2]){
            await this.bot.look(yaw+turn,-Math.PI/4,false);signal?.throwIfAborted();this.observe(true);
          }
          path=this.bot.pathfinder.getPathTo(this.bot.pathfinder.movements,goal,200);end=path.path.at(-1);
        }
        if(!end||end.x===feet.x&&end.y===feet.y&&end.z===feet.z)throw Error('Destination not reached: no observed route after local scan');
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
  private equipment() {
    const slots: [string,number][]=[['head',5],['chest',6],['legs',7],['feet',8],['offhand',45]];
    const result=slots.flatMap(([slot,n])=>{const i=this.bot.inventory.slots[n];return i?[{slot,name:i.name,durabilityUsed:i.durabilityUsed}]:[];});
    const held=this.bot.heldItem;
    if(held)result.push({slot:'hand',name:held.name,durabilityUsed:held.durabilityUsed});
    return result;
  }
  private async fight(action:'attack'|'flee',signal:AbortSignal) {
    const before=this.bot.health;
    const kind=this.enemies()[0]?.kind ?? 'unknown';
    let result:Encounter | undefined;
    let lastApproach: {x:number;y:number;z:number;at:number}|undefined;
    try {
      result=await combat({
        observe:()=>({health:this.bot.health,position:this.bot.entity.position,enemies:this.enemies()}),
        faceLastSeen:async(p,s)=>{
          s.throwIfAborted();await this.bot.lookAt(this.bot.entity.position.scaled(0).offset(p.x,p.y+1,p.z),false);s.throwIfAborted();
        },
        targetEvidence:id=>this.combatEvidence.get(id),
        equipWeapon:async()=>{
          const items=this.bot.inventory.items();
          const weapon=items.find(i=>i.name.endsWith('_sword')) ?? items.find(i=>i.name.endsWith('_axe'));
          if(weapon)await this.bot.equip(weapon,'hand');
        },
        // Conservative local timing by OWN tool class, not opponent strength.
        cooldownMs:()=>this.bot.heldItem?.name.endsWith('_sword')?700:this.bot.heldItem?.name.endsWith('_axe')?1250:2000,
        approach:e=>{
          const now=Date.now();
          if(lastApproach&&distance(lastApproach,e.position)<.6&&now-lastApproach.at<500)return;
          lastApproach={...e.position,at:now};
          this.bot.pathfinder.setGoal(new goals.GoalNear(e.position.x,e.position.y,e.position.z,2));
        },
        strike:async id=>{
          const e=this.bot.entities[id];
          if(!e || !hostileKinds.has(e.name ?? '') || !this.entityVisible(e) || e.position.distanceTo(this.bot.entity.position)>2.8)return false;
          await this.bot.lookAt(e.position.offset(0,e.height/2,0),false);
          signal.throwIfAborted();
          if(!this.entityVisible(e) || e.position.distanceTo(this.bot.entity.position)>2.8)return false;
          this.bot.attack(e);return true;
        },
        retreat:from=>{
          const here=this.bot.entity.position;
          const options=this.memory.snapshot().filter(b=>b.position.y===Math.floor(here.y)-1 && distance(b.position,here)<=8)
            .map(b=>({x:b.position.x+.5,y:b.position.y+1,z:b.position.z+.5}))
            .filter(p=>distance(p,from)>distance(here,from)+2).sort((a,b)=>distance(b,from)-distance(a,from));
          if(!options.length)return false;
          const p=options[0];this.bot.pathfinder.setGoal(new goals.GoalNear(p.x,p.y,p.z,1));return true;
        },
        stop:()=>{lastApproach=undefined;this.stop();},wait:(ms,s)=>delay(ms,undefined,{signal:s}),now:()=>Date.now(),
      },action,signal);
      return JSON.stringify(result);
    } finally {
      this.encounters.push(result ?? {kind,action,startedAt:Date.now(),healthBefore:before,healthAfter:this.bot.health,attacksSent:null,outcome:signal.aborted?'cancelled_partial_actions_unknown':'failed_partial_actions_unknown'});
      this.encounters=this.encounters.slice(-12);
    }
  }
  snapshot(): Snapshot {
    this.observe();
    const position = this.bot.entity?.position ?? { x: 0, y: 0, z: 0 };
    const logs = this.ready ? this.count() : 0;
    const table=this.ready ? this.table() : null;
    const craftable=this.ready ? [...new Set(this.recipeBook.snapshot().unlocked.map(id=>id.replace(/^minecraft:/,'')).filter(name=>{
      const item=this.bot.registry.itemsByName[name];
      return item && this.bot.recipesFor(item.id,null,1,table).length>0;
    }))] : [];
    const knownPlaces=this.knownPlaces();
    const snapshot:Snapshot={ observedDestinationKeys:knownPlaces.map(b=>[b.position.x,b.position.y,b.position.z].join(',')),navigationTargets:this.navigationTargets(),visibleItems:this.ready?this.visibleItems():[],placeableItems:this.ready?[...new Set(this.bot.inventory.items().filter(i=>buildingMaterial(i.name)&&this.bot.registry.blocksByName[i.name]).map(i=>i.name))]:[],containers:structuredClone(this.containers),canPlaceTable:this.ready&&this.itemCount('crafting_table')>0&&!!this.placementSupport(),nearbyPlayers:this.ready?Object.values(this.bot.entities).filter(e=>e.type==='player'&&e.username&&e.username!==this.bot.username&&this.entityVisible(e)).map(e=>({name:e.username!,position:{x:e.position.x,y:e.position.y,z:e.position.z}})):[],incomingDamage:this.incomingDamage.snapshot(Date.now()),combatEvents:this.combatEvidence.snapshot(),enemies:this.enemies(),equipment:this.ready?this.equipment():[],encounters:structuredClone(this.encounters), inventory: this.ready ? this.bot.inventory.slots.flatMap((i,slot)=>i && slot>=5 ? [{name:i.name,count:i.count,slot,enchants:structuredClone(i.enchants??[]),durabilityUsed:i.durabilityUsed}] : []) : [],
      vision: {yaw:this.bot.entity?.yaw ?? 0,pitch:this.bot.entity?.pitch ?? 0,blocks:summarizePlaces(structuredClone(this.visible))}, places:summarizePlaces(knownPlaces),craftable,
      dimension:String(this.bot.game?.dimension??'unknown'),environment:{inWater:!!(this.bot.entity as any)?.isInWater,inLava:!!(this.bot.entity as any)?.isInLava,onGround:!!this.bot.entity?.onGround,oxygen:(this.bot as any).oxygenLevel},lifecycle:{generation:this.generation,deathCount:this.deathCount,phase:this.dead?'dead':this.ready?'alive':'connecting',lastDeath:this.recovery.context().deaths.at(-1)},recovery:this.recovery.context(),
      ready: this.ready, health: this.bot.health ?? 0, food: this.bot.food ?? 0, logs,
      canMine: this.ready && this.visible.some(b=>!['bedrock','water','lava','air'].includes(b.name)), canDeposit: this.ready && this.bot.inventory.items().length>0 && this.visible.some(b=>['chest','furnace','blast_furnace','smoker'].includes(b.name)),
      foodAvailable: this.ready && !!this.food(),
      canEat: this.ready && (this.bot.food ?? 20) < 20 && !!this.food(),
      canFollow: this.ready && !!this.bot.players[this.c.follow]?.entity && this.entityVisible(this.bot.players[this.c.follow].entity!),
      position: { x: position.x, y: position.y, z: position.z }, chatEvents:structuredClone(this.chatEvents),messages: [...this.messages], recipeBook: this.recipeBook.snapshot() };
    if(snapshot.ready&&snapshot.health>0&&!this.dead)this.lastAlivePossessions={at:Date.now(),inventory:structuredClone(snapshot.inventory),equipment:structuredClone(snapshot.equipment)};
    return snapshot;
  }
  async execute(action: Action, signal: AbortSignal, plan?: Plan) {
    signal.throwIfAborted();
    const cancel = () => this.stop(); signal.addEventListener('abort', cancel, { once: true });
    let window: Awaited<ReturnType<mineflayer.Bot['openChest']>> | undefined;
    try {
      this.observe(true);
      if(action==='equip')return await executeEquip(this.bot,plan?.equip!,signal);
      if(action==='pickup')return await this.pickupItem(signal,plan);
      if(action==='mine')return await this.mineBlock(signal,plan);
      if(action==='place_block')return await this.buildAction(action,signal,plan);
      if(['place_table','inspect_container','withdraw','deposit','give'].includes(action))return await this.interact(action,signal,plan);
      if(action==='attack'||action==='flee')return await this.fight(action,signal);
      if (action === 'look') {
        await this.bot.look(plan?.look?.yaw ?? this.bot.entity.yaw+Math.PI/2, plan?.look?.pitch ?? (Math.abs(this.bot.entity.pitch)<.2?-Math.PI/4:0), false);
        this.observe(true);
      }
      if (action === 'move') {
        const p=plan?.destination;
        if (!p || !knownDestination({places:this.knownPlaces(),dimension:String(this.bot?.game?.dimension??''),recovery:this.recovery?.context()},p)) throw new Error('Destination not observed');
        await this.navigate(new goals.GoalNear(p.x,p.y,p.z,2),signal);
        this.observe(true);
      }
      if (action === 'craft') {
        const request=plan?.craft;
        if(!request || !Number.isInteger(request.count) || request.count<1 || request.count>16) throw new Error('Invalid crafting request');
        const item=this.bot.registry.itemsByName[request.item];
        if(!item) throw new Error('Unknown item');
        const inventoryRecipe=this.bot.recipesFor(item.id,null,1,null)[0];
        let table=inventoryRecipe ? null : this.table();
        if(!inventoryRecipe&&!table){
          // Reorient toward a previously observed nearby workstation; memory is not visibility.
          const remembered=this.knownPlaces().filter(b=>b.name==='crafting_table').sort((a,b)=>Math.hypot(a.position.x-this.bot.entity.position.x,a.position.y-this.bot.entity.position.y,a.position.z-this.bot.entity.position.z)-Math.hypot(b.position.x-this.bot.entity.position.x,b.position.y-this.bot.entity.position.y,b.position.z-this.bot.entity.position.z))[0];
          if(remembered&&Math.hypot(remembered.position.x-this.bot.entity.position.x,remembered.position.y-this.bot.entity.position.y,remembered.position.z-this.bot.entity.position.z)<=6){
            signal.throwIfAborted();await this.bot.lookAt(this.bot.entity.position.scaled(0).offset(remembered.position.x+.5,remembered.position.y+.5,remembered.position.z+.5),false);signal.throwIfAborted();this.observe(true);table=this.table();
          }
        }
        if(table) {
          await this.navigate(new goals.GoalNear(table.position.x,table.position.y,table.position.z,2),signal);
          signal.throwIfAborted(); await this.bot.lookAt(table.position.offset(.5,.5,.5),false);signal.throwIfAborted();this.observe(true);
          const observed=this.bot.blockAt(table.position);
          table=observed?.name==='crafting_table'&&this.blockInSight(observed)?observed:null;
        }
        const recipe=inventoryRecipe ?? this.bot.recipesFor(item.id,null,1,table)[0];
        if(!recipe) throw new Error(craftFailure(this.bot,request,this.recipeBook.snapshot().unlocked,table));
        const before=this.bot.inventory.items().filter(i=>i.type===item.id).reduce((n,i)=>n+i.count,0);
        signal.throwIfAborted(); if(recipe.delta.some(d=>this.bot.inventory.count(d.id,d.metadata)+d.count*request.count<0)) throw new Error(craftFailure(this.bot,request,this.recipeBook.snapshot().unlocked,table));
        // Mineflayer has no craft AbortSignal: guard every inventory click and
        // finish one recipe at a time so cancellation cannot start another batch.
        const originalClick=this.bot.clickWindow;
        this.bot.clickWindow=((...args: Parameters<typeof originalClick>)=>{
          signal.throwIfAborted(); return originalClick.apply(this.bot,args);
        }) as typeof originalClick;
        try { for(let i=0;i<request.count;i++){signal.throwIfAborted();await this.bot.craft(recipe,1,table ?? undefined);} }
        finally { this.bot.clickWindow=originalClick; }
        signal.throwIfAborted();
        const after=this.bot.inventory.items().filter(i=>i.type===item.id).reduce((n,i)=>n+i.count,0);
        if(after-before<recipe.result.count*request.count) throw new Error('Crafting not confirmed');
        return `Crafted ${after-before} ${request.item}`;
      }
      if (action === 'idle') await delay(300, undefined, { signal });
      if (action === 'follow') {
        const target = this.bot.players[this.c.follow]?.entity;
        if (!target || !this.entityVisible(target)) throw new Error('Player not visible');
        await this.navigate(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2),signal);
      }
      if (action === 'eat') {
        const item = this.food(); if (!item) throw new Error('No food');
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
