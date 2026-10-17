import {validateEquip} from './equipment.js';
import { setTimeout as delay } from 'node:timers/promises';
import type { Action, Plan, Snapshot, World } from './types.js';

export class MockWorld implements World {
  state: Snapshot = { ready: true, health: 20, food: 20, logs: 0, canMine: true,
    canDeposit: false, canEat: true, canFollow: false, vision:{yaw:0,pitch:0,blocks:[{name:'oak_log',position:{x:1,y:64,z:0},lastSeen:0},{name:'chest',position:{x:3,y:64,z:0},lastSeen:0}]},position: { x: 0, y: 64, z: 0 }, messages: [], recipeBook: { initialized: true, unlocked: [] } };
  stored = 0;
  constructor(private shared: { logs: number } = { logs: 0 }) {}
  snapshot() { return structuredClone({ ...this.state, canDeposit: this.state.logs > 0 }); }
  async execute(action: Action, signal: AbortSignal, plan?: Plan) {
    await delay(80, undefined, { signal });
    if(action==='equip'){
      const e=plan?.equip!;validateEquip(e);const inv=this.state.inventory??=[];
      const dest={hand:36,'off-hand':45,head:5,torso:6,legs:7,feet:8}[e.destination],old=inv.find(i=>i.slot===dest);
      if(e.item===null){if(old){const empty=Array.from({length:36},(_,i)=>i+9).find(n=>!inv.some(i=>i.slot===n));if(empty===undefined)throw Error('Equipment removal needs free inventory slot');old.slot=empty;}}
      else {const source=inv.find(i=>i.name===e.item&&(e.sourceSlot===undefined||i.slot===e.sourceSlot));if(!source)throw Error('Equipment item not carried');const slot=source.slot;if(old&&old!==source)old.slot=slot;source.slot=dest;}
      this.state.equipment=inv.filter(i=>[5,6,7,8,36,45].includes(i.slot)).map(i=>({slot:({5:'head',6:'chest',7:'legs',8:'feet',36:'hand',45:'offhand'} as Record<number,string>)[i.slot],name:i.name,durabilityUsed:i.durabilityUsed}));
      return 'MOCK equipment verified';
    }
    if(action==='pickup'){const target=plan?.pickup,item=this.state.visibleItems?.find(i=>i.id===target?.entityId&&i.name===target.expected);if(item){const inv=this.state.inventory??=[];const stack=inv.find(i=>i.name===item.name);if(stack)stack.count+=item.count;else inv.push({name:item.name,count:item.count,slot:9});this.state.visibleItems=this.state.visibleItems?.filter(i=>i.id!==item.id);}return JSON.stringify({kind:'pickup',target:target??null,status:item?'finished':'failed',inventoryGained:item?[{name:item.name,count:item.count}]:[],elapsedMs:80,attribution:'inventory_delta_not_proof_of_target_origin',mock:true});}
    if (action === 'mine') { this.state.logs++; this.state.inventory=[{name:'oak_log',count:this.state.logs,slot:9}];this.state.food = Math.max(0, this.state.food - 1);return JSON.stringify({kind:'mining',blockBroken:true,status:'finished',drops:[],inventoryGained:[{name:'oak_log',count:1}],pickup:'inventory_gain_observed',mock:true}); }
    if (action === 'deposit') { const t=plan?.transfer;if(!t)throw Error('Missing transfer');const inv=this.state.inventory??[],item=inv.find(i=>i.name===t.item);if(!item||item.count<t.count)throw Error('Insufficient carried items');item.count-=t.count;this.stored+=t.count;if(t.item==='oak_log'){this.shared.logs+=t.count;this.state.logs-=t.count;} }
    if (action === 'eat') this.state.food = 20;
    return `MOCK ${action}: carried=${this.state.logs}, shared_chest=${this.shared.logs}`;
  }
  stop() {}
  chat(text: string) { this.state.messages.push(text); this.state.messages = this.state.messages.slice(-6); }
  close() { this.state.ready = false; }
}
