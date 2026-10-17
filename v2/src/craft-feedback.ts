import type {Bot} from 'mineflayer';
// Recipe details are revealed only for a server-unlocked vanilla output ID.
// Prior-knowledge crafting remains possible without disclosing locked recipes.
export function craftFailure(bot:Bot,request:{item:string;count:number},unlocked:string[],table:Parameters<Bot['recipesAll']>[2]){
 if(!unlocked.some(id=>id.replace(/^minecraft:/,'')===request.item))return 'Missing ingredients or visible crafting table; recipe details are not unlocked';
 const id=bot.registry.itemsByName[request.item]?.id;if(id===undefined)return 'Missing known crafting output';
 const recipes=bot.recipesAll(id,null,true);
 if(!recipes.length)return 'Missing supported unlocked recipe data';
 const variants=recipes.map(recipe=>({requiresTable:recipe.requiresTable,missing:recipe.delta.filter(d=>d.count<0).map(d=>({item:bot.registry.items[d.id]?.name??'unknown',count:Math.max(0,-d.count*request.count-bot.inventory.count(d.id,d.metadata))})).filter(d=>d.count>0)}));
 variants.sort((a,b)=>a.missing.reduce((n,d)=>n+d.count,0)-b.missing.reduce((n,d)=>n+d.count,0));
 const best=variants[0],missing=best.missing.map(d=>`${d.item} x${d.count}`).join(', ');
 if(!table&&best.requiresTable)return `Missing visible crafting table for ${request.item}${missing?`; also missing ${missing}`:''}`;
 return `Missing ingredients for ${request.item}: ${missing||'refresh inventory'}; table ${table?'visible':'not required'}`;
}
