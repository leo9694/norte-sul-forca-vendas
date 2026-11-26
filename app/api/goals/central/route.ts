import { requireSession } from '../../_lib/sankhya';
import { goalAccess, goalCatalog, loadGoalFacts, invalidateGoalFacts } from '../../_lib/goals-central';
import { validGoalDate, goalTypes, goalStatuses, type GoalCampaign, type GoalSettings } from '../../../goals-central-model';
import { goalAudit, listGoalSets, readGoalSettings, saveGoalSets, saveGoalSettings } from '../../../../db/goals';
import { validateGoalAllocations } from '../../../goals-registration';

function failure(error:unknown){
  const message=error instanceof Error?error.message:'';
  if(message==='AUTH_REQUIRED')return Response.json({error:'Sessão expirada.'},{status:401});
  const known:Record<string,[number,string]>={GOAL_CONFLICT:[409,'Os dados foram alterados por outro usuário. Atualize antes de salvar.'],GOAL_CLOSED:[409,'Esta meta está encerrada e não pode ser alterada.'],GOAL_OVERLAP:[409,'Já existe uma meta do mesmo tipo, empresa, vendedor e categoria neste período.'],GOAL_INVALID:[400,'Confira os campos da meta, valores, período e participantes.'],GOAL_FORBIDDEN:[403,'Você não tem permissão para esta operação ou equipe.']};
  const [status,text]=known[message]||[503,'Não foi possível consultar ou salvar as metas. Tente novamente.'];
  return Response.json({error:text},{status});
}
const invalid=()=>{throw Error('GOAL_INVALID');};
const denied=()=>{throw Error('GOAL_FORBIDDEN');};
const ints=(value:unknown,allowEmpty=false):number[]=>{if(!Array.isArray(value)||(!allowEmpty&&!value.length)||value.length>500||value.some(v=>!Number.isSafeInteger(v)||v<=0)||new Set(value).size!==value.length)invalid();return value as number[];};
const visible=(c:GoalCampaign,ids:number[],companies:number[])=>c.companies.every(id=>companies.includes(id))&&c.assignments.some(a=>ids.includes(a.sellerId));
export async function GET(request:Request){
  try{
    const session=await requireSession(request),settings=readGoalSettings(),access=await goalAccess(session,settings),url=new URL(request.url),action=url.searchParams.get('action');
    if(action==='analytics'){
      const start=url.searchParams.get('start'),end=url.searchParams.get('end');
      if(!validGoalDate(start)||!validGoalDate(end)||start>end||(Date.parse(end)-Date.parse(start))/86400000>1100)invalid();
      const company=Number(url.searchParams.get('company')||0),supervisor=Number(url.searchParams.get('supervisor')||0),seller=Number(url.searchParams.get('seller')||0);
      if([company,supervisor,seller].some(value=>!Number.isSafeInteger(value)||value<0))invalid();
      if(company&&!access.companies.includes(company)||supervisor&&(!access.canViewAll||!access.sellerIds.includes(supervisor))||seller&&!access.sellerIds.includes(seller))denied();
      const monthlySales=url.searchParams.get('series')==='sales';
      if(monthlySales&&!access.canManage)denied();
      const scoped={...access,companies:company?[company]:access.companies,sellerIds:access.sellers.filter(s=>(!seller||s.id===seller)&&(!supervisor||s.supervisorId===supervisor)).map(s=>s.id)};
      const result=await loadGoalFacts(session,scoped,settings,start!,end!,url.searchParams.get('refresh')==='1',monthlySales);
      return Response.json(result,{headers:{'Cache-Control':'private, no-store'}});
    }
    const campaigns=listGoalSets().filter(c=>visible(c,access.sellerIds,access.companies));
    if(action==='audit'){
      if(!access.canManage)denied();
      const id=url.searchParams.get('id'),before=Number(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER);
      const ids=campaigns.filter(c=>(!id||c.id===id)&&c.assignments.every(a=>access.sellerIds.includes(a.sellerId))).map(c=>c.id);
      return Response.json({rows:goalAudit(ids,Number.isSafeInteger(before)?before:Number.MAX_SAFE_INTEGER)},{headers:{'Cache-Control':'private, no-store'}});
    }
    const catalog=await goalCatalog(session,access,true,url.searchParams.get('refresh')==='1');
    return Response.json({canViewAll:access.canViewAll,canManage:access.canManage,canConfigure:access.canConfigure,ownSellerId:session.sellerId,catalog,
      campaigns:campaigns.filter(c=>access.canManage||!['draft','cancelled'].includes(c.status)).map(c=>({...c,assignments:c.assignments.filter(a=>access.sellerIds.includes(a.sellerId)),editable:access.canManage&&c.assignments.every(a=>access.sellerIds.includes(a.sellerId))})),
      settings:{...settings,companies:access.companies,userCompanies:access.canConfigure?settings.userCompanies:{},supervisorEditors:access.canConfigure?settings.supervisorEditors:[]},updatedAt:Date.now()},
      {headers:{'Cache-Control':'private, no-store'}});
  }catch(error){return failure(error);}
}
export async function POST(request:Request){
  try{
    const session=await requireSession(request),settings=readGoalSettings(),access=await goalAccess(session,settings);
    if(!access.canManage)denied();
    const text=await request.text();if(text.length>1_000_000)invalid();let body;try{body=JSON.parse(text);}catch{invalid();}if(!body||typeof body!=='object'||Array.isArray(body))invalid();
    if(body.action==='settings'){
      if(!access.canConfigure)denied();
      const s=body.settings as GoalSettings;
      if(!s||!Number.isInteger(s.version)||s.version<0||!Array.isArray(s.holidays)||s.holidays.length>1000||s.holidays.some(d=>!validGoalDate(d))
        ||!Number.isFinite(s.onTrack)||!Number.isFinite(s.attention)||s.onTrack<=0||s.onTrack>100||s.attention<0||s.attention>=s.onTrack)invalid();
      const companies=ints(s.companies),saleTops=ints(s.saleTops),orderTops=ints(s.orderTops),returnTops=ints(s.returnTops,true),supervisorEditors=ints(s.supervisorEditors,true);
      if(saleTops.some(id=>orderTops.includes(id)||returnTops.includes(id)))invalid();
      if(!s.userCompanies||typeof s.userCompanies!=='object'||Array.isArray(s.userCompanies)||Object.keys(s.userCompanies).length>500)invalid();
      for(const [id,values] of Object.entries(s.userCompanies)){if(!/^\d+$/.test(id)||Number(id)<=0)invalid();if(ints(values).some(v=>!companies.includes(v)))invalid();}
      saveGoalSettings({companies,saleTops,orderTops,returnTops,supervisorEditors,holidays:s.holidays,onTrack:s.onTrack,attention:s.attention,userCompanies:s.userCompanies,version:s.version},session.userId,session.user);
      invalidateGoalFacts();return Response.json({ok:true});
    }
    if(!Array.isArray(body.changes)||!body.changes.length||body.changes.length>100)invalid();
    const catalog=await goalCatalog(session,access),existing=listGoalSets(),ids=new Set<string>();
    const changes:GoalCampaign[]=body.changes.map((raw:GoalCampaign)=>{
      if(!raw||typeof raw.id!=='string'||!/^[-a-zA-Z0-9]{1,90}$/.test(raw.id)||ids.has(raw.id)||typeof raw.description!=='string'||!raw.description.trim()||raw.description.length>150
        ||!Object.hasOwn(goalTypes,raw.type)||!Object.hasOwn(goalStatuses,raw.status)||!validGoalDate(raw.start)||!validGoalDate(raw.end)||raw.start>raw.end||(Date.parse(raw.end)-Date.parse(raw.start))/86400000>366
        ||!Number.isSafeInteger(raw.version)||raw.version<0||typeof raw.notes!=='string'||raw.notes.length>2000||!Array.isArray(raw.assignments)||!raw.assignments.length||raw.assignments.length>500)invalid();
      ids.add(raw.id);const previous=existing.find(c=>c.id===raw.id),companies=ints(raw.companies);
      if(companies.some(id=>!access.companies.includes(id))||previous&&(!visible(previous,access.sellerIds,access.companies)||previous.assignments.some(a=>!access.sellerIds.includes(a.sellerId))))denied();
      const sellerIds=new Set<number>();
      for(const a of raw.assignments){
        if(!a||!Number.isSafeInteger(a.sellerId)||sellerIds.has(a.sellerId)||!Number.isSafeInteger(a.targetCents)||a.targetCents<0||a.targetCents>1_000_000_000_000)invalid();
        if(!access.sellerIds.includes(a.sellerId))denied();
        if(!catalog.sellers.some(s=>s.id===a.sellerId&&s.active)&&!previous?.assignments.some(p=>p.sellerId===a.sellerId&&p.targetCents===a.targetCents))invalid();sellerIds.add(a.sellerId);
      }
      const brand=raw.type==='brand'||raw.type==='combined'?raw.brand:'',group=raw.type==='group'||raw.type==='combined'?raw.group:0;
      if((brand&&!catalog.brands.includes(brand))||(['brand','combined'].includes(raw.type)&&!brand)||!Number.isSafeInteger(group)||(group&&!catalog.groups.some(g=>g.id===group))||(['group','combined'].includes(raw.type)&&!group))invalid();
      // Encerramento é irreversível; o histórico nunca é sobrescrito.
      if(previous?.status==='closed')throw Error('GOAL_CLOSED');
      const allocation=raw.allocation;
      if(allocation&&(!['brand','group'].includes(raw.type)||typeof allocation.parentId!=='string'||!/^[-a-zA-Z0-9]{1,90}$/.test(allocation.parentId)||!Number.isSafeInteger(allocation.basisPoints)||allocation.basisPoints<0||allocation.basisPoints>10000))invalid();
      return {id:raw.id,description:raw.description.trim(),type:raw.type,companies,start:raw.start,end:raw.end,brand,group,status:raw.status,notes:raw.notes.trim(),version:raw.version,
        assignments:raw.assignments.map(a=>({sellerId:a.sellerId,targetCents:a.targetCents})),...(allocation?{allocation:{parentId:allocation.parentId,basisPoints:allocation.basisPoints}}:{}),createdAt:0,createdBy:0,createdName:'',updatedAt:0};
    });
    validateGoalAllocations(existing,changes);
    saveGoalSets(changes,session.userId,session.user);return Response.json({ok:true,count:changes.length});
  }catch(error){return failure(error);}
}
