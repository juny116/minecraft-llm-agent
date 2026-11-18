import type {Snapshot} from './types.js';
import {weaponRank} from './combat.js';

// Vanilla Java 1.21 combat values (Normal difficulty) for judging a fight; enchantments, critical hits and
// status effects are ignored. In DUO3 a zombie hit on full iron armor measured 1.38, matching takenPerHit.
const MOBS:Record<string,{health:number;hit:number;ranged?:boolean;explodes?:boolean}>={
 zombie:{health:20,hit:3},husk:{health:20,hit:3},drowned:{health:20,hit:3},zombie_villager:{health:20,hit:3},
 skeleton:{health:20,hit:3,ranged:true},stray:{health:20,hit:3,ranged:true},spider:{health:16,hit:2},cave_spider:{health:12,hit:2},
 creeper:{health:20,hit:22,explodes:true}/* point-blank blast */,enderman:{health:40,hit:7},witch:{health:26,hit:6,ranged:true},slime:{health:16,hit:4},
};
const WEAPON:Record<string,{damage:number;perSecond:number}>={
 wooden_sword:{damage:4,perSecond:1.6},golden_sword:{damage:4,perSecond:1.6},stone_sword:{damage:5,perSecond:1.6},iron_sword:{damage:6,perSecond:1.6},diamond_sword:{damage:7,perSecond:1.6},netherite_sword:{damage:8,perSecond:1.6},
 wooden_axe:{damage:7,perSecond:.8},golden_axe:{damage:7,perSecond:1},stone_axe:{damage:9,perSecond:.8},iron_axe:{damage:9,perSecond:.9},diamond_axe:{damage:9,perSecond:1},netherite_axe:{damage:10,perSecond:1},
};
const ARMOR:Record<string,number[]>={leather:[1,3,2,1],golden:[2,5,3,1],chainmail:[2,5,4,1],iron:[2,6,5,2],diamond:[3,8,6,3],netherite:[3,8,6,3],turtle:[2,0,0,0]};
const TOUGHNESS:Record<string,number>={diamond:2,netherite:3};
const SLOTS=['helmet','chestplate','leggings','boots'];

export function armorStats(worn:string[]){
 let points=0,toughness=0;
 for(const name of worn){const m=/^(\w+?)_(helmet|chestplate|leggings|boots)$/.exec(name);if(!m||!ARMOR[m[1]])continue;points+=ARMOR[m[1]][SLOTS.indexOf(m[2])];toughness+=TOUGHNESS[m[1]]??0;}
 return {points,toughness};
}
// Vanilla armor formula.
export function takenPerHit(damage:number,a:{points:number;toughness:number}){
 const reduction=Math.min(20,Math.max(a.points/5,a.points-damage/(2+a.toughness/4)))/25;
 return +(damage*(1-reduction)).toFixed(2);
}
export function combatFacts(enemyKinds:string[],held:string|undefined,worn:string[],health:number){
 const weapon=held&&WEAPON[held]?{name:held,...WEAPON[held]}:{name:held??'empty hand',damage:1,perSecond:4};
 const armor=armorStats(worn);
 const enemies=[...new Set(enemyKinds)].filter(k=>MOBS[k]).map(kind=>{
  const m=MOBS[kind],taken=takenPerHit(m.hit,armor),hits=Math.ceil(m.health/weapon.damage);
  return {kind,yourHitsToKill:hits,secondsToKillAtFullSwing:+(hits/weapon.perSecond).toFixed(1),healthLostPerHitTaken:taken,hitsYouCanTakeNow:Math.max(0,Math.ceil(health/taken)-1),...(m.ranged?{ranged:true}:{}),...(m.explodes?{explodes:true}:{})};
 });
 return enemies.length?{weapon:weapon.name,armorPoints:armor.points,enemies,meaning:'Vanilla Normal-difficulty values with your held weapon and worn armor; no enchantments or critical hits. Facts for weighing fight or flight, not a recommendation.'}:undefined;
}

const COMMON=['zombie','skeleton','spider','creeper'];
// Attack equips the best carried weapon, so facts use that weapon rather than whatever is in hand.
export function snapshotCombatFacts(s:Snapshot,includeCommon=false){
 const carried=[...(s.inventory??[]).map(i=>i.name),...(s.equipment??[]).filter(e=>e.slot==='hand').map(e=>e.name)];
 const best=carried.sort((a,b)=>weaponRank(b)-weaponRank(a))[0];
 const worn=(s.equipment??[]).filter(e=>['head','chest','legs','feet'].includes(e.slot)).map(e=>e.name);
 const kinds=[...(s.enemies??[]).map(e=>e.kind),...(includeCommon?COMMON:[])];
 return combatFacts(kinds,best&&weaponRank(best)>0?best:undefined,worn,s.health);
}
