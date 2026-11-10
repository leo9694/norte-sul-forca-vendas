import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { orderPricesSql } from './helpers/order-prices.mjs';
import { refreshDraftPrices } from '../app/draft-prices.ts';
import { applyPromotions, promotionUnitPrice } from '../app/promotional-prices.ts';

const source = await readFile(new URL('../app/api/sankhya/order-prices/route.ts',import.meta.url),'utf8');
const js = ts.transpileModule(source.replace(/^import[^\n]+\n/gm,''), { compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext} }).outputText;
async function request(body={}, {expired=false,manager=false,binding=true,missing=false,failed=false}={}) {
  const queries=[];
  const executeQuery=async (_s,sql)=>{
    queries.push(sql);
    if(failed) throw Error('private integration details');
    if(sql.includes('FROM TGFPAR P')) return binding ? [{CODEMP:1,CODTAB:4,NOMETAB:'MT AGROPECUARIAS'}] : [];
    if(missing) return [];
    const codes=sql.match(/X.CODPROD IN \(([^)]+)\)/)[1].split(',').map(Number);
    return codes.map(CODPROD=>({CODEMP:1,CODTAB:4,CODPROD,CODLOCAL:1010101,CONTROLE:' ',NUTAB:200,VLRVENDA:4.49}));
  };
  const POST = new Function('requireSession','canAnalyzeOtherSellers','executeQuery','readAllQueryRows','orderPricesSql', js.replace('export async function POST','return async function POST'))(
    async()=>{if(expired)throw Error('AUTH_REQUIRED');return {sellerId:4};},async()=>manager,executeQuery,(query,sql)=>query(sql),orderPricesSql);
  const response=await POST(new Request('http://local/api/sankhya/order-prices',{method:'POST',body:JSON.stringify({partner:1193,company:1,products:[1018],...body})}));
  return {response,body:await response.json(),queries};
}

test('reads the destination client table price independently of old item prices, lots and stock',async()=>{
  const result=await request({priceCode:999});
  assert.equal(result.response.status,200);assert.equal(result.body.priceCode,4);assert.equal(result.body.rows[0].VLRVENDA,4.49);
  assert.match(result.queries[0],/P.CODPARC=1193 AND P.CODVEND=4/);
  assert.match(result.queries[0],/AND E.CODEMP=1/);
  assert.match(result.queries[1],/SELECT 1 CODEMP,4 CODTAB FROM DUAL/);
  assert.match(result.queries[1],/TRIM\(X.CONTROLE\) IS NULL/);
  assert.doesNotMatch(result.queries[1],/TGFEST|ESTOQUE|RESERVADO|DTVAL/);
});
test('new destination with no selected company resolves the actual client binding rather than source table',async()=>{
  const result=await request({company:0,priceCode:999});
  assert.equal(result.response.status,200);assert.equal(result.body.company,1);assert.equal(result.body.priceCode,4);
  assert.doesNotMatch(result.queries[0],/AND E.CODEMP=/);
});
test('requires session, seller permission and portfolio membership before reading any prices',async()=>{
  for(const [body,options,status,count] of [
    [{},{expired:true},401,0],[{seller:8},{},403,0],[{},{binding:false},403,1],
    [{products:['1018 OR 1=1']},{},400,0],[{company:-1},{},400,0],[{products:[]},{},400,0],
    [{seller:8},{manager:true},200,2]]){
    const result=await request(body,options);assert.equal(result.response.status,status);assert.equal(result.queries.length,count);
  }
});
test('missing prices and failed queries do not return an old order price or partial successful copy',async()=>{
  const missing=await request({}, {missing:true});assert.equal(missing.response.status,409);assert.match(missing.body.error,/1018.*sem preço válido/);
  const failed=await request({}, {failed:true});assert.equal(failed.response.status,503);assert.doesNotMatch(failed.body.error,/private integration/);
});
test('price lookup handles more than Oracle IN limit and removes repeated product IDs',async()=>{
  const result=await request({products:[...Array.from({length:1001},(_,i)=>i+1),1018]});
  assert.equal(result.response.status,200);assert.equal(result.body.rows.length,1002);assert.equal(result.queries.length,3);
});
test('1018 duplicate replaces 3.79 historical base with 4.49 from table before promotion, producing 3.79 and 37.90',()=>{
  const original={CODPROD:1018,CODLOCAL:1010101,CONTROLE:'old lot',CODVOL:'UN',VLRVENDA:3.79,NUTAB:100,quantity:10,adjustmentPercent:0,promotionalPrice:3.199139,promotionId:778};
  const price={...original,CODEMP:1,CODTAB:4,CONTROLE:' ',VLRVENDA:4.49,NUTAB:200};
  const data={rules:[{NUPROMOCAO:778,DTINICIAL:'08112026 00:00:00',DTFINAL:'30112027 00:00:00',GRUPODESCPARC:'DESC379',GRUPODESCPROD:'GOLDEN',PERCENTUAL:15.59,CODEMP:0}],partners:[{CODPARC:1193,GRUPODESCPARC:'DESC379'}],products:[{CODPROD:1018,GRUPODESCPROD:'GOLDEN'}],negotiations:[{CODTIPVENDA:37,DESCPROM:'D'}],parameters:[],bands:[],seller:4,sellerGroup:''};
  const context={partner:1193,company:1,table:4,negotiation:37,operation:5,date:'2026-11-10'};
  const current=applyPromotions(refreshDraftPrices([original],[price],1,4,true),data,context);
  assert.equal(current[0].VLRVENDA,4.49);assert.equal(promotionUnitPrice(current[0]).toFixed(2),'3.79');assert.equal((promotionUnitPrice(current[0])*10).toFixed(2),'37.90');
  assert.equal(current[0].CONTROLE.trim(),'');assert.equal(current[0].quantity,10);assert.equal(original.VLRVENDA,3.79);
  assert.equal(applyPromotions(refreshDraftPrices(current,[price],1,4,true),data,context),current);
  assert.throws(()=>refreshDraftPrices([original],[],1,4,true),/sem preço válido/);
});
