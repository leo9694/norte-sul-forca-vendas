import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {defaultGoalSettings} from '../app/goals-central-model.ts';
import {addSellerToGoal,allocationTargetCents,buildGoalRegistration,cancelGoalFamily,formatGoalCurrency,goalCurrencyInput,percentageBasisPoints,parseGoalValue,registrationFromGoal,sellerRegistrationStatus,sellerSixMonthSales,validateGoalAllocations} from '../app/goals-registration.ts';
const base={id:'base',description:'Meta geral',type:'general',companies:[1],start:'2026-11-01',end:'2026-11-30',brand:'',group:0,status:'active',notes:'',version:3,assignments:[{sellerId:4,targetCents:1000000},{sellerId:5,targetCents:2000000}],createdBy:7,createdName:'Gestor',createdAt:1,updatedAt:1,editable:true};
const child={...base,id:'brand',type:'brand',brand:'Feltrin',version:4,assignments:[{sellerId:4,targetCents:500000},{sellerId:5,targetCents:1000000}],allocation:{parentId:'base',basisPoints:5000}};
const data={canManage:true,campaigns:[],settings:defaultGoalSettings,catalog:{sellers:[{id:4,name:'Vendedor 4',active:true},{id:5,name:'Vendedor 5',active:true},{id:8,name:'Inativo',active:false}],companies:[{id:1,name:'Empresa 1'}],brands:['Feltrin','Forth'],groups:[{id:100,name:'Sementes'},{id:200,name:'Fertilizantes'}]}};
const draft=(overrides={})=>({description:'Meta novembro',type:'general',companies:[1],start:'2026-11-01',end:'2026-11-30',brand:'',group:0,status:'scheduled',notes:'',amount:'10.000,00',sellerIds:[4,5],allocations:[{key:'a',type:'brand',brand:'Feltrin',group:0,percent:'40'},{key:'b',type:'group',brand:'',group:100,percent:'60'}],...overrides});
const idFactory=()=>{let next=0;return()=>`new-${++next}`;};
test('goal currency supports cents, zero, clearing and pasted Brazilian currency without changing the amount',()=>{
  for(const [input,cents] of [['R$\u00a01.234,56',123456],['10',1000],[',5',50],['0',0],['10.25',1025]]){
    const typed=goalCurrencyInput(input);
    assert.equal(parseGoalValue(typed),cents);
    assert.equal(parseGoalValue(formatGoalCurrency(typed)),cents);
  }
  assert.equal(formatGoalCurrency(''),'');
  assert.equal(goalCurrencyInput(''),'');
  assert.equal(goalCurrencyInput('1,001'),null);
  assert.equal(goalCurrencyInput('-1'),null);
});
test('general goals and brand/group percentages create one atomic plan for all checked sellers',()=>{
  const changes=buildGoalRegistration(data,draft(),idFactory());assert.equal(changes.length,3);assert.deepEqual(changes[0].assignments,[{sellerId:4,targetCents:1000000},{sellerId:5,targetCents:1000000}]);
  assert.equal(changes[1].assignments[0].targetCents,400000);assert.equal(changes[2].assignments[0].targetCents,600000);assert.equal(changes[1].allocation.parentId,changes[0].id);assert.equal(changes[1].allocation.basisPoints,4000);assert.ok(changes.every(c=>c.status==='scheduled'));
  assert.doesNotThrow(()=>validateGoalAllocations([],changes));assert.equal(percentageBasisPoints('12,34'),1234);assert.equal(percentageBasisPoints('100.01'),null);assert.equal(parseGoalValue('R$ 1.234,56'),123456);assert.equal(parseGoalValue('0'),0);
  assert.equal(allocationTargetCents(101,5000),51);assert.equal(allocationTargetCents(999999999999,9999),999899999999);
});
test('percentages reject duplicates, out-of-range and invalid dimensions without mixing brand/group totals',()=>{
  assert.doesNotThrow(()=>buildGoalRegistration(data,draft({allocations:[{key:'a',type:'brand',brand:'Feltrin',group:0,percent:'100'},{key:'b',type:'group',brand:'',group:100,percent:'100'}]}),idFactory()));
  for(const patch of [{sellerIds:[]},{sellerIds:[8]},{amount:'abc'},{allocations:[{key:'a',type:'brand',brand:'Feltrin',group:0,percent:'101'}]},{allocations:[{key:'a',type:'group',group:999,brand:'',percent:'50'}]},{allocations:[{key:'a',type:'brand',brand:'Feltrin',group:0,percent:'40'},{key:'b',type:'brand',brand:'Feltrin',group:0,percent:'30'}]}])assert.throws(()=>buildGoalRegistration(data,draft(patch),idFactory()));
});
test('editing one seller splits shared goals and percentages without modifying other assignments',()=>{
  const dataset={...data,campaigns:[base,child]},form=registrationFromGoal(dataset,base,4);form.amount='12.000';form.allocations[0].percent='60';
  const changes=buildGoalRegistration(dataset,form,idFactory()),oldBase=changes.find(c=>c.id==='base'),oldChild=changes.find(c=>c.id==='brand'),newBase=changes.find(c=>c.id==='new-1'),newChild=changes.find(c=>c.id==='new-2');
  assert.deepEqual(oldBase.assignments,[{sellerId:5,targetCents:2000000}]);assert.equal(oldBase.version,3);assert.deepEqual(oldChild.assignments,[{sellerId:5,targetCents:1000000}]);assert.equal(oldChild.allocation.parentId,'base');
  assert.deepEqual(newBase.assignments,[{sellerId:4,targetCents:1200000}]);assert.equal(newChild.assignments[0].targetCents,720000);assert.equal(newChild.allocation.parentId,newBase.id);assert.equal(base.assignments.length,2);assert.equal(child.assignments[0].targetCents,500000);
  assert.doesNotThrow(()=>validateGoalAllocations(dataset.campaigns,changes));
});
test('editing all participants reuses versions; removing an allocation preserves cancellation history',()=>{
  const dataset={...data,campaigns:[base,child]},form=registrationFromGoal(dataset,base,4);form.sellerIds=[4,5];form.amount='12.000';
  const changes=buildGoalRegistration(dataset,form,idFactory());assert.equal(changes[0].id,'base');assert.equal(changes[0].version,3);assert.equal(changes[1].id,'brand');assert.equal(changes[1].version,4);assert.equal(changes[1].assignments[1].targetCents,600000);
  form.allocations=[];const removed=buildGoalRegistration(dataset,form,idFactory());assert.equal(removed.find(c=>c.id==='brand').status,'cancelled');assert.equal(removed.find(c=>c.id==='brand').assignments.length,2);assert.doesNotThrow(()=>validateGoalAllocations(dataset.campaigns,removed));
  assert.throws(()=>buildGoalRegistration({...dataset,campaigns:[{...base,status:'closed'},child]},form),/não pode/);
});
test('copying uses the top period and an empty checklist, with no changes to the source goal',()=>{
  const dataset={...data,campaigns:[base,child]},form=registrationFromGoal(dataset,base,4,{start:'2027-01-03',end:'2027-01-25'});assert.equal(form.sourceId,undefined);assert.deepEqual(form.sellerIds,[]);assert.equal(form.status,'scheduled');assert.equal(form.start,'2027-01-03');assert.equal(form.allocations[0].sourceId,undefined);
  form.sellerIds=[5];const changes=buildGoalRegistration(dataset,form,idFactory());assert.ok(changes.every(c=>c.id!=='base'&&c.id!=='brand'));assert.equal(changes[0].end,'2027-01-25');assert.equal(changes[1].assignments[0].targetCents,500000);
});
test('six-month history is seller-scoped, excludes the goal period and never counts wallet as sales',()=>{
  const facts=[{date:'2026-05-01',sellerId:4,actual:100,wallet:999},{date:'2026-10-01',sellerId:4,actual:300,wallet:0},{date:'2026-11-01',sellerId:4,actual:900,wallet:0},{date:'2026-10-01',sellerId:5,actual:200,wallet:0}];
  const rows=sellerSixMonthSales(facts,[4],'2026-11-01');assert.deepEqual(rows.map(r=>r.month),['2026-05','2026-06','2026-07','2026-08','2026-09','2026-10']);assert.equal(rows.reduce((s,r)=>s+r.value,0),400);assert.equal(sellerSixMonthSales(facts,[4,5],'2026-11-01').at(-1).value,500);
  assert.equal(sellerRegistrationStatus([{...base,status:'scheduled'}],4,base.start,base.end).state,'scheduled');assert.equal(sellerRegistrationStatus([base],4,base.start,base.end).state,'registered');assert.equal(sellerRegistrationStatus([{...base,status:'cancelled'}],4,base.start,base.end).state,'empty');
});
test('server validation refuses stale values and SQLite applies linked percentages transactionally',async()=>{
  assert.throws(()=>validateGoalAllocations([base,child],[{...base,assignments:[{sellerId:4,targetCents:1200000},{sellerId:5,targetCents:2000000}]}]),/GOAL_INVALID/);
  assert.throws(()=>validateGoalAllocations([base],[{...child,allocation:{parentId:'missing',basisPoints:5000}}]),/GOAL_INVALID/);
  assert.throws(()=>validateGoalAllocations([{...base,status:'closed'}],[child]),/GOAL_CLOSED/);
  const dir=await mkdtemp(path.join(tmpdir(),'fv-goal-registration-'));process.env.MONTHLY_GOALS_DATABASE_PATH=path.join(dir,'goals.sqlite');const store=await import('../db/goals.ts');
  const plan=buildGoalRegistration(data,draft(),idFactory());store.saveGoalSets(plan,7,'Gestor');const saved=store.listGoalSets();assert.equal(saved.length,3);assert.equal(saved.find(c=>c.id==='new-2').allocation.basisPoints,4000);
  const parent=saved.find(c=>c.id==='new-1');assert.throws(()=>store.saveGoalSets([{...parent,assignments:parent.assignments.map(a=>({...a,targetCents:1200000}))}],7,'Gestor'),/GOAL_INVALID/);assert.equal(store.listGoalSets().find(c=>c.id===parent.id).version,1);
  const other=store.listGoalSets().find(c=>c.id==='new-2');assert.throws(()=>store.saveGoalSets([{...other,version:0}],7,'Gestor'),/GOAL_CONFLICT/);assert.equal(store.goalAudit(saved.map(c=>c.id)).length,3);
  const payload={...data,campaigns:saved,catalog:{...data.catalog,sellers:[...data.catalog.sellers,{id:9,active:true}]}};
  assert.throws(()=>addSellerToGoal(payload,parent,4,'9000'),/já está vinculado/);
  assert.throws(()=>addSellerToGoal(payload,parent,8,'9000'),/vendedor ativo/);
  const changes=addSellerToGoal(payload,parent,9,'9000');
  store.saveGoalSets(changes,7,'Gestor');
  const updated=store.listGoalSets();assert.equal(updated.length,3);
  for(const [id,amount] of [['new-1',900000],['new-2',360000],['new-3',540000]]){
    const c=updated.find(c=>c.id===id);
    assert.deepEqual(c.assignments,[...saved.find(before=>before.id===id).assignments,{sellerId:9,targetCents:amount}]);
    assert.equal(c.version,2);
  }
  assert.throws(()=>cancelGoalFamily(updated.map(c=>c.id==='new-2'?{...c,editable:false}:c),updated.find(c=>c.id===parent.id)),/não pode ser excluída/);
  store.saveGoalSets(cancelGoalFamily(updated,updated.find(c=>c.id===parent.id)),7,'Gestor');
  assert.ok(store.listGoalSets().every(c=>c.status==='cancelled'));
  assert.equal(store.goalAudit(updated.map(c=>c.id)).length,9);
});
