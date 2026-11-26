import { parseGoalAmount } from './goals-model.ts';
import { goalStatuses, goalTypes, goalToday, validGoalDate, shiftMonth, type CentralData, type GoalCampaign, type GoalFact, type GoalStatus, type GoalType } from './goals-central-model.ts';
export const parseGoalValue=(input:string)=>{const text=input.trim().replace(/^R\$\s*/i,'').replace(/\u00a0/g,'');return text==='0'||/^0[,.]0{1,2}$/.test(text)?0:parseGoalAmount(text);};
const goalCurrency=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
export function formatGoalCurrency(input:string){
  const cents=parseGoalValue(input);
  return cents===null?input:goalCurrency.format(cents/100);
}
export function goalCurrencyInput(input:string){
  const text=input.trim().replace(/^R\$\s*/i,'');
  const normalized=text.startsWith(',')?'0'+text:text;
  return /^\d[\d.]*(,\d{0,2})?$/.test(normalized)||!normalized?normalized:null;
}
export function maskGoalCurrency(input:string){
  const text=goalCurrencyInput(input);
  if(text===null||!text)return text;
  if(!/^R\$/i.test(input.trim())&&/^\d+\.\d{1,2}$/.test(text))return formatGoalCurrency(text);
  // Durante a digitação, ponto separa milhares e vírgula inicia os centavos.
  const [integer,fraction]=text.split(',');
  const digits=integer.replace(/\./g,'').replace(/^0+(?=\d)/,'');
  return 'R$ '+digits.replace(/\B(?=(\d{3})+(?!\d))/g,'.')+(fraction===undefined?'':','+fraction);
}
export type GoalAllocationDraft={key:string;sourceId?:string;type:'brand'|'group';brand:string;group:number;percent:string};
export type GoalRegistrationDraft={sourceId?:string;description:string;type:GoalType;companies:number[];start:string;end:string;brand:string;group:number;status:GoalStatus;notes:string;amount:string;sellerIds:number[];allocations:GoalAllocationDraft[]};
export function percentageBasisPoints(text:string){
  if(!/^\d{1,3}([,.]\d{1,2})?$/.test(text.trim()))return null;
  const value=Math.round(Number(text.trim().replace(',','.'))*100);return value>=0&&value<=10000?value:null;
}
export const allocationTargetCents=(base:number,basisPoints:number)=>Number((BigInt(base)*BigInt(basisPoints)+BigInt(5000))/BigInt(10000));
export function sellerRegistrationStatus(campaigns:GoalCampaign[],sellerId:number,start:string,end:string){
  const goals=campaigns.filter(c=>c.status!=='cancelled'&&c.start<=end&&c.end>=start&&c.assignments.some(a=>a.sellerId===sellerId));
  return {goals,state:goals.length?goals.every(c=>c.status==='scheduled')?'scheduled':'registered':'empty'};
}
export function sellerSixMonthSales(facts:GoalFact[],sellerIds:number[],start:string){
  const selected=new Set(sellerIds);return Array.from({length:6},(_,i)=>{const month=shiftMonth(start,i-6);return {month,value:facts.filter(f=>selected.has(f.sellerId)&&f.date.startsWith(month)).reduce((sum,f)=>sum+f.actual,0)};});
}
const mutableGoal=(c:GoalCampaign)=>c.editable!==false&&c.status!=='closed'&&c.status!=='cancelled';
export function activeGoalFamily(campaigns:GoalCampaign[],goal:GoalCampaign){
  return [goal,...campaigns.filter(c=>c.status!=='cancelled'&&c.allocation?.parentId===goal.id)];
}
export function canChangeGoalFamily(campaigns:GoalCampaign[],goal:GoalCampaign){
  return activeGoalFamily(campaigns,goal).every(mutableGoal);
}
export function addSellerToGoal(data:CentralData,goal:GoalCampaign,sellerId:number,amount:string):GoalCampaign[]{
  const target=parseGoalValue(amount),family=activeGoalFamily(data.campaigns,goal);
  if(goal.allocation||!family.every(mutableGoal))throw Error('Esta meta ou uma das metas vinculadas não pode ser alterada.');
  if(!data.catalog.sellers.some(s=>s.id===sellerId&&s.active))throw Error('Selecione um vendedor ativo.');
  if(target===null||target>1_000_000_000_000)throw Error('Informe um valor válido para o vendedor.');
  if(family.some(c=>c.assignments.some(a=>a.sellerId===sellerId)))throw Error('Este vendedor já está vinculado à meta.');
  const changes=family.map(c=>({...c,assignments:[...c.assignments,{sellerId,targetCents:c.allocation?allocationTargetCents(target,c.allocation.basisPoints):target}]}));
  try{validateGoalAllocations(data.campaigns,changes);}catch{throw Error('Confira os vínculos de marca e grupo antes de adicionar o vendedor.');}
  return changes;
}
export function cancelGoalFamily(campaigns:GoalCampaign[],goal:GoalCampaign):GoalCampaign[]{
  if(!canChangeGoalFamily(campaigns,goal))throw Error('A meta ou uma das metas vinculadas não pode ser excluída.');
  return activeGoalFamily(campaigns,goal).map(c=>({...c,status:'cancelled'}));
}
export function registrationFromGoal(data:CentralData,c:GoalCampaign,sellerId:number,copyPeriod?:{start:string;end:string}):GoalRegistrationDraft{
  const parent=c.allocation?data.campaigns.find(p=>p.id===c.allocation!.parentId):c;
  if(!parent)throw Error('A meta geral vinculada não está disponível para edição.');
  const assignment=parent.assignments.find(a=>a.sellerId===sellerId)||parent.assignments[0];
  return {sourceId:copyPeriod?undefined:parent.id,description:parent.description,type:parent.type,companies:[...parent.companies],start:copyPeriod?.start||parent.start,end:copyPeriod?.end||parent.end,
    brand:parent.brand,group:parent.group,status:copyPeriod?(copyPeriod.start>goalToday()?'scheduled':'active'):parent.status,notes:parent.notes,amount:String(assignment.targetCents/100).replace('.',','),sellerIds:copyPeriod?[]:[sellerId],
    allocations:data.campaigns.filter(child=>child.status!=='cancelled'&&child.allocation?.parentId===parent.id&&child.assignments.some(a=>a.sellerId===sellerId)).map(child=>({key:child.id,sourceId:copyPeriod?undefined:child.id,type:child.type as 'brand'|'group',brand:child.brand,group:child.group,percent:String(child.allocation!.basisPoints/100).replace('.',',')}))};
}
// A edição de um participante de uma meta coletiva separa sua parcela e preserva os demais.
export function buildGoalRegistration(data:CentralData,draft:GoalRegistrationDraft,newId:()=>string=()=>crypto.randomUUID()):GoalCampaign[]{
  const target=parseGoalValue(draft.amount),selected=new Set(draft.sellerIds),source=draft.sourceId?data.campaigns.find(c=>c.id===draft.sourceId):undefined;
  if(!draft.description.trim()||draft.description.trim().length>150||!Object.hasOwn(goalTypes,draft.type)||!Object.hasOwn(goalStatuses,draft.status)||!validGoalDate(draft.start)||!validGoalDate(draft.end)||draft.start>draft.end||(Date.parse(draft.end)-Date.parse(draft.start))/86400000>366||target===null||draft.notes.length>2000)throw Error('Confira descrição, valor, período (até 366 dias) e situação da meta.');
  if(!selected.size||selected.size!==draft.sellerIds.length||draft.sellerIds.some(id=>!data.catalog.sellers.some(s=>s.id===id&&s.active)))throw Error('Marque ao menos um vendedor ativo da sua equipe.');
  if(!draft.companies.length||draft.companies.some(id=>!data.settings.companies.includes(id)))throw Error('Selecione empresas autorizadas para a meta.');
  if(source&&(source.editable===false||source.status==='closed'))throw Error('Esta meta não pode ser alterada.');
  if(draft.sourceId&&!source)throw Error('A meta original não está mais disponível. Atualize a página.');
  const brand=['brand','combined'].includes(draft.type)?draft.brand:'',group=['group','combined'].includes(draft.type)?draft.group:0;
  if((['brand','combined'].includes(draft.type)&&!data.catalog.brands.includes(brand))||(['group','combined'].includes(draft.type)&&!data.catalog.groups.some(g=>g.id===group)))throw Error('Selecione a marca e o grupo da meta.');
  if(draft.type!=='general'&&draft.allocations.length)throw Error('Percentuais de marca e grupo devem partir de uma meta geral.');
  const totals={brand:0,group:0},categories=new Set<string>();
  const allocations=draft.allocations.map(row=>{
    const bps=percentageBasisPoints(row.percent),category=row.type+':'+(row.type==='brand'?row.brand:row.group);
    if(bps===null||categories.has(category)||!['brand','group'].includes(row.type)||(row.type==='brand'?!data.catalog.brands.includes(row.brand):!data.catalog.groups.some(g=>g.id===row.group)))throw Error('Confira os percentuais, marcas e grupos. Não repita a mesma categoria.');
    categories.add(category);totals[row.type]+=bps;if(totals[row.type]>10000)throw Error('A soma dos percentuais de cada dimensão não pode ultrapassar 100%. Marcas e grupos são independentes.');
    return {...row,bps};
  });
  const sourceChildren=source?data.campaigns.filter(c=>c.status!=='cancelled'&&c.allocation?.parentId===source.id):[];
  if(sourceChildren.some(c=>c.assignments.some(a=>selected.has(a.sellerId))&&(c.status==='closed'||c.editable===false)))throw Error('Há uma meta percentual encerrada ou sem permissão de edição para estes vendedores.');
  if(allocations.some(a=>a.sourceId&&!sourceChildren.some(c=>c.id===a.sourceId)))throw Error('A meta percentual original não está disponível.');
  const remaining=source?.assignments.filter(a=>!selected.has(a.sellerId))||[],split=remaining.length>0;
  const base:GoalCampaign={id:source&&!split?source.id:newId(),description:draft.description.trim(),type:draft.type,companies:[...draft.companies],start:draft.start,end:draft.end,brand,group,status:draft.status,notes:draft.notes.trim(),version:source&&!split?source.version:0,
    assignments:draft.sellerIds.map(sellerId=>({sellerId,targetCents:target})),createdBy:0,createdName:'',createdAt:0,updatedAt:0};
  const changes:GoalCampaign[]=[...(source&&split&&remaining.length!==source.assignments.length?[{...source,assignments:remaining}]:[]),base];
  const keepOtherParticipants=(child:GoalCampaign)=>{
    const rest=child.assignments.filter(a=>!selected.has(a.sellerId));
    if(rest.length===child.assignments.length)return;
    changes.push(rest.length?{...child,assignments:rest}:{...child,status:'cancelled'});
  };
  for(const child of sourceChildren){const retained=allocations.some(a=>a.sourceId===child.id);if(split||!retained)keepOtherParticipants(child);}
  for(const row of allocations){
    const old=sourceChildren.find(c=>c.id===row.sourceId),reuse=old&&!split;
    changes.push({id:reuse?old.id:newId(),description:`${base.description} · ${row.type==='brand'?row.brand:data.catalog.groups.find(g=>g.id===row.group)!.name}`.slice(0,150),type:row.type,companies:[...base.companies],start:base.start,end:base.end,brand:row.type==='brand'?row.brand:'',group:row.type==='group'?row.group:0,status:base.status,notes:base.notes,
      version:reuse?old.version:0,assignments:base.assignments.map(a=>({sellerId:a.sellerId,targetCents:allocationTargetCents(a.targetCents,row.bps)})),allocation:{parentId:base.id,basisPoints:row.bps},createdBy:0,createdName:'',createdAt:0,updatedAt:0});
  }
  return changes;
}
export function validateGoalAllocations(existing:GoalCampaign[],changes:GoalCampaign[]){
  const ids=new Set(changes.map(c=>c.id)),all=[...existing.filter(c=>!ids.has(c.id)),...changes];
  const parentIds=new Set(all.filter(c=>c.allocation&&(ids.has(c.id)||ids.has(c.allocation.parentId))).map(c=>c.allocation!.parentId));
  for(const parentId of parentIds){
    const parent=all.find(c=>c.id===parentId),children=all.filter(c=>c.status!=='cancelled'&&c.allocation?.parentId===parentId),totals=new Map<string,number>();
    if(existing.some(c=>c.id===parentId&&c.status==='closed')&&changes.some(c=>c.allocation?.parentId===parentId))throw Error('GOAL_CLOSED');
    if(children.length&&(!parent||parent.type!=='general'||parent.status==='cancelled'))throw Error('GOAL_INVALID');
    for(const child of children){
      if(!['brand','group'].includes(child.type)||child.start!==parent!.start||child.end!==parent!.end||child.companies.length!==parent!.companies.length||child.companies.some(id=>!parent!.companies.includes(id))||(parent!.status==='closed'&&child.status!=='closed'))throw Error('GOAL_INVALID');
      for(const a of child.assignments){
        const general=parent!.assignments.find(p=>p.sellerId===a.sellerId),bps=child.allocation!.basisPoints;
        if(!Number.isSafeInteger(bps)||bps<0||bps>10000||!general||a.targetCents!==allocationTargetCents(general.targetCents,bps))throw Error('GOAL_INVALID');
        const key=a.sellerId+':'+child.type,total=(totals.get(key)||0)+bps;if(total>10000)throw Error('GOAL_INVALID');totals.set(key,total);
      }
    }
  }
}
