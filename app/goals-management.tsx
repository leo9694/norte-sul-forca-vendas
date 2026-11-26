'use client';
import { useEffect, useRef, useState } from 'react';
import { Plus, Pencil, Copy, Search, X, Check, ChevronRight, Trash2 } from 'lucide-react';
import { goalTypes, goalStatuses, goalToday, monthPeriod, validGoalDate, type CentralData, type GoalCampaign, type GoalFact, type GoalType } from './goals-central-model';
import { activeGoalFamily, addSellerToGoal, allocationTargetCents, buildGoalRegistration, cancelGoalFamily, canChangeGoalFamily, formatGoalCurrency, maskGoalCurrency, parseGoalValue, percentageBasisPoints, registrationFromGoal, sellerSixMonthSales, type GoalRegistrationDraft } from './goals-registration';
import { downloadGoalsExcel, downloadGoalsPdf } from './goals-export';
import { GoalTimeChart } from './goals-charts';
const money=(value:number)=>value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const normalize=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
const freshDraft=(data:CentralData,period:{start:string;end:string},sellerId?:number):GoalRegistrationDraft=>{
  const monthly=monthPeriod(period.start.slice(0,7));
  return {description:'Meta de vendas',type:'general',companies:[...data.settings.companies],...monthly,brand:'',group:0,status:monthly.start>goalToday()?'scheduled':'active',notes:'',amount:'',sellerIds:sellerId?[sellerId]:[],allocations:[]};
};
type Props={data:CentralData;facts:GoalFact[];month:string;period?:{start:string;end:string};busy:boolean;historyReady?:boolean;historyError?:string;onHistoryNeeded?:()=>void;saveError?:string;onSave:(changes:GoalCampaign[])=>Promise<boolean>;onError:(message:string)=>void};
export function GoalManagement({data,facts,month,period:providedPeriod,busy,historyReady=true,historyError='',onHistoryNeeded,saveError='',onSave,onError}:Props){
  const [supervisor,setSupervisor]=useState(''),[search,setSearch]=useState(''),[editing,setEditing]=useState<GoalRegistrationDraft|null>(null);
  const [pickerSellerId,setPickerSellerId]=useState<number>();
  const [deleting,setDeleting]=useState<GoalCampaign|null>(null),[deleteError,setDeleteError]=useState('');
  const deleteLock=useRef(false);
  const period=providedPeriod||monthPeriod(month),eligible=data.catalog.sellers.filter(s=>s.active&&(!supervisor||s.supervisorId===Number(supervisor)));
  const sellers=eligible.filter(s=>normalize(s.name+' '+s.id).includes(normalize(search.trim())));
  const eligibleIds=new Set(eligible.map(s=>s.id));
  const registered=data.campaigns.filter(c=>c.status!=='cancelled'&&c.start<=period.end&&c.end>=period.start&&c.assignments.some(a=>eligibleIds.has(a.sellerId)));
  const openFresh=(sellerId?:number)=>{setPickerSellerId(sellerId);setEditing(freshDraft(data,period,sellerId));};
  const registeredIds=new Set(registered.map(c=>c.id)),childrenByParent=new Map<string,GoalCampaign[]>();
  const sellerStates=new Map<number,'scheduled'|'registered'>();
  for(const c of registered){
    for(const a of c.assignments)if(eligibleIds.has(a.sellerId)){
      if(c.status!=='scheduled')sellerStates.set(a.sellerId,'registered');
      else if(!sellerStates.has(a.sellerId))sellerStates.set(a.sellerId,'scheduled');
    }
    const parentId=c.allocation?.parentId;
    if(parentId&&registeredIds.has(parentId))childrenByParent.set(parentId,[...(childrenByParent.get(parentId)||[]),c]);
  }
  const registeredRoots=registered.filter(c=>!c.allocation||!registeredIds.has(c.allocation.parentId));
  const confirmDeletion=async()=>{
    if(!deleting||busy||deleteLock.current)return;
    deleteLock.current=true;setDeleteError('');
    try{if(await onSave(cancelGoalFamily(data.campaigns,deleting)))setDeleting(null);else setDeleteError('Não foi possível excluir a meta.');}
    catch(e){setDeleteError((e as Error).message);}
    finally{deleteLock.current=false;}
  };
  const openRegistered=(c:GoalCampaign,copy=false)=>{
    try{
      const sellerId=c.assignments.find(a=>eligibleIds.has(a.sellerId))!.sellerId,draft=registrationFromGoal(data,c,sellerId,copy?monthPeriod(period.start.slice(0,7)):undefined);
      if(!copy){
        const parent=data.campaigns.find(p=>p.id===draft.sourceId)!;
        const participants=parent.assignments.filter(a=>eligibleIds.has(a.sellerId));
        const signature=(id:number)=>JSON.stringify([parent.assignments.find(a=>a.sellerId===id)!.targetCents,
          data.campaigns.filter(child=>child.status!=='cancelled'&&child.allocation?.parentId===parent.id&&child.assignments.some(a=>a.sellerId===id)).map(child=>[child.type,child.brand,child.group,child.allocation!.basisPoints]).sort()]);
        if(participants.every(a=>signature(a.sellerId)===signature(sellerId)))draft.sellerIds=participants.map(a=>a.sellerId);
      }
      setPickerSellerId(undefined);setEditing(draft);
    }catch(error){onError((error as Error).message);}
  };
  const supervisors=data.catalog.sellers.filter(s=>s.active&&data.catalog.sellers.some(v=>v.supervisorId===s.id));
  return <div className="goals-management">
    <div className="goals-panel-heading goal-management-toolbar"><button className="primary" disabled={busy} onClick={()=>openFresh()}><Plus size={16}/> Nova meta</button><div className="goals-filters goals-supervisor-filter"><label>Supervisor<select value={supervisor} disabled={busy} onChange={e=>setSupervisor(e.target.value)}><option value="">Todos</option>{supervisors.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label></div></div>
    <section className="goal-panel goal-registered-section" aria-label="Metas cadastradas"><h2>Metas cadastradas</h2><div className="goal-registered-list">{registeredRoots.map(c=>{
      const assignments=c.assignments.filter(a=>eligibleIds.has(a.sellerId)),value=assignments.reduce((sum,a)=>sum+a.targetCents/100,0);
      return <article className="goal-registered-card" key={c.id}><div className="goal-registered-main"><div><h3>{c.description}</h3><small>{goalTypes[c.type]} · {c.start.split('-').reverse().join('/')} a {c.end.split('-').reverse().join('/')}</small></div><p className="goal-registered-value"><strong>{money(value)}</strong>{assignments.length>1?` · Total de ${assignments.length} vendedores`:''}{c.allocation?` · ${c.allocation.basisPoints/100}% da meta geral`:''}</p><div className="goal-row-actions"><span className={`goal-registration-badge ${c.status==='scheduled'?'scheduled':c.status==='active'?'registered':''}`}>{goalStatuses[c.status]}</span><button className="secondary" disabled={busy} onClick={()=>openRegistered(c)}><Pencil size={14}/>{c.status==='closed'||c.editable===false?'Visualizar':'Editar'}</button><button className="secondary" disabled={busy} aria-label="Criar para outro vendedor" onClick={()=>openRegistered(c,true)}><Copy size={14} aria-hidden="true"/> Duplicar</button>{canChangeGoalFamily(data.campaigns,c)&&<button className="secondary goal-delete-action" disabled={busy} onClick={()=>{setDeleting(c);setDeleteError('');}}><Trash2 size={14}/> Excluir</button>}</div></div>
        {!!childrenByParent.get(c.id)?.length&&<ul className="goal-linked-list" aria-label="Metas de marca e grupo vinculadas">{childrenByParent.get(c.id)!.map(child=><li key={child.id}><span><small>{goalTypes[child.type]}</small><strong>{child.brand||data.catalog.groups.find(g=>g.id===child.group)?.name||child.description}</strong></span><span>{(child.allocation!.basisPoints/100).toLocaleString('pt-BR')}% da principal <strong>{money(child.assignments.filter(a=>eligibleIds.has(a.sellerId)).reduce((sum,a)=>sum+a.targetCents/100,0))}</strong></span><span className={`goal-registration-badge ${child.status==='scheduled'?'scheduled':child.status==='active'?'registered':''}`}>{goalStatuses[child.status]}</span></li>)}</ul>}
      </article>;
    })}</div>{!registered.length&&<p className="empty-state">Nenhuma meta neste período.</p>}</section>
    <section className="goal-panel"><div className="goals-panel-heading"><div><h2>Matriz de metas</h2></div><label className="goal-seller-search"><span>Pesquisar vendedor</span><span><Search size={16}/><input type="search" value={search} placeholder="Nome ou código" onChange={e=>setSearch(e.target.value)}/></span></label></div>
      <div className="goal-seller-list">{sellers.map(s=>{const state=sellerStates.get(s.id)||'empty';return <button key={s.id} className={`goal-seller-list-row ${state}`} disabled={busy} onClick={()=>openFresh(s.id)}><span className="goal-seller-avatar">{state==='empty'?s.name.slice(0,1):<Check size={18}/>}</span><span className="goal-seller-identity"><strong>{s.name}</strong><small>Cód. {s.id}</small></span><span className={`goal-registration-badge ${state}`}>{state==='scheduled'?'Meta programada':state==='registered'?'Meta cadastrada':'Sem meta'}</span><ChevronRight size={17}/></button>;})}</div>
      {!sellers.length&&<p className="empty-state">Nenhum vendedor ativo encontrado.</p>}
    </section>
    <GoalAudit data={data} onError={onError}/>
    {deleting&&<div className="modal-backdrop"><section className="goal-modal goal-delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="goal-delete-title">
      <header><h2 id="goal-delete-title">Excluir meta?</h2></header>
      <p><strong>{deleting.description}</strong> será retirada do acompanhamento, inclusive suas metas de marca e grupo vinculadas. O histórico de alterações será preservado.</p>
      {(deleteError||saveError)&&<p className="global-error" role="alert">{saveError||deleteError}</p>}
      <footer><button className="secondary" disabled={busy} onClick={()=>setDeleting(null)}>Cancelar</button><button className="primary goal-delete-button" disabled={busy} onClick={()=>void confirmDeletion()}>{busy?'Excluindo…':'Excluir meta'}</button></footer>
    </section></div>}
    {editing&&<GoalRegistrationPanel data={data} facts={facts} period={period} initial={editing} pickerSellerId={pickerSellerId} eligibleSellerIds={eligible.map(s=>s.id)} busy={busy} historyReady={historyReady} historyError={historyError} onHistoryNeeded={onHistoryNeeded} saveError={saveError} onClose={()=>setEditing(null)} onSave={onSave}/>}
  </div>;
}
export function GoalRegistrationPanel({data,facts,period,initial,eligibleSellerIds,pickerSellerId,busy,historyReady,historyError,onHistoryNeeded,saveError,onClose,onSave}:{data:CentralData;facts:GoalFact[];period:{start:string;end:string};initial:GoalRegistrationDraft;eligibleSellerIds:number[];pickerSellerId?:number;busy:boolean;historyReady:boolean;historyError:string;onHistoryNeeded?:()=>void;saveError:string;onClose:()=>void;onSave:(changes:GoalCampaign[])=>Promise<boolean>}){
  const [draft,setDraft]=useState(()=>({...initial,amount:formatGoalCurrency(initial.amount)})),[error,setError]=useState(''),[pending,setPending]=useState<GoalCampaign[]|null>(null),[saving,setSaving]=useState(false);
  const [chosenGoal,setChosenGoal]=useState('');
  const savingRef=useRef(false),locked=busy||saving,source=data.campaigns.find(c=>c.id===draft.sourceId),readOnly=!!source&&(source.editable===false||source.status==='closed');
  const draftMonth=draft.start.slice(0,7),monthly=monthPeriod(draftMonth);
  const originalRange=draft.start!==monthly.start||draft.end!==monthly.end;
  const participants=data.catalog.sellers.filter(s=>s.active&&(eligibleSellerIds.includes(s.id)||draft.sellerIds.includes(s.id)));
  const selected=data.catalog.sellers.filter(s=>draft.sellerIds.includes(s.id)),heading=selected.length===1?`Metas de ${selected[0].name}`:source?'Editar meta':'Nova meta';
  const hasSelected=selected.length>0;
  useEffect(()=>{if(hasSelected&&!pending)onHistoryNeeded?.();},[hasSelected,pending,onHistoryNeeded]);
  const available=pickerSellerId===undefined?[]:data.campaigns.filter(c=>!c.allocation&&c.status!=='cancelled'&&c.start<=period.end&&c.end>=period.start);
  const ownGoals=available.filter(c=>c.assignments.some(a=>a.sellerId===pickerSellerId));
  const joinable=available.filter(c=>!ownGoals.includes(c)&&canChangeGoalFamily(data.campaigns,c));
  const joining=joinable.find(c=>c.id===chosenGoal);
  const chooseGoal=(id:string)=>{
    if(pickerSellerId===undefined||locked)return;
    const goal=available.find(c=>c.id===id);
    if(!id){setDraft(freshDraft(data,period,pickerSellerId));}
    else if(!goal)return;
    else if(ownGoals.includes(goal)){const original=registrationFromGoal(data,goal,pickerSellerId);setDraft({...original,amount:formatGoalCurrency(original.amount)});}
    else {
      if(!joinable.includes(goal)||!goal.assignments.length)return;
      const original=registrationFromGoal(data,goal,goal.assignments[0].sellerId);
      const allocations=activeGoalFamily(data.campaigns,goal).slice(1).map(c=>({key:c.id,sourceId:c.id,type:c.type as 'brand'|'group',brand:c.brand,group:c.group,percent:String(c.allocation!.basisPoints/100).replace('.',',')}));
      setDraft({...original,amount:formatGoalCurrency(original.amount),sellerIds:[pickerSellerId],allocations});
    }
    setChosenGoal(id);setError('');
  };
  const change=(patch:Partial<GoalRegistrationDraft>)=>{setDraft(d=>({...d,...patch}));setError('');};
  const amountField={
    inputMode:'decimal' as const,
    placeholder:'R$ 0,00',
    value:draft.amount,
    onBlur:()=>setDraft(d=>({...d,amount:formatGoalCurrency(d.amount.replace(/,$/,''))})),
    onChange:(e:React.ChangeEvent<HTMLInputElement>)=>{
      const field=e.target,typed=field.value,amount=maskGoalCurrency(typed);
      if(amount===null)return;
      change({amount});
      const caret=field.selectionStart;
      if(amount!==typed&&typeof caret==='number'&&caret<typed.length){
        const count=(typed.slice(0,caret).match(/[\d,]/g)||[]).length;
        let next=amount?3:0,remaining=count;
        while(next<amount.length&&remaining>0){if(/[\d,]/.test(amount[next]))remaining--;next++;}
        requestAnimationFrame(()=>{if(document.activeElement===field&&field.value===amount)field.setSelectionRange(next,next);});
      }
    },
  };
  const confirm=async()=>{
    if(!pending||locked||savingRef.current)return;savingRef.current=true;setSaving(true);setError('');
    try{if(await onSave(pending))onClose();else setError('O cadastro não foi salvo. Confira a mensagem e tente novamente; os campos foram mantidos.');}
    catch{setError('Não foi possível salvar. Os dados do painel foram mantidos.');}finally{savingRef.current=false;setSaving(false);}
  };
  const addAllocation=(type:'brand'|'group')=>change({allocations:[...draft.allocations,{key:crypto.randomUUID(),type,brand:'',group:0,percent:''}]});
  const feedback=(error||saveError)&&<div className="global-error" role="alert">{saveError||error}</div>;
  const picker=(available.length>0&&<label className="goal-existing-picker">Selecionar meta<select value={chosenGoal} disabled={locked} onChange={e=>chooseGoal(e.target.value)}>
        <option value="">Nova meta em branco</option>
        {([[ownGoals,'Metas deste vendedor'],[joinable,'Adicionar à meta existente']] as const).map(([goals,label])=>goals.length>0&&<optgroup key={label} label={label}>
          {goals.map(c=><option key={c.id} value={c.id}>{c.description} · {goalTypes[c.type]} · {c.start.split('-').reverse().join('/')} · {goalStatuses[c.status]}</option>)}
        </optgroup>)}
      </select></label>);
  const history=hasSelected&&<SellerHistory campaigns={data.campaigns} facts={facts} sellerIds={draft.sellerIds} start={period.start} names={selected.map(s=>s.name)} ready={historyReady} error={historyError}/>;
  return <div className="modal-backdrop goal-setup-backdrop"><div className="goal-modal goal-setup-panel" role={pending?'alertdialog':'dialog'} aria-modal="true" aria-label={pending?'Confirmar cadastro de meta':'Cadastro de meta'}><header><div><h2>{pending?'Confirmar cadastro':heading}</h2></div><button className="icon-button" type="button" disabled={locked} aria-label="Fechar cadastro de meta" onClick={onClose}><X/></button></header>

    {pending?<><div className="goal-setup-body">{feedback}<div className="goal-confirm-summary"><p><strong>{draft.description}</strong></p><p>{draft.start.split('-').reverse().join('/')} a {draft.end.split('-').reverse().join('/')} · {goalStatuses[draft.status]}</p><p>{joining?'Valor para o novo participante: ':'Meta por vendedor: '}{money(parseGoalValue(draft.amount)||0)}</p><p>{selected.map(s=>s.name).join(', ')}</p>{draft.allocations.map(row=><p key={row.key}>{row.type==='brand'?row.brand:data.catalog.groups.find(g=>g.id===row.group)?.name}: {row.percent}% · {money(allocationTargetCents(parseGoalValue(draft.amount)||0,percentageBasisPoints(row.percent)||0)/100)}</p>)}{draft.status==='closed'&&<p className="goals-note">O encerramento bloqueia novas alterações nesta meta.</p>}</div></div><footer><button className="secondary" disabled={locked} onClick={()=>setPending(null)}>Voltar e revisar</button><button className="primary" disabled={locked} onClick={()=>void confirm()}>{locked?'Salvando…':joining?'Confirmar inclusão':'Confirmar cadastro'}</button></footer></>:<>
      {joining&&pickerSellerId!==undefined?<form onSubmit={e=>{e.preventDefault();if(locked)return;try{setPending(addSellerToGoal(data,joining,pickerSellerId,draft.amount));setError('');}catch(err){setError((err as Error).message);}}}>
        <div className="goal-setup-body">{feedback}{history}{picker}<p className="goals-note">Os valores dos demais vendedores não mudam.</p>
        <label>Valor da meta por vendedor (R$)<input disabled={locked} required {...amountField}/></label></div>
        <footer><button type="button" className="secondary" disabled={locked} onClick={onClose}>Cancelar</button><button className="primary" disabled={locked}>Revisar inclusão</button></footer>
      </form>:<form onSubmit={e=>{e.preventDefault();if(locked||readOnly)return;try{setPending(buildGoalRegistration(data,draft));setError('');}catch(err){setError((err as Error).message);}}}>
        <div className="goal-setup-body">{feedback}{history}{picker}{source&&source.assignments.length>1&&selected.length===1&&<p className="goals-note">Editando {selected[0].name}. Os demais vendedores serão preservados.</p>}
        <fieldset disabled={locked||readOnly}>
          <div className="goal-form-fields"><label className="goal-description-field">Descrição<input required maxLength={150} value={draft.description} onChange={e=>change({description:e.target.value})}/></label><label>Tipo de meta<select value={draft.type} onChange={e=>change({type:e.target.value as GoalType,brand:'',group:0,allocations:[]})}>{Object.entries(goalTypes).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
          <label>Mês da meta<input required={!originalRange} type="month" min="2000-01" max="2099-12" value={originalRange?'':draftMonth} onChange={e=>{
            const month=e.target.value;
            if(validGoalDate(month+'-01'))change(monthPeriod(month));
          }}/>{originalRange&&<small>Período atual: {draft.start.split('-').reverse().join('/')} a {draft.end.split('-').reverse().join('/')}. Selecione um mês para substituir.</small>}</label>
          <label>Valor da meta por vendedor (R$)<input required {...amountField}/></label><label>Situação<select value={draft.status} onChange={e=>change({status:e.target.value as GoalCampaign['status']})}>{Object.entries(goalStatuses).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label></div>
          {['brand','combined'].includes(draft.type)&&<label>Marca<select required value={draft.brand} onChange={e=>change({brand:e.target.value})}><option value="">Selecione</option>{data.catalog.brands.map(b=><option key={b}>{b}</option>)}</select></label>}{['group','combined'].includes(draft.type)&&<label>Grupo de produtos<select required value={draft.group||''} onChange={e=>change({group:Number(e.target.value)})}><option value="">Selecione</option>{data.catalog.groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label>}
          <details className="goal-participant-section" open><summary>Vendedores ({draft.sellerIds.length})</summary><div className="goal-checklist-actions"><button type="button" className="text-button" onClick={()=>change({sellerIds:participants.map(s=>s.id)})}>Marcar todos</button><button type="button" className="text-button" onClick={()=>change({sellerIds:[]})}>Desmarcar todos</button></div><div className="goal-seller-checklist">{participants.map(s=><label key={s.id}><input type="checkbox" checked={draft.sellerIds.includes(s.id)} onChange={e=>change({sellerIds:e.target.checked?[...draft.sellerIds,s.id]:draft.sellerIds.filter(id=>id!==s.id)})}/><span>{s.name}</span></label>)}</div></details>
          {draft.type==='general'&&<section className="goal-allocation-section"><div className="goals-panel-heading"><h3>Metas por marca e grupo</h3><div className="goals-toolbar"><button type="button" className="secondary" onClick={()=>addAllocation('brand')}><Plus size={13}/> Marca</button><button type="button" className="secondary" onClick={()=>addAllocation('group')}><Plus size={13}/> Grupo</button></div></div>{draft.allocations.map(row=>{
            const update=(patch:Partial<typeof row>)=>change({allocations:draft.allocations.map(a=>a.key===row.key?{...a,...patch}:a)}),base=parseGoalValue(draft.amount),bps=percentageBasisPoints(row.percent);
            return <div className="goal-allocation-row" key={row.key}><label>{row.type==='brand'?'Marca':'Grupo de produtos'}<select required value={row.type==='brand'?row.brand:row.group||''} onChange={e=>update(row.type==='brand'?{brand:e.target.value}:{group:Number(e.target.value)})}><option value="">Selecione</option>{row.type==='brand'?data.catalog.brands.map(b=><option key={b}>{b}</option>):data.catalog.groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label><label>Percentual (%)<input required inputMode="decimal" value={row.percent} placeholder="0 a 100" onChange={e=>update({percent:e.target.value})}/></label><span>{base!==null&&bps!==null?money(allocationTargetCents(base,bps)/100):'—'}</span><button type="button" className="icon-button" aria-label={`Remover meta percentual ${row.type==='brand'?'de marca':'de grupo'}`} onClick={()=>change({allocations:draft.allocations.filter(a=>a.key!==row.key)})}><X size={17}/></button></div>;
          })}</section>}
          <details className="goal-participant-section goal-extra-fields"><summary>Empresas e observações</summary><label>Empresas elegíveis<select multiple required value={draft.companies.map(String)} onChange={e=>change({companies:Array.from(e.target.selectedOptions).map(o=>Number(o.value))})}>{data.catalog.companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Observações<textarea maxLength={2000} value={draft.notes} onChange={e=>change({notes:e.target.value})}/></label></details>
        </fieldset></div><footer><button type="button" className="secondary" disabled={locked} onClick={onClose}>{readOnly?'Fechar':'Cancelar'}</button>{!readOnly&&<button className="primary" disabled={locked}>Revisar meta</button>}</footer>
      </form>}
    </>}
  </div></div>;
}
export function SellerHistory({campaigns,facts,sellerIds,start,names,ready,error}:{campaigns:GoalCampaign[];facts:GoalFact[];sellerIds:number[];start:string;names:string[];ready:boolean;error:string}){
  const rows=sellerSixMonthSales(facts,sellerIds,start),total=rows.reduce((sum,r)=>sum+r.value,0),selected=new Set(sellerIds);
  const targets=rows.map(row=>{
    const period=monthPeriod(row.month),assignments=campaigns.filter(c=>c.type==='general'&&c.status!=='draft'&&c.status!=='cancelled'&&c.start===period.start&&c.end===period.end)
      .flatMap(c=>c.assignments.filter(a=>selected.has(a.sellerId)));
    return assignments.length?assignments.reduce((sum,a)=>sum+a.targetCents/100,0):null;
  });
  return <section className="goal-history"><h3>Vendas dos últimos 6 meses</h3><p className="goals-note">{names.length===1?names[0]:`${names.length} vendedores selecionados`}</p>{!ready?<p role="status" className="goals-note">{error?'Não foi possível consultar o histórico.':'Carregando histórico de faturamento…'}</p>:<><GoalTimeChart title="Vendas dos últimos 6 meses" showHeading={false} columns labels={rows.map(r=>r.month.slice(5)+'/'+r.month.slice(0,4))} series={[{name:'Realizado',color:'#00855b',values:rows.map(r=>r.value)},{name:'Meta',color:'#4b8ac7',values:targets}]}/><div className="goal-history-summary"><span>Total <strong>{money(total)}</strong></span><span>Média mensal <strong>{money(total/6)}</strong></span></div></>}</section>;
}
function GoalAudit({data,onError}:{data:CentralData;onError:(message:string)=>void}){
  const [rows,setRows]=useState<Record<string,unknown>[]|null>(null),[busy,setBusy]=useState(false);
  const load=async(before?:number)=>{setBusy(true);try{const response=await fetch(`/api/goals/central?action=audit${before?`&before=${before}`:''}`,{cache:'no-store',signal:AbortSignal.timeout(45000)}),body=await response.json();if(!response.ok)throw Error(body.error);setRows(old=>before?[...(old||[]),...body.rows]:body.rows);}catch(e){onError((e as Error).message);}finally{setBusy(false);}};
  const describe=(raw:unknown)=>{if(!raw)return '—';const c=JSON.parse(String(raw)) as GoalCampaign;return `${c.description} · ${goalStatuses[c.status]} · ${c.assignments.map(a=>`${data.catalog.sellers.find(s=>s.id===a.sellerId)?.name||a.sellerId}: ${money(a.targetCents/100)}`).join('; ')}`;};
  const exportRows=async(pdf:boolean)=>{try{const headers=['Data','Usuário','Antes','Depois'],values=(rows||[]).map(r=>[new Date(Number(r.created_at)).toLocaleString('pt-BR'),String(r.user_name),describe(r.previous),describe(r.next)]);if(pdf)await downloadGoalsPdf('Histórico de metas',headers,values);else downloadGoalsExcel([headers,...values],'historico-metas');}catch{onError('Não foi possível exportar o histórico.');}};
  return <details className="goal-panel" onToggle={e=>{if(e.currentTarget.open&&rows===null&&!busy)void load();}}><summary>Histórico de alterações</summary>{busy&&<p role="status">Carregando…</p>}{rows&&<><div className="goals-toolbar"><button className="secondary" onClick={()=>void exportRows(false)}>Excel</button><button className="secondary" onClick={()=>void exportRows(true)}>PDF</button></div><div className="goals-table-scroll"><table className="goals-table"><thead><tr><th>Data / usuário</th><th>Antes</th><th>Depois</th></tr></thead><tbody>{rows.map(r=><tr key={String(r.id)}><td>{new Date(Number(r.created_at)).toLocaleString('pt-BR')}<small>{String(r.user_name)}</small></td><td>{describe(r.previous)}</td><td>{describe(r.next)}</td></tr>)}</tbody></table></div>{rows.length>0&&rows.length%100===0&&<button className="secondary" disabled={busy} onClick={()=>void load(Number(rows[rows.length-1].id))}>Carregar anteriores</button>}</>}<button className="text-button" disabled={busy} onClick={()=>void load()}>Atualizar histórico</button></details>;
}
