export type GoalType = 'general' | 'brand' | 'group' | 'combined';
export type GoalStatus = 'draft' | 'scheduled' | 'active' | 'closed' | 'cancelled';
export type Performance = 'achieved' | 'on-track' | 'attention' | 'critical' | 'no-goal';
export const goalTypes: Record<GoalType,string> = {general:'Venda geral',brand:'Marca',group:'Grupo de produtos',combined:'Marca + grupo'};
export const goalStatuses: Record<GoalStatus,string> = {draft:'Rascunho',scheduled:'Programada',active:'Ativa',closed:'Encerrada',cancelled:'Cancelada'};
export const performanceLabels: Record<Performance,string> = {achieved:'Meta atingida','on-track':'Dentro do ritmo',attention:'Atenção',critical:'Crítico','no-goal':'Sem meta'};
export type GoalAssignment = {sellerId:number;targetCents:number};
export type GoalCampaign = {id:string;description:string;type:GoalType;companies:number[];start:string;end:string;brand:string;group:number;
  status:GoalStatus;notes:string;version:number;assignments:GoalAssignment[];createdBy:number;createdName:string;createdAt:number;updatedAt:number;editable?:boolean;
  allocation?:{parentId:string;basisPoints:number}};
export type GoalSettings = {companies:number[];saleTops:number[];orderTops:number[];returnTops:number[];holidays:string[];onTrack:number;attention:number;supervisorEditors:number[];userCompanies:Record<string,number[]>;version:number};
export const defaultGoalSettings: GoalSettings = {companies:[1,6,8],saleTops:[35],orderTops:[5],returnTops:[],holidays:[],onTrack:90,attention:70,supervisorEditors:[],userCompanies:{},version:0};
export type GoalSeller = {id:number;name:string;active:boolean;region:string;regionId:number;supervisorId:number;company:number};
export type GoalFact = {date:string;sellerId:number;company:number;brand:string;group:number;state:string;actual:number;wallet:number};
export type GoalCatalog = {sellers:GoalSeller[];companies:{id:number;name:string}[];brands:string[];groups:{id:number;name:string}[]};
export type CentralData = {canViewAll:boolean;canManage:boolean;canConfigure:boolean;ownSellerId:number;campaigns:GoalCampaign[];catalog:GoalCatalog;
  settings:GoalSettings;updatedAt:number};
export type GoalFilters = {company:string;state:string;region:string;supervisor:string;seller:string;brand:string;group:string;type:string;performance:string};
export const emptyGoalFilters: GoalFilters={company:'',state:'',region:'',supervisor:'',seller:'',brand:'',group:'',type:'',performance:''};
export const validGoalDate=(value:unknown):value is string=>typeof value==='string' && /^20\d{2}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
export const goalToday=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Cuiaba',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function monthPeriod(month:string){const start=month+'-01',date=new Date(start+'T12:00:00Z');date.setUTCMonth(date.getUTCMonth()+1,0);return {start,end:date.toISOString().slice(0,10)};}
export function shiftMonth(date:string,delta:number){const d=new Date(date.slice(0,7)+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+delta);return d.toISOString().slice(0,7);}
export function businessCalendar(start:string,end:string,today=goalToday(),holidays:string[]=[]){
  let total=0,elapsed=0;const excluded=new Set(holidays);
  for(let d=new Date(start+'T12:00:00Z');d.toISOString().slice(0,10)<=end;d.setUTCDate(d.getUTCDate()+1)){
    const day=d.toISOString().slice(0,10);if(d.getUTCDay()===0||d.getUTCDay()===6||excluded.has(day))continue;total++;if(day<=today)elapsed++;
  }
  return {total,elapsed,daysRemaining:Math.max(0,total-elapsed),fraction:total?elapsed/total:0};
}
export function goalMetrics(actual:number,wallet:number,target:number|null,start:string,end:string,settings:Pick<GoalSettings,'holidays'|'onTrack'|'attention'>,today=goalToday(),previous:number|null=null,calendar=businessCalendar(start,end,today,settings.holidays)){
  const percent=target!==null&&target>0?actual/target*100:0;
  const remaining=target===null?0:Math.max(0,target-actual),expected=(target||0)*calendar.fraction;
  const performance:Performance=target===null?'no-goal':actual>=target?'achieved':expected<=0?'on-track':actual>=expected*settings.onTrack/100?'on-track':actual>=expected*settings.attention/100?'attention':'critical';
  return {actual,wallet,target,percent,remaining,potential:actual+wallet,projection:calendar.elapsed?actual/calendar.elapsed*calendar.total:0,
    dailyNeeded:calendar.daysRemaining?remaining/calendar.daysRemaining:null,growth:previous!==null&&previous>0?(actual/previous-1)*100:null,performance,...calendar};
}
export function factMatches(fact:GoalFact,filters:GoalFilters,sellers:ReadonlyMap<number,GoalSeller>){
  const seller=sellers.get(fact.sellerId);
  return (!filters.company||fact.company===Number(filters.company))&&(!filters.state||fact.state===filters.state)&&(!filters.region||seller?.region===filters.region)
    &&(!filters.supervisor||seller?.supervisorId===Number(filters.supervisor))&&(!filters.seller||fact.sellerId===Number(filters.seller))
    &&(!filters.brand||fact.brand===filters.brand)&&(!filters.group||fact.group===Number(filters.group));
}
export function campaignMatches(c:GoalCampaign,f:GoalFilters,start:string,end:string){
  return c.status!=='cancelled'&&c.status!=='draft'&&c.start<=end&&c.end>=start&&(!f.type||c.type===f.type)
    &&(!f.company||c.companies.length===1&&c.companies.includes(Number(f.company)))&&(!f.brand||c.brand===f.brand)&&(!f.group||c.group===Number(f.group));
}
export function campaignFacts(f:GoalFact,c:GoalCampaign){return c.companies.includes(f.company)&&(!c.brand||f.brand===c.brand)&&(!c.group||f.group===c.group)&&f.date>=c.start&&f.date<=c.end;}
export function equivalentEnd(start:string,end:string,previousStart:string,today=goalToday()){
  const elapsed=Math.max(0,Math.round((Date.parse((today<end?today:end)+'T12:00:00Z')-Date.parse(start+'T12:00:00Z'))/86400000));
  const date=new Date(previousStart+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+elapsed);return date.toISOString().slice(0,10);
}
export function previousGoalPeriod(start:string,end:string,today=goalToday()){
  if(start.endsWith('-01')&&end===monthPeriod(start.slice(0,7)).end){
    const from=shiftMonth(start,-1)+'-01',limit=monthPeriod(from.slice(0,7)).end,cut=equivalentEnd(start,end,from,today);
    return {start:from,end:today<start?'':today>=end?limit:cut<limit?cut:limit};
  }
  const days=(Date.parse(end)-Date.parse(start))/86400000+1,d=new Date(start+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-days);const from=d.toISOString().slice(0,10);
  return {start:from,end:today<start?'':equivalentEnd(start,end,from,today)};
}
export function summarizeGoals(data:CentralData,facts:GoalFact[],filters:GoalFilters,start:string,end:string,today=goalToday()){
  const directory=new Map(data.catalog.sellers.map(s=>[s.id,s]));
  const filtered=facts.filter(f=>factMatches(f,filters,directory));
  const selected=data.campaigns.filter(c=>campaignMatches(c,filters,start,end));
  // Alvos de categorias sobrepostas nunca entram na meta consolidada geral.
  const relevant=selected.filter(c=>!filters.state&&c.start===start&&c.end===end&&(filters.type?c.type===filters.type:(filters.brand||filters.group)?c.type===(filters.brand&&filters.group?'combined':filters.brand?'brand':'group'):c.type==='general'));
  const eligible=(f:GoalFact)=>!filters.type||filters.type==='general'||relevant.some(c=>c.companies.includes(f.company)&&(!c.brand||c.brand===f.brand)&&(!c.group||c.group===f.group));
  const previous=previousGoalPeriod(start,end,today);
  const calendar=businessCalendar(start,end,today,data.settings.holidays);
  const periodFacts:GoalFact[]=[],eligibleFacts:GoalFact[]=[];
  const periodTotals=new Map<number,{actual:number;wallet:number}>(),priorTotals=new Map<number,number>(),targetsBySeller=new Map<number,number>();
  for(const c of relevant)for(const a of c.assignments)targetsBySeller.set(a.sellerId,(targetsBySeller.get(a.sellerId)??0)+a.targetCents/100);
  for(const f of filtered){
    if(!eligible(f))continue;
    eligibleFacts.push(f);
    if(f.date>=start&&f.date<=end&&f.date<=today){
      periodFacts.push(f);
      const sum=periodTotals.get(f.sellerId);
      if(sum){sum.actual+=f.actual;sum.wallet+=f.wallet;}
      else periodTotals.set(f.sellerId,{actual:f.actual,wallet:f.wallet});
    }
    if(f.date>=previous.start&&f.date<=previous.end)priorTotals.set(f.sellerId,(priorTotals.get(f.sellerId)??0)+f.actual);
  }
  const historicalIds=new Set([...periodFacts.map(f=>f.sellerId),...selected.flatMap(c=>c.assignments.map(a=>a.sellerId))]);
  const sellers=data.catalog.sellers.filter(s=>(s.active||historicalIds.has(s.id))&&(!filters.seller||s.id===Number(filters.seller))&&(!filters.region||s.region===filters.region)&&(!filters.supervisor||s.supervisorId===Number(filters.supervisor)));
  let rows=sellers.map(seller=>{
    const own=periodTotals.get(seller.id);
    return {seller,...goalMetrics(own?.actual??0,own?.wallet??0,targetsBySeller.get(seller.id)??null,start,end,data.settings,today,priorTotals.get(seller.id)??null,calendar)};
  });
  if(filters.performance)rows=rows.filter(r=>r.performance===filters.performance);
  const ids=new Set(rows.map(r=>r.seller.id)),visibleFacts=periodFacts.filter(f=>ids.has(f.sellerId));
  const targets=rows.filter(r=>r.target!==null),target=targets.length?targets.reduce((s,r)=>s+r.target!,0):null;
  const totals=goalMetrics(rows.reduce((s,r)=>s+r.actual,0),rows.reduce((s,r)=>s+r.wallet,0),target,start,end,data.settings,today,null,calendar);
  return {rows,facts:visibleFacts,filteredFacts:eligibleFacts.filter(f=>ids.has(f.sellerId)),selected,totals,filters};
}
export function parseMatrixPaste(text:string){return text.replace(/\r/g,'').trimEnd().split('\n').map(line=>line.split('\t'));}
