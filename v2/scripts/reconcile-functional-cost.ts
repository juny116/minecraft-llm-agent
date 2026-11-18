import {boundUnknownRun} from './functional-ledger.js';
const [flag,id]=process.argv.slice(2);
if(flag!=='--charge-full-reservation'||!id)throw Error('Usage: node --import tsx scripts/reconcile-functional-cost.ts --charge-full-reservation <ledger-entry-id>');
console.log(JSON.stringify(boundUnknownRun('runs/functional-cost-ledger.json',id)));
