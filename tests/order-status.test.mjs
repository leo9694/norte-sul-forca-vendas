import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { isOrderBilled, canDownloadOrderNfe, canDownloadOrderBoleto, orderConferenceLabel } from '../app/order-status.ts';
import { invoiceCondition, linkedInvoiceQuery, orderBillingFields } from '../app/api/_lib/order-status.ts';
import { normalizeOrderDocuments, publicDocumentError } from '../app/api/_lib/order-documents.js';

test('source order release and legacy offline flags alone never imply confirmed billing', () => {
  for (const row of [{ STATUSNOTA: 'L', FATURADO: 'N' }, { STATUSNOTA: 'L', FATURADO: 'S' }, { FATURADO: 'S', STATUS_FATURAMENTO: 'A' }]) {
    assert.equal(isOrderBilled(row), false);
    assert.equal(canDownloadOrderNfe({ ...row, NFE_DISPONIVEL: 'S' }), false);
    assert.equal(canDownloadOrderBoleto({ ...row, BOLETO_DISPONIVEL: 'S' }), false);
  }
  const confirmed = { FATURADO: 'S', STATUS_FATURAMENTO: 'L', NFE_DISPONIVEL: 'N', BOLETO_DISPONIVEL: 'S' };
  assert.equal(isOrderBilled(confirmed), true);
  assert.equal(canDownloadOrderNfe(confirmed), false);
  assert.equal(canDownloadOrderBoleto(confirmed), true);
  assert.equal(canDownloadOrderNfe({ ...confirmed, NFE_DISPONIVEL: 'S' }), true);
});
test('conference labels respect the different standard and custom field codes', () => {
  assert.equal(orderConferenceLabel({ STATUS_CONFERENCIA: 'C', ORIGEM_CONFERENCIA: 'APP' }), 'Conferido');
  assert.equal(orderConferenceLabel({ STATUS_CONFERENCIA: 'C', ORIGEM_CONFERENCIA: 'PADRAO' }), 'Aguardando liberação de corte');
  assert.equal(orderConferenceLabel({ STATUS_CONFERENCIA: 'CD', ORIGEM_CONFERENCIA: 'APP' }), 'Conferido com divergência');
  assert.equal(orderConferenceLabel({ STATUS_CONFERENCIA: 'F', ORIGEM_CONFERENCIA: 'PADRAO' }), 'Conferido');
  assert.equal(orderConferenceLabel({}), 'Aguardando conferência');
});
test('all billing flags require confirmed sales invoices from TOP 35 or 10; conference also reads unconfirmed notes', () => {
  assert.match(invoiceCondition(), /F.CODTIPOPER IN \(35, 10\).*F.TIPMOV = 'V'.*F.STATUSNOTA = 'L'/);
  assert.doesNotMatch(invoiceCondition('F', false), /STATUSNOTA/);
  const fields = orderBillingFields();
  assert.match(fields, /F.STATUSNFE = 'A'/);
  assert.match(fields, /LENGTH\(TRIM\(N.CHAVENFE\)\) = 44/);
  assert.match(fields, /FIN.DHBAIXA IS NULL/);
  assert.match(fields, /FIN.CODCTABCOINT > 0/);
  assert.match(fields, /LEFT JOIN TGFCON2 CF ON CF.NUCONF = F.NUCONFATUAL/);
  assert.match(fields, /NVL\(F.AD_STATUS_CONFERENCIA_Z, CF.STATUS\)/);
  assert.doesNotMatch(fields, /F\.STATUSCONFERENCIA/); // Campo virtual, não existe fisicamente no Oracle.
});
test('document normalization blocks unconfirmed or unrelated invoices regardless of fiscal key or boleto', () => {
  const base = { NUNOTA: 2, CODTIPOPER: 35, TIPMOV: 'V', STATUSNOTA: 'L', STATUSNFE: 'A', CHAVENFE: '1'.repeat(44) };
  for (const extra of [{ STATUSNOTA: 'A' }, { CODTIPOPER: 5 }, { CODTIPOPER: 99 }, { TIPMOV: 'D' }]) {
    const doc = normalizeOrderDocuments({ ...base, ...extra }, [{ NUFIN: 1, CODCTABCOINT: 2 }]);
    assert.equal(doc.billed, false); assert.equal(doc.nfe.available, false); assert.deepEqual(doc.boletos, []);
  }
  for (const top of [35, 10]) assert.equal(normalizeOrderDocuments({ ...base, CODTIPOPER: top }).billed, true);
});

const dataSource = await readFile(new URL('../app/api/sankhya/data/route.ts', import.meta.url), 'utf8');
test('online date filters use confirmed invoice dates but retain negotiation dates for unbilled orders', async () => {
  const js = ts.transpileModule(dataSource.replace(/^import[^\n]+\n/gm, ''), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/export /g, '');
  const queries = [];
  const bindings = { requireSession: async () => ({ sellerId: 123 }), canAnalyzeOtherSellers: async () => false,
    executeQuery: async (_session, sql) => { queries.push(sql); return []; }, priceInheritanceCtes: () => '', linkedInvoiceQuery, orderBillingFields };
  const GET = new Function(...Object.keys(bindings), js + ';return GET;')(...Object.values(bindings));
  assert.equal((await GET(new Request('http://local?kind=orders&dateFrom=2026-10-01&dateTo=2026-10-31'))).status, 200);
  assert.match(queries[0], /F.DTENTSAI >= TO_DATE\('01\/10\/2026'/);
  assert.match(queries[0], /NOT EXISTS[\s\S]*F.STATUSNOTA = 'L'[\s\S]*C.DTNEG >=/);
  assert.match(queries[0], /C.CODVEND = 123/);
});

const documentSource = await readFile(new URL('../app/api/sankhya/order-documents/route.ts', import.meta.url), 'utf8');
async function documentApi(invoice) {
  let prints = 0;
  const js = ts.transpileModule(documentSource.replace(/^import[^\n]+\n/gm, ''), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/export /g, '');
  const bindings = { requireSession: async () => ({ sellerId: 123 }), canAnalyzeOtherSellers: async () => false, invoiceCondition, normalizeOrderDocuments, publicDocumentError,
    executeQuery: async (_session, sql) => sql.includes('SELECT DISTINCT DEST.NUNOTA') ? [{ NUNOTA: 2 }] : sql.includes('WHERE C.NUNOTA = 1') ? [{ NUNOTA: 1, CODVEND: 123, TIPMOV: 'P', CODTIPOPER: 5 }] : [invoice],
    callSankhya: async () => { prints++; return { responseBody: { documento: { valor: 'test-key' } } }; },
    downloadSankhyaFile: async () => ({ buffer: new TextEncoder().encode('%PDF-1.4 test') }),
  };
  return { GET: new Function(...Object.keys(bindings), js + ';return GET;')(...Object.values(bindings)), get prints() { return prints; } };
}
test('direct download requests cannot bypass confirmation and fiscal authorization checks', async () => {
  const base = { NUNOTA: 2, CODVEND: 123, CODTIPOPER: 35, TIPMOV: 'V', STATUSNOTA: 'L', STATUSNFE: 'A', CHAVENFE: '1'.repeat(44) };
  for (const extra of [{ STATUSNOTA: 'A' }, { STATUSNFE: 'R' }, { CODTIPOPER: 99 }]) {
    const api = await documentApi({ ...base, ...extra });
    assert.equal((await api.GET(new Request('http://local?nunota=1&action=danfe'))).status, 409);
    assert.equal(api.prints, 0);
  }
  const ok = await documentApi(base);
  assert.equal((await ok.GET(new Request('http://local?nunota=1&action=danfe'))).status, 200);
  assert.equal(ok.prints, 1);
});
