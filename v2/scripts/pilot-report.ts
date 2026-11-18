import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {summarizePilot,type PilotEvent} from '../src/pilot-report.js';
const dir=process.argv[2];if(!dir)throw Error('Usage: node --import tsx scripts/pilot-report.ts <private-run-directory>');
const events=readFileSync(join(dir,'events.jsonl'),'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line) as PilotEvent);
const summary=JSON.parse(readFileSync(join(dir,'summary.json'),'utf8'));
console.log(JSON.stringify({stopReason:summary.reason,costs:summary.costs,...summarizePilot(events)},null,2));
