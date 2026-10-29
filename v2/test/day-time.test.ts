import test from 'node:test';import assert from 'node:assert/strict';
import {dayTime} from '../src/day-time.js';

test('server clock becomes a readable phase with minutes to the next change',()=>{
 assert.equal(dayTime(undefined),undefined);
 assert.deepEqual([dayTime(6000)!.phase,dayTime(6000)!.minutesUntilNight,dayTime(6000)!.minutesUntilDay],['day',5.8,null]);
 assert.deepEqual([dayTime(13234)!.phase,dayTime(13234)!.minutesUntilDay],['night',9]);
 assert.equal(dayTime(12500)!.phase,'sunset');assert.equal(dayTime(23500)!.phase,'sunrise');assert.equal(dayTime(24000+100)!.ticks,100);
});
