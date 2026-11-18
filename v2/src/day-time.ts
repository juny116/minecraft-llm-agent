// Readable form of the server clock. A day is 24000 ticks (20 minutes); 0 is sunrise.
export type DayTime={ticks:number;phase:'day'|'sunset'|'night'|'sunrise';minutesUntilNight:number|null;minutesUntilDay:number|null;meaning:string};
const TICKS_PER_MINUTE=1200,NIGHT=13000,DAY=24000;
export function dayTime(timeOfDay:number|undefined):DayTime|undefined{
 if(timeOfDay===undefined||!Number.isFinite(timeOfDay))return undefined;
 const t=((Math.floor(timeOfDay)%24000)+24000)%24000;
 const phase=t<12000?'day':t<NIGHT?'sunset':t<23000?'night':'sunrise';
 const minutes=(ticks:number)=>+(ticks/TICKS_PER_MINUTE).toFixed(1);
 const dark=phase==='night';
 return {ticks:t,phase,minutesUntilNight:dark?null:minutes((NIGHT-t+DAY)%DAY),minutesUntilDay:dark||phase==='sunset'?minutes(DAY-t):null,
  meaning:'Server clock in real minutes (one game day is 20 minutes). night is dark from tick 13000 to 23000; sunset and sunrise are the transitions.'};
}
