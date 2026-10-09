import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../app/sales-app.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('sales-app.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const app = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'SalesApp');
function localFunction(name, bindings) {
  const statement = app.body.statements.find(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(declaration => declaration.name.getText(ast) === name));
  const js = ts.transpileModule(statement.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(bindings), `${js}; return ${name};`)(...Object.values(bindings));
}

function loader({ online = true, save = async () => {}, fetch = async () => ({ seller: { sellerId: 10 } }) } = {}) {
  const events = [];
  const record = name => value => events.push([name, value]);
  const makeLoad = localFunction('makeLoad', {
    navigator: { onLine: online }, api: fetch, saveOfflineSnapshot: save,
    localStorage: { setItem: record('storage') }, OFFLINE_SESSION_KEY: 'offline',
    applySnapshot: record('apply'), setSyncing: record('syncing'), setLoadError: record('error'),
    setLoadStage: record('stage'), setToast: record('toast'), returnToLogin: record('login'),
    ApiError: class extends Error {},
  });
  return { events, makeLoad };
}

test('only releases the first load after local persistence completes', async () => {
  let finishSave;
  const pendingSave = new Promise(resolve => { finishSave = resolve; });
  const { events, makeLoad } = loader({ save: () => pendingSave });
  const pending = makeLoad();
  await Promise.resolve();
  assert.ok(events.some(([name, value]) => name === 'stage' && value.includes('Salvando')));
  assert.ok(!events.some(([name]) => name === 'apply'));
  finishSave();
  await pending;
  assert.ok(events.some(([name]) => name === 'apply'));
  assert.deepEqual(events.at(-1), ['syncing', false]);
});

test('failed persistence keeps the app locked and offers a retry', async () => {
  const { events, makeLoad } = loader({ save: async () => { throw new Error('Armazenamento indisponível'); } });
  assert.equal(await makeLoad(), null);
  assert.ok(!events.some(([name]) => name === 'apply'));
  assert.ok(events.some(([name, value]) => name === 'error' && value === 'Armazenamento indisponível'));
});

test('offline first load does not attempt a request or unlock the app', async () => {
  const { events, makeLoad } = loader({ online: false, fetch: () => { throw new Error('Unexpected request'); } });
  assert.equal(await makeLoad(), null);
  assert.ok(events.some(([name]) => name === 'error'));
  assert.ok(!events.some(([name]) => name === 'apply'));
});

test('reads only the current seller cache without replacing the authenticated identity', async () => {
  const events = [];
  const loadCachedData = localFunction('loadCachedData', {
    getOfflineSnapshot: async id => { events.push(['seller', id]); return { clients: [], orders: [], seller: { userId: 99 } }; },
    setOfflineData: data => events.push(['cache', data]), setClients: () => {}, setOrders: () => {},
    filterOrdersByPeriod: orders => orders, currentMonthStart: () => '', inputDate: () => '',
  });
  await loadCachedData(10);
  assert.deepEqual(events[0], ['seller', 10]);
  assert.equal(events[1][0], 'cache');
});

test('blocks the app shell without a seller-matched snapshot and renders an indeterminate progress bar', () => {
  const gate = source.indexOf('if (!offlineData || offlineData.seller.sellerId !== sellerId)');
  assert.ok(gate > 0 && gate < source.indexOf('<div className="app-shell">'));
  assert.match(source.slice(gate), /<progress[^>]+aria-label="Primeira carga em andamento"/);
  assert.match(source.slice(gate), /Tentar novamente/);
  assert.match(source, /await loadCachedData\(Number\(result.sellerId \|\| 0\)\)/);
  assert.match(source, /loadCachedData\(loginData.sellerId\).then\(\(\) => makeLoad\(\)\)/);
});
