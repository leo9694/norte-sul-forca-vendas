import { executeQuery, type SankhyaSession } from './sankhya';
import { readGoalQueryRows } from './goals-query';
import { type GoalSettings, type GoalSeller, type GoalFact, type GoalCatalog } from '../../goals-central-model';
export async function goalAccess(session:SankhyaSession,settings:GoalSettings){
  const roles=await executeQuery(session,`SELECT G.NOMEGRUPO,V.TIPVEND FROM TSIUSU U LEFT JOIN TSIGRU G ON G.CODGRUPO=U.CODGRUPO LEFT JOIN TGFVEN V ON V.CODVEND=U.CODVEND WHERE U.CODUSU=${session.userId}`);
  const role=String(roles[0]?.NOMEGRUPO||'').trim().toLowerCase();
  const sellerType=String(roles[0]?.TIPVEND||'').trim().toLowerCase();
  const broad=role==='diretoria'||role==='gerente'||role==='supervisor'||sellerType==='s'||sellerType==='supervisor';
  const ids=await executeQuery(session,`SELECT V.CODVEND,V.APELIDO,V.ATIVO,V.CODGER,V.CODREG,V.CODEMP,NVL(R.NOMEREG,'Sem regional') NOMEREG
    FROM TGFVEN V LEFT JOIN TSIREG R ON R.CODREG=V.CODREG WHERE V.CODVEND IN (
      ${broad?'SELECT CODVEND FROM TGFVEN WHERE CODVEND>0':`SELECT ${session.sellerId} FROM DUAL`}) ORDER BY V.APELIDO`);
  const companies=settings.userCompanies[String(session.userId)]||settings.companies;
  const sellers:GoalSeller[]=ids.map(row=>({id:Number(row.CODVEND),name:String(row.APELIDO),active:row.ATIVO==='S',supervisorId:Number(row.CODGER||0),regionId:Number(row.CODREG||0),region:String(row.NOMEREG),company:Number(row.CODEMP||0)}));
  return {canViewAll:broad,canManage:broad,canConfigure:broad,
    sellerIds:sellers.map(s=>s.id),sellers,companies:settings.companies.filter(id=>companies.includes(id))};
}
export type GoalAccess=Awaited<ReturnType<typeof goalAccess>>;
type CatalogLabels=Omit<GoalCatalog,'sellers'>;
const catalogLabels=new Map<string,{until:number;result:Promise<CatalogLabels>}>();
async function queryCatalogLabels(session:SankhyaSession,access:GoalAccess):Promise<CatalogLabels>{
  const [companies,brands,groups]=await Promise.all([
    executeQuery(session,`SELECT CODEMP,NOMEFANTASIA FROM TSIEMP WHERE CODEMP IN (${access.companies.join(',')||'NULL'}) ORDER BY CODEMP`),
    executeQuery(session,`SELECT DISTINCT TRIM(MARCA) MARCA FROM TGFPRO WHERE ATIVO='S' AND MARCA IS NOT NULL ORDER BY MARCA`),
    executeQuery(session,`SELECT CODGRUPOPROD,DESCRGRUPOPROD FROM TGFGRU WHERE ATIVO='S' ORDER BY DESCRGRUPOPROD`),
  ]);
  return {companies:companies.map(r=>({id:Number(r.CODEMP),name:String(r.NOMEFANTASIA)})),brands:brands.map(r=>String(r.MARCA)),groups:groups.map(r=>({id:Number(r.CODGRUPOPROD),name:String(r.DESCRGRUPOPROD)}))};
}
export async function goalCatalog(session:SankhyaSession,access:GoalAccess,reuseLabels=false,refresh=false):Promise<GoalCatalog>{
  // Permissões e equipe são sempre as da requisição atual. Escritas validam o catálogo ao vivo.
  if(!reuseLabels)return {sellers:access.sellers,...await queryCatalogLabels(session,access)};
  const key=JSON.stringify([session.userId,[...access.companies].sort((a,b)=>a-b)]),saved=catalogLabels.get(key);
  if(!refresh&&saved&&saved.until>Date.now())return {sellers:access.sellers,...await saved.result};
  const result=queryCatalogLabels(session,access);
  if(catalogLabels.size>=16)catalogLabels.delete(catalogLabels.keys().next().value!);
  catalogLabels.set(key,{until:Date.now()+60000,result});
  try{return {sellers:access.sellers,...await result};}
  catch(error){if(catalogLabels.get(key)?.result===result)catalogLabels.delete(key);throw error;}
}
export function goalFactsSql(start:string,end:string,access:Pick<GoalAccess,'sellerIds'|'companies'>,settings:GoalSettings,wallet=false,monthly=false){
  const date=wallet?'C.DTNEG':'NVL(C.DTENTSAI,C.DTNEG)',sales=settings.saleTops.join(',')||'NULL',orders=settings.orderTops.join(',')||'NULL';
  // VLRNOTA é rateado pelos itens líquidos: a soma das categorias reconcilia com o cabeçalho.
  const net='(NVL(I.VLRTOT,0)-NVL(I.VLRDESC,0))';
  const amount=`CASE WHEN N.NET_TOTAL<>0 THEN C.VLRNOTA*${net}/N.NET_TOTAL ELSE 0 END`;
  const delivered=`GREATEST(NVL(I.QTDENTREGUE,0),NVL(D.DELIVERED,0))`;
  const value=wallet?`${amount}*CASE WHEN I.QTDNEG>0 THEN GREATEST(0,I.QTDNEG-${delivered})/I.QTDNEG ELSE 0 END`:`${amount}*CASE WHEN C.TIPMOV='D' THEN -1 ELSE 1 END`;
  const eligibility=wallet?`C.TIPMOV='P' AND C.CODTIPOPER IN (${orders}) AND C.PENDENTE='S' AND I.PENDENTE='S'`:
    `((C.TIPMOV='V' AND C.CODTIPOPER IN (${sales})) OR (C.TIPMOV='D' ${settings.returnTops.length?`AND C.CODTIPOPER IN (${settings.returnTops.join(',')})`:''}
      AND EXISTS (SELECT 1 FROM TGFVAR RV JOIN TGFCAB ORIG ON ORIG.NUNOTA=RV.NUNOTAORIG WHERE RV.NUNOTA=C.NUNOTA AND RV.SEQUENCIA=I.SEQUENCIA AND ORIG.TIPMOV='V' AND ORIG.CODTIPOPER IN (${sales}) AND ORIG.STATUSNOTA='L'))) `;
  const common=`C.STATUSNOTA='L' AND ${wallet?"NVL(C.STATUSNFE,'A')<>'D'":"NVL(C.STATUSNFE,'M') IN ('A','M','T')"}
    AND C.CODEMP IN (${access.companies.join(',')||'NULL'}) AND C.CODVEND IN (${access.sellerIds.join(',')||'NULL'})
    AND ${wallet?`C.TIPMOV='P' AND C.CODTIPOPER IN (${orders}) AND C.PENDENTE='S'`:`((C.TIPMOV='V' AND C.CODTIPOPER IN (${sales})) OR (C.TIPMOV='D' ${settings.returnTops.length?`AND C.CODTIPOPER IN (${settings.returnTops.join(',')})`:''}))`}`;
  const range=(field:string)=>`${field}>=TO_DATE('${start}','YYYY-MM-DD') AND ${field}<TO_DATE('${end}','YYYY-MM-DD')+1`;
  const eligible=wallet?`SELECT C.* FROM TGFCAB C WHERE ${common} AND ${range('C.DTNEG')}`:
    `SELECT C.* FROM TGFCAB C WHERE ${common} AND ${range('C.DTENTSAI')}
     UNION ALL SELECT C.* FROM TGFCAB C WHERE ${common} AND C.DTENTSAI IS NULL AND ${range('C.DTNEG')}`;
  const day=monthly?`TO_CHAR(${date},'YYYY-MM')||'-01'`:`TO_CHAR(${date},'YYYY-MM-DD')`;
  const dimensions=monthly?"'SEM MARCA' MARCA,0 CODGRUPOPROD,'N/D' UF":"NVL(TRIM(P.MARCA),'SEM MARCA') MARCA,P.CODGRUPOPROD,NVL(U.UF,'N/D') UF";
  return `WITH ELIGIBLE AS (${eligible}),
    NETS AS (SELECT I.NUNOTA,SUM(${net}) NET_TOTAL FROM TGFITE I JOIN ELIGIBLE C ON C.NUNOTA=I.NUNOTA WHERE I.SEQUENCIA>0 GROUP BY I.NUNOTA)
    ${wallet?`, DELIVERIES AS (SELECT V.NUNOTAORIG,V.SEQUENCIAORIG,SUM(V.QTDATENDIDA) DELIVERED FROM TGFVAR V
      JOIN ELIGIBLE O ON O.NUNOTA=V.NUNOTAORIG JOIN TGFCAB F ON F.NUNOTA=V.NUNOTA
      WHERE F.TIPMOV='V' AND F.CODTIPOPER IN (${sales}) AND F.STATUSNOTA='L' AND NVL(F.STATUSNFE,'M') IN ('A','M','T')
      GROUP BY V.NUNOTAORIG,V.SEQUENCIAORIG)`:''}
    SELECT ${day} GOAL_DATE,C.CODVEND,C.CODEMP,${dimensions},
      SUM(${value}) ${wallet?'WALLET':'ACTUAL'} FROM ELIGIBLE C JOIN TGFITE I ON I.NUNOTA=C.NUNOTA AND I.SEQUENCIA>0 JOIN NETS N ON N.NUNOTA=C.NUNOTA
      JOIN TGFPRO P ON P.CODPROD=I.CODPROD JOIN TGFPAR PAR ON PAR.CODPARC=C.CODPARC ${monthly?'':'LEFT JOIN TSICID CI ON CI.CODCID=PAR.CODCID LEFT JOIN TSIUFS U ON U.CODUF=CI.UF'}
      ${wallet?'LEFT JOIN DELIVERIES D ON D.NUNOTAORIG=I.NUNOTA AND D.SEQUENCIAORIG=I.SEQUENCIA':''}
      WHERE ${eligibility} GROUP BY ${day},C.CODVEND,C.CODEMP${monthly?'':',TRIM(P.MARCA),P.CODGRUPOPROD,U.UF'}
      ORDER BY GOAL_DATE,C.CODVEND,C.CODEMP${monthly?'':',MARCA,P.CODGRUPOPROD,UF'}`;
}
const cache=new Map<string,{expires:number;pending:Promise<{facts:GoalFact[];updatedAt:number}>}>();
export function invalidateGoalFacts(){cache.clear();}
export async function loadGoalFacts(session:SankhyaSession,access:GoalAccess,settings:GoalSettings,start:string,end:string,refresh=false,monthlySales=false){
  if(!access.sellerIds.length||!access.companies.length)return {facts:[],updatedAt:Date.now()};
  const key=JSON.stringify([session.userId,[...access.sellerIds].sort((a,b)=>a-b),[...access.companies].sort((a,b)=>a-b),settings.version,start,end,monthlySales]);
  const saved=cache.get(key);if(saved&&(saved.expires===Infinity||(!refresh&&saved.expires>Date.now())))return saved.pending;
  const pending=(async()=>{
    const deadline=AbortSignal.timeout(120000);
    const query=(sql:string)=>readGoalQueryRows(page=>{deadline.throwIfAborted();return executeQuery(session,page,deadline);},sql);
    const [actual,wallet]=await Promise.all([query(goalFactsSql(start,end,access,settings,false,monthlySales)),monthlySales?[]:query(goalFactsSql(start,end,access,settings,true))]);
    return {updatedAt:Date.now(),facts:[...actual,...wallet].map(r=>({date:String(r.GOAL_DATE),sellerId:Number(r.CODVEND),company:Number(r.CODEMP),brand:String(r.MARCA),group:Number(r.CODGRUPOPROD),state:String(r.UF),actual:Number(r.ACTUAL||0),wallet:Number(r.WALLET||0)}))};
  })();
  if(cache.size>=4){
    const settled=[...cache].find(([,entry])=>entry.expires!==Infinity)?.[0];
    if(settled!==undefined)cache.delete(settled);
    else if(cache.size>=8)cache.delete(cache.keys().next().value!);
  }
  cache.set(key,{expires:Infinity,pending});
  try{const result=await pending;if(cache.get(key)?.pending===pending)cache.set(key,{expires:Date.now()+90000,pending});return result;}
  catch(error){if(cache.get(key)?.pending===pending)cache.delete(key);throw error;}
}
