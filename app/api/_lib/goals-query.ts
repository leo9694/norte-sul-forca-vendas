type GoalRow=Record<string,unknown>;
// A contagem vem na própria página: não executa a agregação uma vez só para COUNT(*).
export async function readGoalQueryRows(query:(sql:string)=>Promise<GoalRow[]>,sql:string,pageSize=4000):Promise<GoalRow[]>{
  const page=(offset:number)=>query(`SELECT * FROM (
    SELECT FV_GOAL_SOURCE.*,COUNT(*) OVER() FV_GOAL_TOTAL,ROWNUM FV_GOAL_ROW_NUMBER
      FROM (${sql}) FV_GOAL_SOURCE
  ) WHERE FV_GOAL_ROW_NUMBER>${offset} AND FV_GOAL_ROW_NUMBER<=${offset+pageSize} ORDER BY FV_GOAL_ROW_NUMBER`);
  const first=await page(0);if(!first.length)return [];
  const total=Number(first[0].FV_GOAL_TOTAL);
  if(!Number.isSafeInteger(total)||total<first.length||total<=0)throw Error('Não foi possível conferir a apuração das metas.');
  const rows:GoalRow[]=[];
  const append=(values:GoalRow[],offset:number)=>{
    if(values.length!==Math.min(pageSize,total-offset)||values.some((row,i)=>Number(row.FV_GOAL_TOTAL)!==total||Number(row.FV_GOAL_ROW_NUMBER)!==offset+i+1))throw Error('A apuração retornou dados incompletos. Atualize novamente.');
    for(const row of values){const data={...row};delete data.FV_GOAL_TOTAL;delete data.FV_GOAL_ROW_NUMBER;rows.push(data);}
  };
  append(first,0);
  while(rows.length<total){const offset=rows.length,offsets=Array.from({length:Math.min(2,Math.ceil((total-offset)/pageSize))},(_,i)=>offset+i*pageSize),pages=await Promise.all(offsets.map(page));pages.forEach((values,i)=>append(values,offsets[i]));}
  return rows;
}
