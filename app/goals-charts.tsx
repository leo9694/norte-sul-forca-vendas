'use client';
import { useEffect, useState } from 'react';
import { campaignMatches, goalMetrics, goalToday, monthPeriod, performanceLabels, previousGoalPeriod, shiftMonth, type CentralData, type GoalFact, type GoalFilters, type Performance, type summarizeGoals } from './goals-central-model';
const money=(v:number)=>v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
type Summary=ReturnType<typeof summarizeGoals>;
const colors=['#00855b','#4b8ac7','#e6b541','#cb5454','#9aa7a1'];
function Curve({title,labels,series,columns=false,showHeading=true}:{title:string;labels:string[];series:{name:string;color:string;values:(number|null)[]}[];columns?:boolean;showHeading?:boolean}){
  const [hover,setHover]=useState<number|null>(null),[hidden,setHidden]=useState<string[]>([]);
  const visible=series.filter(s=>!hidden.includes(s.name)),max=Math.max(1,...visible.flatMap(s=>s.values.filter((v):v is number=>v!==null))),min=Math.min(0,...visible.flatMap(s=>s.values.filter((v):v is number=>v!==null))),range=max-min||1;
  const x=(i:number)=>columns?55+(i+.5)/Math.max(1,labels.length)*610:55+i/Math.max(1,labels.length-1)*610,y=(v:number)=>175-(v-min)/range*150;
  return <div className="goal-chart">{showHeading&&<h3>{title}</h3>}<svg viewBox="0 0 690 215" role="img" aria-label={title}>
    {[0,.5,1].map(n=><g key={n}><line x1="55" x2="665" y1={y(min+range*n)} y2={y(min+range*n)} stroke="#e5ede9"/><text x="50" y={y(min+range*n)+4} textAnchor="end" fontSize="10" fill="#61766c">{new Intl.NumberFormat('pt-BR',{notation:'compact'}).format(min+range*n)}</text></g>)}
    {visible.map((s,j)=><g key={s.name}>{columns?s.values.map((v,i)=>v===null?null:<rect key={i} x={x(i)-12+j*12} y={Math.min(y(v),y(0))} width="10" height={Math.max(1,Math.abs(y(v)-y(0)))} fill={s.color}><title>{`${labels[i]} · ${s.name}: ${money(v)}`}</title></rect>):<><path d={s.values.map((v,i)=>v===null?'':`${i===0||s.values[i-1]===null?'M':'L'}${x(i)},${y(v)}`).join(' ')} fill="none" stroke={s.color} strokeWidth="2.5"/>{s.values.map((v,i)=>v===null?null:<circle key={i} cx={x(i)} cy={y(v)} r={hover===i?4:2} fill={s.color}><title>{`${labels[i]} · ${s.name}: ${money(v)}`}</title></circle>)}</>}</g>)}
    {labels.map((label,i)=><g key={i}><rect x={x(i)-Math.max(5,300/labels.length)} y="15" width={Math.max(10,610/labels.length)} height="170" fill="transparent" tabIndex={0} aria-label={`${label}: ${visible.map(s=>`${s.name} ${s.values[i]===null?'não disponível':money(s.values[i]!)}`).join(', ')}`} onMouseEnter={()=>setHover(i)} onMouseLeave={()=>setHover(null)} onFocus={()=>setHover(i)} onBlur={()=>setHover(null)}><title>{`${label}${visible.map(s=>` · ${s.name}: ${s.values[i]===null?'—':money(s.values[i]!)}`).join('')}`}</title></rect>{(i===0||i===labels.length-1||i%Math.max(1,Math.floor(labels.length/6))===0)&&<text x={x(i)} y="202" textAnchor="middle" fontSize="10" fill="#61766c">{label}</text>}</g>)}
  </svg><div className="goal-chart-legend">{series.map(s=><button key={s.name} aria-pressed={!hidden.includes(s.name)} onClick={()=>setHidden(h=>h.includes(s.name)?h.filter(n=>n!==s.name):[...h,s.name])}><i style={{background:s.color}}/>{s.name}</button>)}</div>{hover!==null&&<div className="goal-chart-tooltip" role="status">{labels[hover]} · {visible.map(s=>`${s.name}: ${s.values[hover]===null?'—':money(s.values[hover]!)}`).join(' · ')}</div>}</div>;
}
export { Curve as GoalTimeChart };
function Bars({title,rows,onSelect,limit}:{title:string;rows:{key:string;name:string;target:number|null;actual:number}[];onSelect?:(key:string)=>void;limit?:number}){
  const max=Math.max(1,...rows.flatMap(r=>[r.target||0,r.actual]));
  const Row=onSelect?'button':'div';
  return <div className="goal-chart"><h3>{title}</h3>{rows.length?(limit===undefined?rows:rows.slice(0,limit)).map(r=><Row className="goal-bar-row" key={r.key} onClick={onSelect?()=>onSelect(r.key):undefined} title={`${r.name}: meta ${r.target===null?'não cadastrada':money(r.target)}, realizado ${money(r.actual)}${r.target?`, ${Math.round(r.actual/r.target*100)}%`:''}`}><span>{r.name}</span><div><i className="goal-bar-target" style={{width:`${Math.max(0,(r.target||0)/max*100)}%`}}/><i className="goal-bar-actual" style={{width:`${Math.max(0,r.actual/max*100)}%`}}/></div><small>{money(r.actual)} / {r.target===null?'—':money(r.target)}</small></Row>):<p className="goals-note">Sem movimentação ou meta cadastrada no período.</p>}<p className="goals-note">Verde: realizado · cinza: meta.{onSelect?' Clique para filtrar.':''}</p></div>;
}
export function GoalCharts({data,summary,start,end,individual,onFilter,allowDrilldown=true,historyReady=true,historyError='',onHistoryNeeded}:{data:CentralData;summary:Summary;start:string;end:string;individual:boolean;onFilter:(key:keyof GoalFilters,value:string)=>void;allowDrilldown?:boolean;historyReady?:boolean;historyError?:string;onHistoryNeeded?:()=>void}){
  const [historyOpen,setHistoryOpen]=useState(false);
  const [performanceOpen,setPerformanceOpen]=useState(false);
  const [showAllCategories,setShowAllCategories]=useState(false);
  useEffect(()=>{if(historyOpen)onHistoryNeeded?.();},[historyOpen,onHistoryNeeded]);
  const today=goalToday(),days:number[]=[],labels:string[]=[];for(let d=new Date(start+'T12:00:00Z');d.toISOString().slice(0,10)<=end;d.setUTCDate(d.getUTCDate()+1)){const date=d.toISOString().slice(0,10);days.push(Number(date.slice(8)));labels.push(date);}
  const current=summary.facts,target=summary.totals.target||0;
  const dailyActual=new Map<string,number>();
  for(const f of current)dailyActual.set(f.date,(dailyActual.get(f.date)??0)+f.actual);
  let cumulative=0,elapsed=0;
  const actual=labels.map(date=>date>today?null:(cumulative+=dailyActual.get(date)??0));
  const holidays=new Set(data.settings.holidays);
  const pace=labels.map(date=>{
    const weekday=new Date(date+'T12:00:00Z').getUTCDay();
    if(weekday>0&&weekday<6&&!holidays.has(date))elapsed++;
    return summary.totals.total?elapsed/summary.totals.total:0;
  });
  const ideal=pace.map(fraction=>target*fraction),projected=pace.map((fraction,i)=>labels[i]<today?null:summary.totals.projection*fraction);
  const visibleIds=new Set(summary.rows.map(r=>r.seller.id));
  const dimension=(kind:'brand'|'group')=>{
    const groups=new Map(data.catalog.groups.map(g=>[String(g.id),g.name]));
    const targets=data.campaigns.filter(c=>campaignMatches(c,summary.filters,start,end)&&c.start===start&&c.end===end&&c.assignments.some(a=>visibleIds.has(a.sellerId)));
    const names=new Set([...current.map(f=>String(f[kind])),...targets.filter(c=>c.type===kind).map(c=>String(c[kind]))]);
    const rows=new Map([...names].map(key=>[key,{key,name:kind==='group'?groups.get(key)||key:key,target:null as number|null,actual:0}]));
    for(const f of current){const row=rows.get(String(f[kind]));if(row)row.actual+=f.actual;}
    if(!summary.filters.state)for(const c of targets){
      if(c.type!==kind)continue;
      for(const a of c.assignments){
        if(!visibleIds.has(a.sellerId))continue;
        const row=rows.get(String(c[kind]));
        if(row)row.target=(row.target??0)+a.targetCents/100;
      }
    }
    return [...rows.values()].sort((a,b)=>b.actual-a.actual);
  };
  const history=historyOpen&&historyReady?Array.from({length:12},(_,i)=>shiftMonth(start,i-11)):[];
  const monthly=history.map(month=>summary.filteredFacts.filter(f=>f.date.startsWith(month)&&f.date<=today).reduce((s,f)=>s+f.actual,0));
  const historicTargets=history.map(month=>{
    const p=monthPeriod(month),type=summary.filters.type||(summary.filters.brand&&summary.filters.group?'combined':summary.filters.brand?'brand':summary.filters.group?'group':'general'),goals=data.campaigns.filter(c=>!summary.filters.state&&c.type===type&&campaignMatches(c,summary.filters,p.start,p.end)&&c.start===p.start&&c.end===p.end).flatMap(c=>c.assignments.filter(a=>visibleIds.has(a.sellerId)));
    return goals.length?goals.reduce((s,a)=>s+a.targetCents/100,0):null;
  });
  const year=start.slice(0,4),months=Array.from({length:12},(_,i)=>String(i+1).padStart(2,'0'));
  const annual=(y:string)=>months.map(m=>{const first=`${y}-${m}-01`;if(first>today)return null;const limitMonth=monthPeriod(`${y}-${m}`).end;const cutoff=year===today.slice(0,4)&&m===today.slice(5,7)?`${y}-${m}-${today.slice(8)}`:limitMonth;return summary.filteredFacts.filter(f=>f.date>=first&&f.date<=today&&f.date<=(cutoff<limitMonth?cutoff:limitMonth)).reduce((s,f)=>s+f.actual,0);});
  const distribution=(Object.keys(performanceLabels) as Performance[]).map((key,i)=>({key,color:colors[i],count:summary.rows.filter(r=>r.performance===key).length}));let turn=0;const slices=distribution.map(d=>{const begin=turn;turn+=d.count/Math.max(1,summary.rows.length)*360;return `${d.color} ${begin}deg ${turn}deg`;});
  const LegendItem=allowDrilldown?'button':'span';
  const brands=individual||performanceOpen?dimension('brand'):[],groups=individual||performanceOpen?dimension('group'):[];
  const compactLimit=3,categoryLimit=individual&&!showAllCategories?compactLimit:undefined;
  const performancePanels=(individual||performanceOpen)&&<div className="goals-chart-grid"><Bars title="Marca" rows={brands} limit={categoryLimit} onSelect={individual||!allowDrilldown?undefined:key=>onFilter('brand',key)}/><Bars title="Grupo de produtos" rows={groups} limit={categoryLimit} onSelect={individual||!allowDrilldown?undefined:key=>onFilter('group',key)}/></div>;
  return <>
    <div className={`goals-chart-grid goal-overview-charts${individual?' individual':''}`}><section className="goal-panel"><Curve title="Evolução acumulada do faturamento" labels={days.map(String)} series={[{name:'Realizado',color:colors[0],values:actual},{name:'Meta ideal',color:colors[1],values:ideal},{name:'Projeção',color:colors[2],values:projected},{name:'Meta total',color:'#9aa7a1',values:labels.map(()=>target)}]}/></section>{!individual&&<section className="goal-panel goal-distribution"><h3>Ritmo dos vendedores</h3><div className="goal-distribution-body"><div className="goal-donut" style={{background:`conic-gradient(${slices.join(',')})`}} role="img" aria-label={distribution.map(d=>`${performanceLabels[d.key]}: ${d.count}`).join(', ')}><span>{summary.rows.length}<small>vendedores</small></span></div><div className="goal-chart-legend">{distribution.map(d=><LegendItem key={d.key} onClick={allowDrilldown?()=>onFilter('performance',d.key):undefined}><i style={{background:d.color}}/>{performanceLabels[d.key]} ({d.count})</LegendItem>)}</div></div></section>}</div>
    {individual?<section className="goal-panel" aria-label="Desempenho por marca e grupo"><h2>Desempenho por marca e grupo</h2>{performancePanels}{(brands.length>compactLimit||groups.length>compactLimit)&&<div className="goal-category-actions"><button type="button" className="secondary" aria-expanded={showAllCategories} onClick={()=>setShowAllCategories(value=>!value)}>{showAllCategories?"Mostrar menos":"Saiba mais"}</button></div>}</section>:<details className="goal-panel" onToggle={e=>setPerformanceOpen(e.currentTarget.open)}><summary>Desempenho por marca e grupo</summary>{performancePanels}</details>}
    <details className="goal-panel" onToggle={e=>setHistoryOpen(e.currentTarget.open)}><summary>Histórico de metas e comparativo anual</summary>{historyOpen&&(!historyReady?<p className="goals-note" role="status">{historyError||'Carregando histórico e comparativos…'}</p>:<><div className="goals-chart-grid"><Curve columns title="Últimos 12 meses" labels={history.map(m=>m.slice(5)+'/'+m.slice(0,4))} series={[{name:'Realizado',color:colors[0],values:monthly},{name:'Meta',color:colors[1],values:historicTargets}]}/><Curve title="Comparativo anual" labels={months} series={[{name:year,color:colors[0],values:annual(year)},{name:String(Number(year)-1),color:colors[1],values:annual(String(Number(year)-1))}]}/></div><div className="goals-table-scroll"><table className="goals-table"><thead><tr><th>Mês</th><th>Meta</th><th>Realizado</th><th>Atingido</th><th>Crescimento anual</th><th>Situação</th></tr></thead><tbody>{history.map((month,i)=>{const period=monthPeriod(month),previous=summary.filteredFacts.filter(f=>f.date.startsWith(`${Number(month.slice(0,4))-1}${month.slice(4)}`)&&(!month.startsWith(today.slice(0,7))||Number(f.date.slice(8))<=Number(today.slice(8)))).reduce((s,f)=>s+f.actual,0),m=goalMetrics(monthly[i],0,historicTargets[i],period.start,period.end,data.settings,today,previous);return <tr key={month}><td>{month.split('-').reverse().join('/')}</td><td>{historicTargets[i]===null?'—':money(historicTargets[i]!)}</td><td>{money(monthly[i])}</td><td>{historicTargets[i]===null?'—':`${Math.round(m.percent)}%`}</td><td>{m.growth===null?'—':`${m.growth.toFixed(1)}%`}</td><td>{performanceLabels[m.performance]}</td></tr>;})}</tbody></table></div><p className="goals-note">No mês em andamento, a comparação anual considera o mesmo dia de corte. Meta histórica exibida apenas para períodos mensais completos equivalentes.</p></>)}</details>
  </>;
}
export function buildGoalReport(data:CentralData,summary:Summary,rows:Summary['rows'],report:string,start:string,end:string){
  if(report==='seller')return {headers:['Vendedor','Regional','Meta','Realizado','Atingido (%)','Carteira','Saldo','Projeção','Crescimento (%)','Situação'],rows:rows.map(r=>[r.seller.name,r.seller.region,r.target??'',r.actual,r.percent,r.wallet,r.remaining,r.projection,r.growth??'',performanceLabels[r.performance]])};
  const key=(f:GoalFact)=>report==='company'?String(f.company):report==='brand'?f.brand:report==='group'?String(f.group):report==='month'?f.date.slice(0,7):report==='year'?f.date.slice(0,4):report==='supervisor'?String(data.catalog.sellers.find(s=>s.id===f.sellerId)?.supervisorId||0):data.catalog.sellers.find(s=>s.id===f.sellerId)?.region||'Sem regional';
  const all=(['month','year'].includes(report)?summary.filteredFacts:summary.facts).filter(f=>f.date<=goalToday()),keys=[...new Set(all.map(key))];
  return {headers:['Agrupamento','Meta','Realizado','Atingido (%)','Carteira','Saldo','Projeção','Crescimento (%)'],rows:keys.map(k=>{
    const selected=all.filter(f=>key(f)===k),actual=selected.reduce((s,f)=>s+f.actual,0),wallet=selected.reduce((s,f)=>s+f.wallet,0);
    const from=report==='month'?k+'-01':report==='year'?k+'-01-01':start,to=report==='month'?monthPeriod(k).end:report==='year'?k+'-12-31':end;
    const campaigns=data.campaigns.filter(c=>!summary.filters.state&&campaignMatches(c,summary.filters,from,to)&&(['month','year'].includes(report)?c.start>=from&&c.end<=to:c.start===from&&c.end===to));
    const targets=campaigns.filter(c=>report==='brand'?c.type==='brand'&&c.brand===k:report==='group'?c.type==='group'&&String(c.group)===k:c.type==='general'&&(report!=='company'||c.companies.length===1&&String(c.companies[0])===k)).flatMap(c=>c.assignments.filter(a=>rows.some(r=>r.seller.id===a.sellerId)&&(report!=='region'||data.catalog.sellers.find(s=>s.id===a.sellerId)?.region===k)&&(report!=='supervisor'||String(data.catalog.sellers.find(s=>s.id===a.sellerId)?.supervisorId)===k)).map(a=>a.targetCents/100));
    const target=targets.length?targets.reduce((a,b)=>a+b,0):null,previous=previousGoalPeriod(from,to),oldKey=report==='month'?shiftMonth(from,-1):report==='year'?String(Number(k)-1):k;
    const previousStart=report==='year'?String(Number(k)-1)+'-01-01':previous.start,previousEnd=report==='year'?`${Number(k)-1}${(goalToday()<to?goalToday():to).slice(4)}`:previous.end;
    const old=summary.filteredFacts.filter(f=>key(f)===oldKey&&f.date>=previousStart&&f.date<=previousEnd),previousValue=old.length?old.reduce((s,f)=>s+f.actual,0):null;
    const m=goalMetrics(actual,wallet,target,from,to,data.settings,goalToday(),previousValue);
    const label=report==='company'?data.catalog.companies.find(c=>String(c.id)===k)?.name||k:report==='group'?data.catalog.groups.find(g=>String(g.id)===k)?.name||k:report==='supervisor'?data.catalog.sellers.find(s=>String(s.id)===k)?.name||`Cód. ${k}`:k;
    return [label,target??'',actual,target===null?'':m.percent,wallet,target===null?'':m.remaining,m.projection,m.growth??''];
  })};
}
