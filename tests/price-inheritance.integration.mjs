// Read-only Oracle checks. Run with the training environment loaded.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { priceInheritanceCtes } from '../app/api/_lib/price-inheritance.ts';
import { loginSankhya, executeQuery } from '../app/api/_lib/sankhya.ts';

const session = await loginSankhya(process.env.SANKHYA_ACCESS_USER, process.env.SANKHYA_ACCESS_PASSWORD);
const query = (sql) => executeQuery(session, sql);
const chains = await query(`WITH ${priceInheritanceCtes()}
  SELECT CODTAB, CODTAB_FONTE, PRIORIDADE FROM HERANCA_PRECOS
  WHERE CODTAB IN (4,8,67) AND CICLO = 'N' ORDER BY CODTAB, PRIORIDADE`);
for (const [child, parent] of [[4,2],[8,63],[67,64]]) {
  assert.deepEqual(chains.filter(row => Number(row.CODTAB) === child).map(row => Number(row.CODTAB_FONTE)), [child,parent]);
}

// Execute the actual price selection used when validating an order, without
// calling the order submission endpoint or creating any Sankhya documents.
const source = await readFile(new URL('../app/api/sankhya/orders/route.ts', import.meta.url), 'utf8');
const selection = source.match(/const validRows = await executeQuery\(session, `([\s\S]*?)`\);/)[1];
for (const priceCode of [4,8,67]) {
  const company = priceCode === 4 ? 6 : 1;
  const makeSql = new Function('priceInheritanceCtes','company','priceCode','productCodes', `return \`${selection}\`;`);
  const rows = await query(makeSql(priceInheritanceCtes, company, priceCode, 'SELECT CODPROD FROM TGFPRO WHERE AD_MOBILIDADE = \'S\''));
  const parent = {4:2,8:63,67:64}[priceCode];
  const origins = await query(`SELECT NUTAB,CODTAB FROM TGFTAB WHERE CODTAB IN (${priceCode},${parent})`);
  const originById = new Map(origins.map(row => [Number(row.NUTAB),Number(row.CODTAB)]));
  assert.ok(rows.length > 0, `No eligible products in table ${priceCode}`);
  assert.ok(rows.some(row => originById.get(Number(row.NUTAB)) === parent), `No inherited products in table ${priceCode}`);
  assert.ok(rows.some(row => originById.get(Number(row.NUTAB)) === priceCode), `No own prices in table ${priceCode}`);
  const baseRows = await query(makeSql(priceInheritanceCtes, company, parent, 'SELECT CODPROD FROM TGFPRO WHERE AD_MOBILIDADE = \'S\''));
  const key = row => `${row.CODPROD}|${row.CODLOCAL}|${String(row.CONTROLE ?? '').trim()}`;
  const baseByKey = new Map(baseRows.map(row => [key(row),row]));
  for (const row of rows.filter(row => originById.get(Number(row.NUTAB)) === parent)) {
    assert.equal(Number(row.VLRVENDA),Number(baseByKey.get(key(row))?.VLRVENDA));
  }
  const ownSql = makeSql(priceInheritanceCtes, company, priceCode, 'SELECT CODPROD FROM TGFPRO WHERE AD_MOBILIDADE = \'S\'')
    .replace("AND H.CICLO = 'N'", "AND H.CICLO = 'N' AND H.PRIORIDADE = 0");
  const ownRows = await query(ownSql);
  const resolved = new Map(rows.map(row => [key(row),row]));
  for (const row of ownRows) {
    assert.equal(Number(resolved.get(key(row))?.VLRVENDA),Number(row.VLRVENDA));
    assert.equal(Number(resolved.get(key(row))?.NUTAB),Number(row.NUTAB));
  }
  console.log(`Table ${priceCode}: ${rows.length} balances; own prices and inheritance from ${parent} verified.`);
}

// Cycles terminate; self-reference terminates; the nearest parent has priority.
const fixture = [
  [900,901,5], [901,902,-2], [902,902,0], [903,904,0], [904,903,0],
].map(([code,parent,percentage]) => `SELECT ${code} CODTAB, ${parent} CODTABORIG,
  ${percentage} PERCENTUAL, ${code} NUTAB, TRUNC(SYSDATE) DTVIGOR FROM DUAL`).join(' UNION ALL ');
const fixtureCtes = priceInheritanceCtes().replace('FROM TGFTAB T', `FROM (${fixture}) T`);
const fixtureRows = await query(`WITH ${fixtureCtes} SELECT * FROM HERANCA_PRECOS WHERE CODTAB=900 AND CICLO='N' ORDER BY PRIORIDADE`);
assert.deepEqual(fixtureRows.map(row => [Number(row.CODTAB_FONTE), Number(row.PERCENTUAL)]), [[900,0],[901,5],[902,3]]);
const cycle = await query(`WITH ${fixtureCtes} SELECT * FROM HERANCA_PRECOS WHERE CODTAB=903 AND CICLO='N'`);
assert.equal(cycle.length,2);
console.log('Multi-level inheritance, additive percentages and cycles verified. No orders submitted.');

const dataSource = await readFile(new URL('../app/api/sankhya/data/route.ts', import.meta.url), 'utf8');
const syncSource = await readFile(new URL('../app/api/sankhya/sync/route.ts', import.meta.url), 'utf8');
const catalogSql = dataSource.slice(dataSource.indexOf('if (kind === "products")')).match(/const rows = await executeQuery\(session, `([\s\S]*?)`\);/)[1];
const groupSql = dataSource.match(/const eligibleItems = `([\s\S]*?)`;/)[1];
const offlineSql = [...syncSource.matchAll(/executeQuery\(session, `([\s\S]*?)`\)/g)].map(match => match[1]).find(sql => sql.includes('HERANCA_PRECOS'));
function interpolate(sql, values) {
  return new Function(...Object.keys(values), `return \`${sql}\`;`)(...Object.values(values));
}
for (const code of [4,8,67]) {
  const [client] = await query(`SELECT * FROM (
    SELECT P.CODPARC,P.CODVEND,E.CODEMP FROM TGFPAR P
    JOIN TGFPAEM E ON E.CODPARC=P.CODPARC
    WHERE E.CODTAB=${code} AND P.ATIVO='S' AND P.CLIENTE='S' AND P.CODVEND>0
    ORDER BY P.CODPARC) WHERE ROWNUM=1`);
  assert.ok(client, `Missing training client for table ${code}`);
  const values = {priceInheritanceCtes, company:Number(client.CODEMP), priceCode:code,
    partner:Number(client.CODPARC), dashboardSellerId:Number(client.CODVEND),
    bestSellersCte:'', bestSellersJoin:'', highlight:'', relevance:'0',
    groupFilter:'', brandFilter:'', highlightFilter:'', filter:'',
    productOrder:'DESCRPROD, CODPROD', firstProductRow:1,lastProductRow:50};
  const catalog = await query(interpolate(catalogSql, values));
  assert.ok(catalog.length);
  const eligible = await query(interpolate(groupSql,values) + ' SELECT COUNT(*) TOTAL FROM ITENS WHERE RN=1 AND VLRVENDA>0');
  assert.ok(Number(eligible[0].TOTAL)>0);
  const offline = await query(interpolate(offlineSql,{priceInheritanceCtes,session:{sellerId:Number(client.CODVEND)}}));
  const offlineByLot = new Map(offline.filter(row => Number(row.CODEMP)===values.company && Number(row.CODTAB)===code)
    .map(row => [`${row.CODPROD}|${row.CODLOCAL}|${String(row.CONTROLE??'').trim()}`,row]));
  for (const product of catalog) {
    const cached = offlineByLot.get(`${product.CODPROD}|${product.CODLOCAL}|${String(product.CONTROLE??'').trim()}`);
    assert.ok(cached, `Missing offline product ${product.CODPROD} table ${code}`);
    assert.equal(Number(cached.VLRVENDA),Number(product.VLRVENDA));
    assert.equal(Number(cached.NUTAB),Number(product.NUTAB));
  }
  console.log(`Table ${code}: catalog, group eligibility and offline prices match.`);
}
