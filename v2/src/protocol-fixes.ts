import {createRequire} from 'node:module';

// minecraft-data 3.117.0 lists crafting_special_banneraddpattern in the 1.21.1 recipe serializer
// mapping, which the 1.21.1 server does not have. Every later type id shifts by one, so the whole
// declare_recipes packet fails to parse whenever a later-type recipe precedes the end (order varies
// per server start). Remove the entry before any client compiles the protocol.
export function fixRecipeTypeMapping(version:string){
 if(version!=='1.21.1')return false;
 const fromMineflayer=createRequire(createRequire(import.meta.url).resolve('mineflayer'));
 const protocol=fromMineflayer('minecraft-data')(version)?.protocol;
 const entry=protocol?.play?.toClient?.types?.packet_declare_recipes?.[1]?.[0]?.type?.[1]?.type?.[1];
 const mapper=Array.isArray(entry)?entry.find((f:any)=>f.name==='type')?.type?.[1]:undefined;
 if(!mapper?.mappings||!Object.values(mapper.mappings).includes('minecraft:crafting_special_banneraddpattern'))return false;
 const names=Object.values<string>(mapper.mappings).filter(n=>n!=='minecraft:crafting_special_banneraddpattern');
 mapper.mappings=Object.fromEntries(names.map((n,i)=>[String(i),n]));
 return true;
}
export function recipeTypeMapping(version:string){
 const fromMineflayer=createRequire(createRequire(import.meta.url).resolve('mineflayer'));
 const entry=fromMineflayer('minecraft-data')(version)?.protocol?.play?.toClient?.types?.packet_declare_recipes?.[1]?.[0]?.type?.[1]?.type?.[1];
 return Array.isArray(entry)?entry.find((f:any)=>f.name==='type')?.type?.[1]?.mappings:undefined;
}
