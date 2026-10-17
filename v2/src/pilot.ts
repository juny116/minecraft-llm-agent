export function pilotStopReason(s:{elapsedMs:number;maxMs:number;states:{ready:boolean;health:number}[];budgetExhausted:boolean;noProgressMs:number;consecutiveFailures:number}):string|null{
 if(s.elapsedMs>=Math.min(s.maxMs,300000))return 'time_limit';
 if(s.budgetExhausted)return 'budget_or_usage_limit';
 if(s.states.some(b=>b.health<=0))return 'death';
 if(s.states.some(b=>!b.ready))return 'disconnected';
 if(s.states.some(b=>b.health<=6))return 'low_health';
 if(s.consecutiveFailures>=4)return 'repeated_failure';
 if(s.noProgressMs>=120000)return 'no_progress';
 return null;
}
