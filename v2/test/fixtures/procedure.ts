import {setTimeout as delay} from 'node:timers/promises';
import type {Action,Brain,Plan,Snapshot,World} from '../../src/types.js';
import {carried,recipeKey,type RecipeFact} from '../../src/procedure.js';
import type {SupervisorInput,Supervision} from '../../src/supervision.js';
export const recipe:RecipeFact={key:'',item:'oak_planks',output:4,requiresTable:false,ingredients:[{item:'oak_log',count:1}]};
recipe.key=recipeKey(recipe);
export const woodPlan:Plan={goal:'Prepare eight boards',preferred:'look',intent:{description:'Acquire boards from visible wood',desiredInventory:[{item:'oak_planks',count:8}],constraints:['next: collect the missing logs and craft boards','done: carry at least eight oak planks','blocked: review missing drops or inaccessible wood']},procedure:{version:1,maxActions:12,maxMs:10000,steps:[
 {id:'logs',action:'mine',item:'oak_log',area:{center:{x:2,y:64,z:0},radius:4},materialsFor:'boards'},
 {id:'boards',action:'craft',item:'oak_planks',targetCount:8,recipeInputs:['oak_log']}
]}};
export class ProcedureWorld implements World {
 state:Snapshot={ready:true,health:20,food:20,logs:0,canMine:true,canDeposit:false,canEat:false,canFollow:false,position:{x:0,y:64,z:0},messages:[],recipeBook:{initialized:true,unlocked:['minecraft:oak_planks']},inventory:[],vision:{yaw:0,pitch:0,blocks:[1,2,3].map(x=>({name:'oak_log',position:{x,y:64,z:0},lastSeen:Date.now()}))}};
 starts:{action:Action;plan:Plan}[]=[];active=0;maxActive=0;waitMs=20;noDrop=false;dropOnly=false;lateGainOnAbort=false;
 snapshot(){return structuredClone(this.state);}
 recipes(item:string){return item==='oak_planks'?[structuredClone(recipe)]:[];}
 set(item:string,count:number){
  const inv=this.state.inventory??=[];const existing=inv.find(i=>i.name===item);
  if(existing)existing.count=count;else if(count>0)inv.push({name:item,count,slot:9+inv.length});
  this.state.inventory=inv.filter(i=>i.count>0);this.state.logs=carried(this.state,'oak_log');
 }
 async execute(action:Action,signal:AbortSignal,plan?:Plan){
  this.starts.push({action,plan:structuredClone(plan!)});this.active++;this.maxActive=Math.max(this.maxActive,this.active);
  try{
   try{await delay(this.waitMs,undefined,{signal});}catch(e){if(this.lateGainOnAbort)this.set('oak_log',carried(this.state,'oak_log')+1);throw e;}
   if(action==='mine'){
    this.state.vision!.blocks=this.state.vision!.blocks.filter(b=>b.position.x!==plan!.mine!.position.x);
    if(this.dropOnly)this.state.visibleItems=[{id:100+this.starts.length,name:'oak_log',count:1,position:plan!.mine!.position}];
    else if(!this.noDrop)this.set('oak_log',carried(this.state,'oak_log')+1);
    return JSON.stringify({kind:'mining',status:'finished',target:plan!.mine,blockBroken:true,drops:[],inventoryGained:this.noDrop||this.dropOnly?[]:[{name:'oak_log',count:1}]});
   }
   if(action==='pickup'){this.set('oak_log',carried(this.state,'oak_log')+1);this.state.visibleItems=[];return JSON.stringify({kind:'pickup',status:'finished',target:plan!.pickup,inventoryGained:[{name:'oak_log',count:1}]});}
   if(action==='craft'){
    if(plan!.craft!.recipeKey!==recipe.key)throw Error('Invalid crafting variant');
    const n=plan!.craft!.count;if(carried(this.state,'oak_log')<n)throw Error('Insufficient materials');
    this.set('oak_log',carried(this.state,'oak_log')-n);this.set('oak_planks',carried(this.state,'oak_planks')+4*n);return `Crafted ${4*n} oak_planks`;
   }
   if(action==='eat'){this.state.food=20;return 'Ate bread';}
   return 'Completed action';
  }finally{this.active--;}
 }
 stop(){} chat(_text:string){} close(){}
}
export function scriptedBrain(select?:(s:Snapshot,i:SupervisorInput)=>Promise<Supervision>):Brain{
 return {parameterSelection:true,choose:async()=>({action:'idle',confidence:1}),
  reviewGoals:async(_s,c)=>({goalUpdates:[{id:'mock-boards',description:'Prepare boards',reason:'Scripted offline fixture, not autonomous model output',status:'active',successCriteria:'Eight boards in inventory',evidenceIds:[c.goalReview!.observationId]}],activeGoalId:'mock-boards'}),
  plan:async()=>structuredClone(woodPlan),
  supervise:select??(async(_s,i)=>({choice:i.procedure?.status==='running'?'continue':i.procedureAvailable&&!i.procedure?'procedure':'unresolved',confidence:.7,review:'none',routes:{}}))};
}
export async function until(check:()=>boolean,tick:()=>Promise<void>,max=100){
 for(let i=0;i<max&&!check();i++){await tick();await delay(5);}
 if(!check())throw Error('Mock condition not reached within bounded ticks');
}
