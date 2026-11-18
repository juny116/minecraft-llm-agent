// Request-local identifiers only. Exact reversible substitution, never fuzzy repair.
export function evidenceAliases(input:any){
 const ids=[...new Set<string>([...(input?.episodes??[]).map((e:any)=>e.id),...(input?.placeCitationContract?.allowedEvidenceIds??[])])];
 const strings=new Set<string>();const scan=(v:any):void=>{if(typeof v==='string')strings.add(v);else if(v&&typeof v==='object')Object.values(v).forEach(scan);};scan(input);
 const forward=new Map<string,string>(),reverse=new Map<string,string>();let i=0;
 for(const id of ids){let alias:string;do{alias='E'+(++i);}while(strings.has(alias));forward.set(id,alias);reverse.set(alias,id);}
 const walk=(v:any,map:Map<string,string>):any=>typeof v==='string'?(map.get(v)??v):Array.isArray(v)?v.map(x=>walk(x,map)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,walk(x,map)])):v;
 return {input:walk(input,forward),decode:(v:any)=>walk(v,reverse)};
}
