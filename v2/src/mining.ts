import type {DigRequest} from './building.js';
export type MiningResult={kind:'mining';target:DigRequest|null;blockBroken:boolean;tool:{name:string;enchants:{name:string;lvl:number}[];durabilityUsed?:number}|null;drops:{id:number;name:string|null;count:number|null;firstSeen:number}[];dropObservation:'observed_near_target'|'none_observed'|'not_checked';inventoryGained:{name:string;count:number}[];pickup:'inventory_gain_observed'|'no_inventory_gain'|'not_attempted'|'interrupted';estimatedDigMs?:number;digBudgetMs?:number;estimateCapped?:boolean;attemptMs?:number;elapsedMs?:number;status:'finished'|'failed'|'cancelled'|'time_limit';detail?:string;attribution:'nearby_drops_and_inventory_delta_not_proof_of_origin'};
export function miningResult(target:DigRequest|null):MiningResult{return {kind:'mining',target,blockBroken:false,tool:null,drops:[],dropObservation:'not_checked',inventoryGained:[],pickup:'not_attempted',status:'failed',attribution:'nearby_drops_and_inventory_delta_not_proof_of_origin'};}
export function inventoryGains(before:Record<string,number>,after:Record<string,number>){return Object.entries(after).filter(([name,count])=>count>(before[name]??0)).map(([name,count])=>({name,count:count-(before[name]??0)}));}
export function readMiningResult(text:string):MiningResult|undefined {try{const r=JSON.parse(text);return r.kind==='mining'&&typeof r.blockBroken==='boolean'&&Array.isArray(r.inventoryGained)&&Array.isArray(r.drops)?r:undefined;}catch{return undefined;}}

// This is an execution watchdog, not a strategic choice or proof of mineability.
export const MAX_DIG_BUDGET_MS=600000;
export function miningTiming(estimate:unknown){
 const estimatedDigMs=typeof estimate==='number'&&Number.isFinite(estimate)&&estimate>=0?estimate:undefined;
 const requested=estimatedDigMs===undefined?30000:Math.max(3000,Math.ceil(estimatedDigMs*1.5+2000));
 return {estimatedDigMs,digBudgetMs:Math.min(MAX_DIG_BUDGET_MS,requested),estimateCapped:requested>MAX_DIG_BUDGET_MS};
}
