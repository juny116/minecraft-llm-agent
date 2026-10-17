import type {Enemy} from './combat.js';
// Inputs must come from the visible-enemy observation, never raw tracked entities.
export class CombatStart {
 private baseline?: {id:number;x:number;z:number};
 private fired=false;
 update(visible:Enemy[]):'waiting'|'armed'|'start'|'running' {
  if(this.fired)return 'running';
  if(visible.length===0){
   if(this.baseline)throw Error('Prepared target left view before start');
   return 'waiting';
  }
  if(visible.length!==1||visible[0].kind!=='zombie')throw Error('Expected exactly one visible prepared zombie');
  const e=visible[0];
  if(!this.baseline){this.baseline={id:e.id,x:e.position.x,z:e.position.z};return 'armed';}
  if(e.id!==this.baseline.id)throw Error('Prepared target changed before start');
  if(Math.hypot(e.position.x-this.baseline.x,e.position.z-this.baseline.z)<.15)return 'armed';
  this.fired=true;return 'start';
 }
}
