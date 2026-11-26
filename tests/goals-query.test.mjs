import test from 'node:test';
import assert from 'node:assert/strict';
import {readGoalQueryRows} from '../app/api/_lib/goals-query.ts';

test('goal pagination returns small results in one query without a separate count scan',async()=>{
  const queries=[];
  const rows=await readGoalQueryRows(async sql=>{queries.push(sql);return [{VALUE:120,FV_GOAL_TOTAL:1,FV_GOAL_ROW_NUMBER:1}];},'SELECT VALUE FROM FIXTURE');
  assert.deepEqual(rows,[{VALUE:120}]);assert.equal(queries.length,1);
  assert.match(queries[0],/COUNT\(\*\) OVER\(\)/);
  assert.deepEqual(await readGoalQueryRows(async()=>[],'SELECT VALUE FROM FIXTURE'),[]);
});

test('goal pagination preserves ordering and totals across bounded concurrent pages',async()=>{
  let active=0,maxActive=0,count=0;
  const result=await readGoalQueryRows(async sql=>{
    count++;active++;maxActive=Math.max(active,maxActive);await new Promise(r=>setImmediate(r));active--;
    const offset=Number(sql.match(/FV_GOAL_ROW_NUMBER>(\d+)/)[1]);
    return Array.from({length:Math.min(2,7-offset)},(_,i)=>({VALUE:offset+i,FV_GOAL_TOTAL:7,FV_GOAL_ROW_NUMBER:offset+i+1}));
  },'SELECT VALUE FROM FIXTURE ORDER BY VALUE',2);
  assert.deepEqual(result.map(r=>r.VALUE),[0,1,2,3,4,5,6]);assert.equal(count,4);assert.equal(maxActive,2);
});

test('goal pagination rejects missing rows, unstable counts or positions instead of partial metrics',async()=>{
  for(const invalid of [[],[{FV_GOAL_TOTAL:4,FV_GOAL_ROW_NUMBER:3}],[{FV_GOAL_TOTAL:3,FV_GOAL_ROW_NUMBER:2}]]){
    let count=0;
    await assert.rejects(readGoalQueryRows(async()=>++count===1?[{FV_GOAL_TOTAL:3,FV_GOAL_ROW_NUMBER:1},{FV_GOAL_TOTAL:3,FV_GOAL_ROW_NUMBER:2}]:invalid,'SELECT X FROM FIXTURE',2),/incompletos/);
  }
  await assert.rejects(readGoalQueryRows(async()=>[{FV_GOAL_TOTAL:undefined}],'SELECT X FROM FIXTURE'),/conferir/);
});
