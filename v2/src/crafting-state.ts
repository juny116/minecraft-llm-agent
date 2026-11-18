import type {Snapshot} from './types.js';
import type {RecipeFact} from './procedure.js';

type IngredientGroup={count:number;items:string[]};
type Variant={output:number;requiresTable:boolean;ingredients:IngredientGroup[]};
// Merge only rectangles differing in one ingredient axis. Never invent mixed or
// correlated recipes by independently unioning all ingredient alternatives.
function variants(facts:RecipeFact[]):Variant[]{
 const groups:Variant[]=[];
 for(const f of facts){
  const v={output:f.output,requiresTable:f.requiresTable,ingredients:f.ingredients.map(i=>({count:i.count,items:[i.item]})).sort((a,b)=>a.count-b.count||a.items[0].localeCompare(b.items[0]))};
  if(!groups.some(g=>JSON.stringify(g)===JSON.stringify(v)))groups.push(v);
 }
 let changed=true;
 while(changed){changed=false;
  outer:for(let a=0;a<groups.length;a++)for(let b=a+1;b<groups.length;b++){
   const x=groups[a],y=groups[b];if(x.output!==y.output||x.requiresTable!==y.requiresTable||x.ingredients.length!==y.ingredients.length)continue;
   const unmatched=x.ingredients.map((g,i)=>({g,i})).filter(({g})=>!y.ingredients.some(h=>JSON.stringify(g)===JSON.stringify(h)));
   const other=y.ingredients.filter(h=>!x.ingredients.some(g=>JSON.stringify(g)===JSON.stringify(h)));
   if(unmatched.length!==1||other.length!==1||unmatched[0].g.count!==other[0].count)continue;
   const {g,i}=unmatched[0];x.ingredients[i]={count:g.count,items:[...new Set([...g.items,...other[0].items])].sort()};
   groups.splice(b,1);changed=true;break outer;
  }
 }
 return groups;
}
export const CRAFTING_SEMANTICS='Server-unlocked supported recipes only. Each variant describes ONE recipe execution, not a recommended goal. Each ingredient group needs count units of ONE listed alternative; alternatives cannot be mixed unless a separate variant allows it. Each alternative gives [item, held, missingForOneExecution]. Each group also states satisfiedBy (a held alternative covering it, or null) and missing (the smallest shortfall across its alternatives). Each variant states shortForOneExecution, listing only groups still missing items; an empty list means one execution has every ingredient. Counts use carried inventory only, excluding armor, off-hand, containers and drops. maxExecutions is the current executable batch limit (0..16), accounting for inventory and a known workstation; approach and fresh physical validation are still required. Output count is produced per execution. Recompute after consumption/gain; feasible does not mean useful. Missing prerequisites may require model-planned gathering or intermediate crafts; no automatic dependency plan is supplied.';
export function craftingState(s:Pick<Snapshot,'inventory'|'recipeBook'>,lookup:(item:string)=>RecipeFact[],executable:(item:string)=>number){
 const held=new Map<string,number>();for(const i of s.inventory??[])if(i.slot>=9&&i.slot<=44)held.set(i.name,(held.get(i.name)??0)+i.count);
 const recipes=[...new Set(s.recipeBook.unlocked.map(id=>id.replace(/^minecraft:/,'')))].sort().flatMap(item=>{
  const facts=lookup(item).filter(f=>f.item===item);if(!facts.length)return [];
  return [{item,maxExecutions:executable(item),variants:variants(facts).map(v=>{
   const ingredients=v.ingredients.map(g=>{
    const alternatives=g.items.map(item=>[item,held.get(item)??0,Math.max(0,g.count-(held.get(item)??0))] as [string,number,number]);
    const best=alternatives.reduce((a,b)=>b[2]<a[2]||b[2]===a[2]&&b[1]>a[1]?b:a);
    return {count:g.count,satisfiedBy:best[2]===0?best[0]:null,missing:best[2],alternatives};
   });
   // Conclusion per group so a long alternative list is not read as a shortage.
   return {output:v.output,requiresTable:v.requiresTable,shortForOneExecution:ingredients.filter(g=>g.missing>0).map(g=>({count:g.count,missing:g.missing,closest:g.alternatives.reduce((a,b)=>b[2]<a[2]?b:a)[0]})),ingredients};
  })}];
 });
 return {semantics:CRAFTING_SEMANTICS,recipes};
}
export function recipeExecutionCounts(s:Snapshot,item:string){
 // Old recordings without feasibility facts cannot justify a multi-batch choice.
 // craftable still proves a single execution; fresh live snapshots always carry facts.
 const n=s.crafting?.recipes.find(r=>r.item===item)?.maxExecutions??(s.craftable?.includes(item)?1:0);
 return Array.from({length:Math.min(16,Math.max(0,Math.floor(n)))},(_,i)=>i+1);
}
export function feasibleExecutions(can:(count:number)=>boolean){
 if(!can(1))return 0;let lo=1,hi=16;
 while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(can(mid))lo=mid;else hi=mid-1;}return lo;
}

// Mineflayer recipesFor's minimum is OUTPUT ITEMS, whereas craft's count is
// recipe EXECUTIONS. Do not pass an execution count as that minimum.
export function recipeBatchAvailable(recipe:{delta:{id:number;metadata?:number|null;count:number}[]},executions:number,held:(id:number,metadata?:number|null)=>number){
 return Number.isInteger(executions)&&executions>0&&recipe.delta.every(d=>d.count>=0||held(d.id,d.metadata)+d.count*executions>=0);
}

// Conclusion shown next to the craft action: what can be made now, and for planned outputs what is short.
export function craftableNowFact(s:Pick<Snapshot,'craftable'|'crafting'>,intent?:{desiredInventory?:{item:string;count:number}[]},text=''){
 const now=[...new Set(s.craftable??[])].sort();
 // Before a task plan lists outputs, recipe outputs named in the goal or plan text count as planned.
 const lower=text.toLowerCase(),named=(s.crafting?.recipes??[]).map(r=>r.item).filter(item=>lower.includes(item)||lower.includes(item.replace(/_/g,' ')));
 const planned=[...new Set([...(intent?.desiredInventory??[]).map(d=>d.item),...named])].filter(item=>!now.includes(item)).map(item=>{
  const r=s.crafting?.recipes.find(x=>x.item===item);if(!r)return undefined;
  const short=r.variants.map(v=>v.shortForOneExecution.map(g=>`${g.closest} ${g.missing}`).join(', ')).filter(Boolean).sort((a,b)=>a.length-b.length)[0];
  return `${item} (short: ${short||'workstation or unknown'})`;
 }).filter(Boolean);
 return `Craftable now: ${now.length?now.join(', '):'nothing'}.${planned.length?` Planned but not craftable now: ${planned.join('; ')}.`:''}`;
}
