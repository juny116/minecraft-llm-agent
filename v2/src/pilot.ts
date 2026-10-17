export function pilotStopReason(s:{elapsedMs:number;maxMs:number;authorizedMaxMs?:number;states:{ready:boolean;health:number;lifecycle?:{phase:string;deathCount:number}}[];allowRespawn?:boolean;respawnWaitMs?:number;budgetExhausted:boolean;noProgressMs:number;consecutiveFailures:number;agentNoProgressMs?:number[]}):string|null{
 if(s.elapsedMs>=Math.min(s.maxMs,Math.max(0,Math.min(s.authorizedMaxMs??300000,1800000))))return 'time_limit';
 if(s.budgetExhausted)return 'budget_or_usage_limit';
 if(s.allowRespawn&&s.states.some(b=>(b.lifecycle?.deathCount??0)>=3))return 'repeated_death';
 if(s.allowRespawn&&(s.respawnWaitMs??0)>30000)return 'respawn_timeout';
 if(s.allowRespawn&&s.states.some(b=>b.health<=0||b.lifecycle?.phase==='dead'))return null;
 if(s.states.some(b=>b.health<=0))return 'death';
 if(s.states.some(b=>!b.ready))return 'disconnected';
 if(s.states.some(b=>b.health<=6))return 'low_health';
 if(s.consecutiveFailures>=4)return 'repeated_failure';
 if(s.agentNoProgressMs?.some(ms=>ms>=180000))return 'agent_no_progress';
 if(s.noProgressMs>=120000)return 'no_progress';
 return null;
}
