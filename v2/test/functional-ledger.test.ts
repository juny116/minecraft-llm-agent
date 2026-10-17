import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {FunctionalLedger,boundUnknownRun} from '../scripts/functional-ledger.js';
test('functional ledger prevents concurrent sessions and includes prior costs toward five dollar limit',()=>{const dir=mkdtempSync(join(tmpdir(),'ledger-'));try{const file=join(dir,'cost.json');writeFileSync(file,JSON.stringify({schema:1,limit:5,entries:[{id:'previous',status:'complete',reserved:0,usd:4.98,calls:5}]}));const l=new FunctionalLedger(file,10,.15);assert.ok(l.budget.maxUsd<=.020001);assert.throws(()=>new FunctionalLedger(file));l.budget.usd=.01;const result=l.finish();assert.equal(result.totalUsd,4.99);assert.equal(JSON.parse(readFileSync(file,'utf8')).entries[1].reserved,0);}finally{rmSync(dir,{recursive:true});}});
test('unknown billed usage stops subsequent ledger sessions pending reconciliation',()=>{const dir=mkdtempSync(join(tmpdir(),'ledger-'));try{const file=join(dir,'cost.json'),l=new FunctionalLedger(file);l.budget.unknownUsage=1;l.finish();assert.throws(()=>new FunctionalLedger(file),/Unsettled/);}finally{rmSync(dir,{recursive:true});}});
test('unsettled in-flight reservation blocks subsequent paid runs',()=>{const file=join(mkdtempSync(join(tmpdir(),'ledger-flight-')),'costs.json'),l=new FunctionalLedger(file,10,.1);l.budget.reserve(.01);assert.equal(l.finish().status,'usage_unknown');assert.throws(()=>new FunctionalLedger(file),/Unsettled/);});

test('explicit conservative reconciliation preserves unknown usage and charges the full reservation before resuming',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ledger-bound-'));try{
  const file=join(dir,'cost.json'),l=new FunctionalLedger(file,20,.25);l.budget.usd=.01;l.budget.unknownUsage=1;l.finish();
  const id=JSON.parse(readFileSync(file,'utf8')).entries[0].id;
  assert.throws(()=>new FunctionalLedger(file),/Unsettled/);const result=boundUnknownRun(file,id);
  assert.equal(result.status,'bounded_unknown');assert.equal(result.reportedUsd,.01);assert.equal(result.upperBoundUsd,.25);assert.equal(result.totalAccountedUsd,.25);
  assert.throws(()=>boundUnknownRun(file,id),/Cannot bound/);
  const next=new FunctionalLedger(file,20,5);assert.equal(next.budget.maxUsd,4.75);assert.equal(next.finish().hasBoundedEstimates,true);
 }finally{rmSync(dir,{recursive:true});}
});
test('reconciliation never overrides a running session or an invalid ceiling',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ledger-bound-invalid-'));try{
  const file=join(dir,'cost.json'),l=new FunctionalLedger(file,20,.25);assert.throws(()=>boundUnknownRun(file,'any'));l.finish();
  writeFileSync(file,JSON.stringify({schema:1,limit:5,entries:[{id:'bad',status:'usage_unknown',usd:.3,reserved:.25,calls:1}]}));
  assert.throws(()=>boundUnknownRun(file,'bad'),/Cannot bound/);assert.equal(JSON.parse(readFileSync(file,'utf8')).entries[0].status,'usage_unknown');
 }finally{rmSync(dir,{recursive:true});}
});
