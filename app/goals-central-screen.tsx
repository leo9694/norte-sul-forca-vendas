'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Target, RefreshCw, Download, X, Settings, ChevronRight } from 'lucide-react';
import { currentGoalMonth } from './goals-model';
import { campaignFacts, campaignMatches, emptyGoalFilters, goalMetrics, goalTypes, monthPeriod, performanceLabels, shiftMonth, summarizeGoals, validGoalDate, previousGoalPeriod,
  type CentralData, type GoalCampaign, type GoalFact, type GoalFilters, type GoalSettings, type GoalType } from './goals-central-model';
import { downloadGoalsExcel, downloadGoalsPdf } from './goals-export';
import { GoalCharts, buildGoalReport } from './goals-charts';
import { GoalManagement } from './goals-management';
const money=(v:number|null)=>v===null?'—':v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const pct=(v:number|null)=>v===null?'—':`${v.toLocaleString('pt-BR',{maximumFractionDigits:1})}%`;
type Metrics=ReturnType<typeof goalMetrics>;
type Tab='general'|'seller'|'manage';
type FactResult={facts:GoalFact[];updatedAt:number};
type FactEntry=FactResult&{expires:number};
type FactCache=Record<string,FactEntry>;
const noFacts:GoalFact[]=[];
function rememberFacts(cache:FactCache,key:string,result:FactResult,limit:number){
  const next={...cache};delete next[key];
  next[key]={...result,expires:Date.now()+90000};
  const keys=Object.keys(next);for(const old of keys.slice(0,-limit))delete next[old];
  return next;
}
const ids=(input:string)=>input.split(/[,;\s]+/).filter(Boolean).map(Number);
class GoalRequestError extends Error{constructor(message:string,readonly status:number){super(message);}}
async function requestJson(url:string,init?:RequestInit){const response=await fetch(url,{cache:'no-store',...init}),body=await response.json().catch(()=>null);if(!response.ok)throw new GoalRequestError(body?.error||'Não foi possível concluir.',response.status);if(!body)throw Error('Resposta inválida das metas.');return body;}
export function GoalsScreen({online,onNotice}:{online:boolean;onNotice:(message:string)=>void}){
  const [month,setMonth]=useState(currentGoalMonth),[metadata,setMetadata]=useState<{generation:number;value:CentralData;scope:string}|null>(null),[analytics,setAnalytics]=useState<FactCache>({});
  const [selectedTab,setTab]=useState<Tab>('general'),[filters,setFilters]=useState<GoalFilters>(emptyGoalFilters),[seller,setSeller]=useState('');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0);
  const [sort,setSort]=useState('percent'),[reports,setReports]=useState({general:'seller',seller:'seller'}),[configuring,setConfiguring]=useState(false);
  const [customPeriod,setCustomPeriod]=useState<{start:string;end:string}|null>(null);
  const [history,setHistory]=useState<FactCache>({}),[historyDemand,setHistoryDemand]=useState(''),[historyFailure,setHistoryFailure]=useState<{key:string;message:string}|null>(null);
  const [coreFailure,setCoreFailure]=useState<{key:string;message:string}|null>(null);
  const refreshIntent=useRef({generation:-1,core:false,history:false});
  const {start,end}=customPeriod||monthPeriod(month),previous=previousGoalPeriod(start,end);
  const data=online?metadata?.value:null,metadataReady=metadata?.generation===reload;
  const tab=data&&!data.canViewAll?'seller':selectedTab==='manage'&&!data?.canManage?'general':selectedTab;
  const report=tab==='manage'?'seller':reports[tab];
  const setReport=(value:string)=>{if(tab!=='manage')setReports(old=>({...old,[tab]:value}));};
  const company=tab==='general'?filters.company:'',supervisor=tab==='general'?filters.supervisor:'';
  const activeSeller=data?.catalog.sellers.some(s=>String(s.id)===seller)?seller:String(data?.ownSellerId||'');
  const scopedSeller=tab==='seller'?activeSeller:'';
  const scopeParams=(company?'&company='+company:'')+(supervisor?'&supervisor='+supervisor:'')+(scopedSeller?'&seller='+scopedSeller:'');
  const coreStart=previous.start<start?previous.start:start;
  const coreBaseUrl='/api/goals/central?action=analytics&start='+coreStart+'&end='+end;
  const coreUrl=coreBaseUrl+scopeParams;
  const prefix=(metadata?.scope||'')+'|';
  const key=prefix+coreUrl,broadKey=prefix+coreBaseUrl;
  const priorJanuary=(Number(start.slice(0,4))-1)+'-01-01',priorHistory=shiftMonth(start,-23)+'-01',yearEnd=start.slice(0,4)+'-12-31';
  const historyStart=tab==='manage'?shiftMonth(start,-6)+'-01':priorJanuary<priorHistory?priorJanuary:priorHistory;
  const historyEnd=tab==='manage'?monthPeriod(shiftMonth(start,-1)).end:end>yearEnd?end:yearEnd;
  const historyUrl='/api/goals/central?action=analytics&start='+historyStart+'&end='+historyEnd+scopeParams+(tab==='manage'?'&series=sales':'');
  const historyKey=prefix+historyUrl;
  const broad=analytics[broadKey];
  const exact=analytics[key];
  const core=exact&&(!broad||exact.expires>=broad.expires)?exact:broad;
  const longHistory=history[historyKey],historyReady=!!data&&!!longHistory;
  const wantsHistory=historyDemand===historyKey||report==='month'||report==='year';
  const facts=useMemo(()=>{
    const coreFacts=core?.facts??noFacts;
    return tab==='manage'?longHistory?.facts??noFacts:longHistory?[...coreFacts,...longHistory.facts.filter(f=>!core||f.date<coreStart||f.date>end)]:coreFacts;
  },[tab,core,longHistory,coreStart,end]);
  const updated=core?.updatedAt??0,historyError=historyFailure?.key===historyKey?historyFailure.message:'';
  const analyticsError=tab!=='manage'&&coreFailure?.key===key?coreFailure.message:'';
  const loading=online&&!data&&!error,analyticsBusy=tab!=='manage'&&online&&!!data&&!core&&!analyticsError&&!error;
  const requestHistory=useCallback(()=>setHistoryDemand(historyKey),[historyKey]);
  const rejectAccess=useCallback((e:unknown)=>{
    if(!(e instanceof GoalRequestError)||![401,403].includes(e.status))return false;
    setMetadata(null);setAnalytics({});setHistory({});setError(e.message);return true;
  },[]);
  const refresh=()=>{refreshIntent.current={generation:reload+1,core:true,history:true};setError('');setReload(v=>v+1);};
  useEffect(()=>{
    if(!online)return;const controller=new AbortController();
    const refreshCatalog=refreshIntent.current.generation===reload;
    requestJson('/api/goals/central'+(refreshCatalog?'?refresh=1':''),{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(45000)])}).then(body=>{
      if(controller.signal.aborted)return;
      const scope=JSON.stringify([body.ownSellerId,body.canViewAll,body.canManage,body.settings.version,body.settings.companies,body.catalog.sellers.map((s:{id:number;supervisorId:number})=>[s.id,s.supervisorId])]);
      setError('');setMetadata({generation:reload,value:body,scope});
    }).catch(e=>{if(!controller.signal.aborted&&!rejectAccess(e))setError(e.name==='TimeoutError'?'A consulta demorou demais. Tente atualizar.':e.message);});
    return()=>controller.abort();
  },[online,reload,rejectAccess]);
  useEffect(()=>{
    if(!data||!metadataReady||tab==='manage')return;
    const force=refreshIntent.current.generation===reload&&refreshIntent.current.core;
    if(!force&&core&&core.expires>Date.now())return;
    const controller=new AbortController();
    if(force)refreshIntent.current.core=false;
    requestJson(coreUrl+(force?'&refresh=1':''),{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(180000)])})
      .then(result=>{if(!controller.signal.aborted){setCoreFailure(null);setAnalytics(old=>rememberFacts(old,key,result,8));}})
      .catch(e=>{if(!controller.signal.aborted&&!rejectAccess(e))setCoreFailure({key,message:e.name==='TimeoutError'?'A apuração demorou demais. Tente atualizar.':e.message});});
    return()=>controller.abort();
  },[data,metadataReady,tab,key,coreUrl,core,reload,rejectAccess]);
  useEffect(()=>{
    if(!data||!metadataReady||!wantsHistory)return;
    const force=refreshIntent.current.generation===reload&&refreshIntent.current.history;
    if(!force&&longHistory&&longHistory.expires>Date.now())return;
    const controller=new AbortController();
    if(force)refreshIntent.current.history=false;
    requestJson(historyUrl+(force?'&refresh=1':''),{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(180000)])})
      .then(result=>{if(!controller.signal.aborted){setHistoryFailure(null);setHistory(old=>rememberFacts(old,historyKey,result,3));}})
      .catch(e=>{if(!controller.signal.aborted&&!rejectAccess(e))setHistoryFailure({key:historyKey,message:e.name==='TimeoutError'?'O histórico demorou demais. Atualize para tentar novamente.':e.message});});
    return()=>controller.abort();
  },[data,metadataReady,wantsHistory,longHistory,historyKey,historyUrl,reload,rejectAccess]);
  const mutate=async(changes:GoalCampaign[]|null,settings?:GoalSettings)=>{
    if(busy||!online)return false;setBusy(true);setError('');
    try{await requestJson('/api/goals/central',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(settings?{action:'settings',settings}:{changes})});setReload(v=>v+1);onNotice(settings?'Configuração salva.':'Metas salvas com sucesso.');return true;}
    catch(e){setError(e instanceof Error?e.message:'Falha ao salvar metas.');return false;}finally{setBusy(false);}
  };
  const effective=useMemo(()=>({...emptyGoalFilters,seller:scopedSeller,company,supervisor}),[scopedSeller,company,supervisor]);
  const summary=useMemo(()=>data&&core&&tab!=='manage'?summarizeGoals(data,facts,effective,start,end):null,[data,core,tab,facts,effective,start,end]);
  const changeFilter=(key:keyof GoalFilters,value:string)=>setFilters(f=>({...f,[key]:value}));
  const activateTab=(next:Tab)=>{setError('');setTab(next);};
  const rows=[...(summary?.rows||[])].sort((a,b)=>Number(b[sort as keyof typeof b]||0)-Number(a[sort as keyof typeof a]||0));
  const reportNeedsHistory=report==='month'||report==='year';
  const reportData=()=>buildGoalReport(data!,summary!,rows,report,start,end);
  const exportReport=async(pdf=false)=>{if(reportNeedsHistory&&!historyReady){requestHistory();return;}try{const r=reportData();if(pdf)await downloadGoalsPdf(`Metas · ${month}`,r.headers,r.rows.map(row=>row.map(v=>typeof v==='number'?v.toLocaleString('pt-BR',{maximumFractionDigits:2}):v)));else downloadGoalsExcel([r.headers,...r.rows],`metas-${month}`);}catch{onNotice('Não foi possível gerar o arquivo.');}};
  return <div className="page goals-page">
    <div className="section-heading goals-heading"><div><h1>{data&&!data.canViewAll?'Minhas metas':'Metas'}</h1></div><div className="goals-toolbar"><label>Período<input aria-label="Mês das metas" type="month" min="2002-01" max="2099-12" value={month} disabled={busy} onChange={e=>{if(e.target.value){setError('');setCustomPeriod(null);setMonth(e.target.value);}}}/></label><button className="secondary" disabled={busy||loading||analyticsBusy||!online||(!!data&&!metadataReady&&!error)} onClick={refresh}><RefreshCw size={15}/> Atualizar</button>{data?.canConfigure&&<button className="icon-button" aria-label="Configurar apuração" onClick={()=>setConfiguring(true)}><Settings size={19}/></button>}</div></div>
    {(!online||error||analyticsError)&&<div className="global-error" role="alert">{!online?'Conecte-se para consultar as metas atualizadas.':error||analyticsError}</div>}{loading&&<div className="empty-state">Carregando metas…</div>}
    {data&&<>
      {(data.canViewAll||data.canManage)&&<nav className="goals-tabs" aria-label="Seções de metas">{data.canViewAll&&<button aria-current={tab==='general'?'page':undefined} onClick={()=>activateTab('general')}>Acompanhamento geral</button>}<button aria-current={tab==='seller'?'page':undefined} onClick={()=>activateTab('seller')}>{data.canViewAll?'Metas por vendedor':'Minhas metas'}</button>{data.canManage&&<button aria-current={tab==='manage'?'page':undefined} onClick={()=>activateTab('manage')}>Gestão de metas</button>}</nav>}
      {data.canManage&&<div hidden={tab!=='manage'}><GoalManagement data={data} facts={facts} month={month} period={{start,end}} busy={busy} historyReady={tab==='manage'&&historyReady} historyError={tab==='manage'?historyError:''} onHistoryNeeded={tab==='manage'?requestHistory:undefined} saveError={error} onSave={mutate} onError={setError}/></div>}
      {tab!=='manage'&&<>
        <div className="goals-filter-panel">
        <div className={tab==='seller'?'goals-filters goals-seller-filters':'goals-filters'}>
          {tab==='seller'&&data.canViewAll&&<label>Vendedor<select value={activeSeller} onChange={e=>setSeller(e.target.value)}>{data.catalog.sellers.filter(s=>s.active||String(s.id)===activeSeller).map(s=><option key={s.id} value={s.id}>{s.name}{!s.active?' · Inativo':''}</option>)}</select></label>}
          {tab==='general'&&<>
          <label>Empresa<select value={filters.company} onChange={e=>changeFilter('company',e.target.value)}><option value="">Todas autorizadas</option>{data.catalog.companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          {data.canViewAll&&<label>Supervisor<select value={filters.supervisor} onChange={e=>changeFilter('supervisor',e.target.value)}><option value="">Todos</option>{data.catalog.sellers.filter(s=>s.active&&data.catalog.sellers.some(v=>v.supervisorId===s.id)).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
          <button className="text-button" disabled={!filters.company&&!filters.supervisor} onClick={()=>setFilters(emptyGoalFilters)}>Limpar</button>
          </>}
        </div>
        <details className="goals-period"><summary>Datas personalizadas{customPeriod?` · ${start} a ${end}`:''}</summary><form className="goals-toolbar" onSubmit={event=>{event.preventDefault();const fields=new FormData(event.currentTarget),from=String(fields.get('start')),to=String(fields.get('end'));if(!validGoalDate(from)||!validGoalDate(to)||from>to||Number(from.slice(0,4))<2002||(Date.parse(to)-Date.parse(from))/86400000>366){setError('Selecione um período válido de até 366 dias, a partir de 2002.');return;}setError('');setCustomPeriod({start:from,end:to});}}><label>Início<input key={start} name="start" type="date" required defaultValue={start}/></label><label>Fim<input key={end} name="end" type="date" required defaultValue={end}/></label><button className="secondary" disabled={busy}>Aplicar período</button>{customPeriod&&<button type="button" className="text-button" onClick={()=>setCustomPeriod(null)}>Voltar ao mês</button>}</form></details>
        </div>
        {analyticsBusy?<div className="empty-state" role="status">Carregando desempenho…</div>:updated>0&&summary&&<>
          {tab==='seller'?<><h2 className="goals-seller-title">{data.catalog.sellers.find(s=>String(s.id)===activeSeller)?.name||'Minhas metas'}</h2><MetricCards metrics={summary.totals}/><CampaignCards data={data} facts={facts} filters={effective} start={start} end={end}/></>:<MetricCards metrics={summary.totals}/> }
          <GoalCharts key={key} data={data} summary={summary} start={start} end={end} individual={tab==='seller'} onFilter={changeFilter} allowDrilldown={false} historyReady={historyReady} historyError={historyError} onHistoryNeeded={requestHistory}/>
          {tab==='general'&&<section className="goal-panel"><div className="goals-panel-heading"><h2>Ranking de vendedores</h2><label>Ordenar por<select value={sort} onChange={e=>setSort(e.target.value)}><option value="percent">Percentual atingido</option><option value="actual">Faturamento</option><option value="growth">Crescimento</option><option value="projection">Projeção</option></select></label></div><div className="goals-table-scroll"><table className="goals-table"><thead><tr>{['#','Vendedor / regional','Meta','Realizado','Atingido','Carteira','Saldo','Projeção','Crescimento','Situação'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={r.seller.id}><td>{i+1}</td><td><button className="text-button" onClick={()=>{setSeller(String(r.seller.id));setTab('seller');}}>{r.seller.name}<ChevronRight size={12}/></button><small>{r.seller.region}</small></td><td>{money(r.target)}</td><td>{money(r.actual)}</td><td><span>{r.target===null?'—':pct(r.percent)}</span><progress max="100" value={Math.min(100,r.percent)}/></td><td>{money(r.wallet)}</td><td>{r.target===null?'—':money(r.remaining)}</td><td>{money(r.projection)}</td><td>{pct(r.growth)}</td><td><PerformanceTag metrics={r}/></td></tr>)}</tbody></table></div>{!rows.length&&<p className="empty-state">Nenhum vendedor para estes filtros.</p>}</section>}
          <details className="goal-panel"><summary>Exportar relatório</summary><div className="goals-toolbar"><label>Agrupar por<select value={report} onChange={e=>setReport(e.target.value)}>{[['seller','Vendedor'],['region','Regional'],['supervisor','Supervisor'],['company','Empresa'],['brand','Marca'],['group','Grupo de produtos'],['month','Comparativo mensal'],['year','Comparativo anual']].filter(([k])=>data.canViewAll||!['region','supervisor'].includes(k)).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><button className="secondary" disabled={reportNeedsHistory&&!historyReady} onClick={()=>void exportReport()}><Download size={15}/> Excel</button><button className="secondary" disabled={reportNeedsHistory&&!historyReady} onClick={()=>void exportReport(true)}>PDF</button></div>{reportNeedsHistory&&!historyReady&&<p className="goals-note" role="status">{historyError||'Carregando histórico para exportação…'}</p>}</details>
        </>}
        <div className="goals-footnote">{updated>0&&<small>Atualizado às {new Date(updated).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</small>}<details><summary>Critérios de apuração</summary><p>Dias úteis descontam os feriados configurados. A carteira considera o saldo atual dos pedidos do período. Metas são comparadas em períodos equivalentes, sem rateio por empresa ou UF.</p><p>Empresas {data.settings.companies.join(', ')} · Vendas confirmadas: TOPs {data.settings.saleTops.join(', ')}. Devoluções somente com vínculo ao item de uma venda elegível{data.settings.returnTops.length?`, TOPs ${data.settings.returnTops.join(', ')}`:''}; devoluções sem vínculo precisam de validação comercial e não são presumidas. Carteira: TOPs {data.settings.orderTops.join(', ')}, apenas saldo pendente. Valores de cabeçalho rateados pelos itens líquidos. Vendas diretas não possuem distinção validada neste módulo.</p></details></div>
      </>}
      {configuring&&data.canConfigure&&<SettingsPanel settings={data.settings} busy={busy} serverError={error} onClose={()=>setConfiguring(false)} onSave={async settings=>{if(await mutate(null,settings))setConfiguring(false);}}/>}
    </>}
  </div>;
}
function PerformanceTag({metrics}:{metrics:Metrics}){return <span className={`goal-status ${metrics.performance}`}>{performanceLabels[metrics.performance]}</span>;}
function MetricCards({metrics:m}:{metrics:Metrics}){
  return <><section className="goal-kpis">{[['Meta',money(m.target)],['Faturamento',money(m.actual)],['Atingido',m.target===null?'—':pct(m.percent)],['Faltam',m.target===null?'—':money(m.remaining)],['Em carteira',money(m.wallet)],['Potencial',money(m.potential)],['Projeção',money(m.projection)],['Média diária necessária',m.target===null?'—':money(m.dailyNeeded)]].map(([label,value])=><article key={label}><small>{label}</small><strong>{value}</strong></article>)}</section><div className="goal-main-progress"><progress max="100" value={Math.min(100,m.percent)} aria-label="Progresso geral da meta"/><PerformanceTag metrics={m}/><small>{m.elapsed} de {m.total} dias úteis · {m.total-m.elapsed} restantes</small></div></>;
}
function CampaignCards({data,facts,filters,start,end}:{data:CentralData;facts:GoalFact[];filters:GoalFilters;start:string;end:string}){
  return <>{(['general','brand','group','combined'] as GoalType[]).map(type=>{
    const campaigns=data.campaigns.filter(c=>!filters.state&&c.type===type&&campaignMatches(c,filters,start,end)&&c.assignments.some(a=>String(a.sellerId)===filters.seller));
    if(!campaigns.length)return null;
    return <section key={type}><h2 className="goals-subheading">{goalTypes[type]}</h2><div className="goals-grid goal-campaign-grid">{campaigns.map(c=>{
      const a=c.assignments.find(a=>String(a.sellerId)===filters.seller)!,own=facts.filter(f=>String(f.sellerId)===filters.seller&&campaignFacts(f,c)&&(!filters.company||f.company===Number(filters.company))&&(!filters.state||f.state===filters.state)&&(!filters.brand||f.brand===filters.brand)&&(!filters.group||f.group===Number(filters.group)));
      const m=goalMetrics(own.reduce((s,f)=>s+f.actual,0),own.reduce((s,f)=>s+f.wallet,0),a.targetCents/100,c.start,c.end,data.settings);
      return <article className="goal-card" key={c.id}><header><Target size={19}/><div><h2>{c.description}</h2><small>{c.brand||data.catalog.groups.find(g=>g.id===c.group)?.name||'Meta geral'} · {c.start.split('-').reverse().join('/')} a {c.end.split('-').reverse().join('/')}</small></div></header><div className="goal-values"><span><small>Realizado</small><strong>{money(m.actual)}</strong></span><span><small>Meta</small><strong>{money(m.target)}</strong></span></div><progress max="100" value={Math.min(100,m.percent)}/><div className="goal-progress"><strong>{pct(m.percent)}</strong><span>Faltam {money(m.remaining)}</span></div><p className="goals-note">Carteira {money(m.wallet)} · Projeção {money(m.projection)}</p><PerformanceTag metrics={m}/>{c.notes&&<p className="goals-note">{c.notes}</p>}</article>;
    })}</div></section>;
  })}</>;
}
function SettingsPanel({settings,busy,serverError,onSave,onClose}:{settings:GoalSettings;busy:boolean;serverError:string;onSave:(s:GoalSettings)=>void;onClose:()=>void}){
  const fields=[['companies','Empresas elegíveis'],['saleTops','TOPs de venda'],['orderTops','TOPs da carteira'],['returnTops','TOPs de devolução (vazio: todas com vínculo à venda)']] as const;
  const [s,set]=useState(settings),[scopes,setScopes]=useState(JSON.stringify(settings.userCompanies,null,2)),[error,setError]=useState('');
  const [text,setText]=useState<Record<string,string>>(()=>Object.fromEntries(fields.map(([k])=>[k,settings[k].join(', ')]))),[holidays,setHolidays]=useState(settings.holidays.join(', '));
  return <div className="modal-backdrop"><form className="goal-modal" role="dialog" aria-modal="true" aria-label="Configurar apuração" onSubmit={e=>{
    e.preventDefault();try{onSave({...s,...Object.fromEntries(fields.map(([k])=>[k,ids(text[k])])),holidays:holidays.split(/[,;\s]+/).filter(Boolean),userCompanies:JSON.parse(scopes)});}catch{setError('Informe um JSON válido para as empresas por usuário.');}
  }}><header><h2>Configurar apuração</h2><button type="button" className="icon-button" disabled={busy} onClick={onClose} aria-label="Fechar"><X/></button></header><p className="goals-note">Estas regras afetam somente as metas, nunca os pedidos ou o ERP.</p>{(error||serverError)&&<p className="global-error" role="alert">{error||serverError}</p>}
    {fields.map(([k,label])=><label key={k}>{label}<input disabled={busy} value={text[k]} onChange={e=>setText({...text,[k]:e.target.value})}/></label>)}<div className="goals-two"><label>Dentro do ritmo (% esperado)<input type="number" min="1" max="100" value={s.onTrack} onChange={e=>set({...s,onTrack:Number(e.target.value)})}/></label><label>Atenção (% esperado)<input type="number" min="0" max="99" value={s.attention} onChange={e=>set({...s,attention:Number(e.target.value)})}/></label></div><label>Feriados (AAAA-MM-DD, separados por vírgula)<textarea value={holidays} onChange={e=>setHolidays(e.target.value)}/></label><label>Empresas por usuário (JSON: código do usuário → empresas)<textarea value={scopes} onChange={e=>setScopes(e.target.value)}/></label><footer><button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancelar</button><button className="primary" disabled={busy}>Salvar configuração</button></footer></form></div>;
}
