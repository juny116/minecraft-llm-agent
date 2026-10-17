import {mkdirSync,existsSync,readFileSync,writeFileSync,renameSync,openSync,closeSync,unlinkSync} from 'node:fs';import {dirname} from 'node:path';import {randomUUID} from 'node:crypto';import {Budget} from '../src/providers.js';
type Entry={id:string;status:'running'|'complete'|'usage_unknown'|'bounded_unknown';reserved:number;usd:number;calls:number;note?:string;reportedUsd?:number;upperBoundUsd?:number};
export class FunctionalLedger{
 private fd:number;private lock:string;private data:{schema:1;limit:number;entries:Entry[]};readonly budget:Budget;private id=randomUUID();
 constructor(private file:string,maxCalls=40,runLimit=.15,authorizedTotal=5){mkdirSync(dirname(file),{recursive:true,mode:0o700});this.lock=file+'.lock';this.fd=openSync(this.lock,'wx',0o600);try{this.data=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{schema:1,limit:5,entries:[]};if(!Number.isFinite(authorizedTotal)||authorizedTotal<5||authorizedTotal>25||this.data.schema!==1||!Number.isFinite(this.data.limit)||this.data.limit<5||this.data.limit>authorizedTotal||!Array.isArray(this.data.entries)||this.data.entries.some(e=>!['running','complete','usage_unknown','bounded_unknown'].includes(e.status)||!Number.isFinite(e.usd)||e.usd<0||!Number.isFinite(e.reserved)||e.reserved<0||(e.status==='bounded_unknown'&&(e.reserved!==0||!Number.isFinite(e.reportedUsd)||e.reportedUsd!<0||e.reportedUsd!>e.usd||e.upperBoundUsd!==e.usd))))throw Error('Invalid functional ledger');if(this.data.entries.some(e=>!['complete','bounded_unknown'].includes(e.status)))throw Error('Unsettled prior run; reconcile before dispatch');const used=this.data.entries.reduce((n,e)=>n+e.usd,0),remaining=Math.min(runLimit,authorizedTotal-used);if(remaining<=0)throw Error('Authorized total exhausted; confirmation required');this.data.limit=authorizedTotal;this.budget=new Budget(maxCalls,remaining);this.data.entries.push({id:this.id,status:'running',reserved:remaining,usd:0,calls:0});this.save();}catch(e){closeSync(this.fd);unlinkSync(this.lock);throw e;}}
 private save(){const tmp=this.file+'.tmp';writeFileSync(tmp,JSON.stringify(this.data,null,2),{mode:0o600});renameSync(tmp,this.file);}
 finish(){try{const e=this.data.entries.find(e=>e.id===this.id)!;e.usd=this.budget.usd;e.calls=this.budget.calls;e.status=this.budget.unsettledUsage||this.budget.reservedUsd>1e-12?'usage_unknown':this.budget.boundedUnknownUsage?'bounded_unknown':'complete';if(e.status!=='usage_unknown')e.reserved=0;if(e.status==='bounded_unknown'){e.reportedUsd=e.usd-this.budget.unknownUsd;e.upperBoundUsd=e.usd;e.note='Unknown replies charged at their individual request ceilings; actual billing remains unverified.';}this.save();return {runUsd:e.usd,totalUsd:this.data.entries.reduce((n,e)=>n+e.usd,0),reportedTotalUsd:this.data.entries.reduce((n,x)=>n+(x.reportedUsd??x.usd),0),limit:this.data.limit,status:e.status,hasBoundedEstimates:this.data.entries.some(x=>x.status==='bounded_unknown')};}finally{closeSync(this.fd);unlinkSync(this.lock);}}
}

// Explicit reconciliation only: retain unknown status semantics and deduct the
// whole reserved run ceiling, never pretend the provider reported this usage.
export function boundUnknownRun(file:string,id:string){
 const lock=file+'.lock',fd=openSync(lock,'wx',0o600);
 try{
  const data=JSON.parse(readFileSync(file,'utf8'));
  if(data.schema!==1||!Number.isFinite(data.limit)||data.limit<5||data.limit>25||!Array.isArray(data.entries))throw Error('Invalid functional ledger');
  const e=data.entries.find((x:Entry)=>x.id===id) as Entry|undefined;
  if(!e||e.status!=='usage_unknown'||!Number.isFinite(e.reserved)||e.reserved<=0||!Number.isFinite(e.usd)||e.usd<0||e.usd>e.reserved)throw Error('Cannot bound this run');
  e.reportedUsd=e.usd;e.upperBoundUsd=e.reserved;e.usd=e.reserved;e.reserved=0;e.status='bounded_unknown';
  e.note='Usage remains unverified; the entire reserved run ceiling is counted against the shared limit.';
  const tmp=file+'.tmp';writeFileSync(tmp,JSON.stringify(data,null,2),{mode:0o600});renameSync(tmp,file);
  return {id:e.id,status:e.status,reportedUsd:e.reportedUsd,upperBoundUsd:e.upperBoundUsd,totalAccountedUsd:data.entries.reduce((n:number,x:Entry)=>n+x.usd,0)};
 }finally{closeSync(fd);unlinkSync(lock);}
}
