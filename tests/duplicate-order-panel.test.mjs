import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { duplicateOrder } from '../app/order-duplication.ts';

const sourceCode = await readFile(new URL('../app/duplicate-order-panel.tsx', import.meta.url), 'utf8');
const js = ts.transpileModule(sourceCode.replace(/^import[^\n]+\n/gm, ''), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText.replace(/export /g, '');
const find = (node, predicate) => {
  if (!node || typeof node !== 'object') return;
  if (predicate(node)) return node;
  for (const child of (node.children || []).flat(Infinity)) { const result = find(child, predicate); if (result) return result; }
};
const button = (tree, text) => find(tree, node => node.type === 'button' && node.children.includes(text));
const tick = () => new Promise(resolve => setImmediate(resolve));
function panel({ sellerId = 123, onDuplicate = async () => {}, online = false, fetcher = async () => Response.json({ rows: [] }) } = {}) {
  const hooks = [], effects = [], callbacks = []; let index = 0, closed = false;
  const original = { id: 'source', updatedAt: 1, phase: 'review', partner: { CODPARC: 1, NOMEPARC: 'Cliente original' }, companyCode: 1, priceCode: 2, priceName: 'Tabela 2', cart: [{ CODPROD: 10, quantity: 3 }] };
  const dialog = { showModal() {}, close() {} };
  const bindings = {
    React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
    useState: initial => { const i = index++; if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial; return [hooks[i], next => { hooks[i] = typeof next === 'function' ? next(hooks[i]) : next; }]; },
    useRef: initial => { const i = index++; return hooks[i] ||= { current: initial }; },
    useId: () => 'duplicate-title',
    useEffect: (fn, deps) => { const i = index++; if (!hooks[i] || deps.some((v, j) => v !== hooks[i][j])) { hooks[i] = deps; effects.push(fn); } },
    document: { activeElement: null }, HTMLElement: class {}, fetch: fetcher, duplicateOrder,
    Copy: 'Copy', LoaderCircle: 'LoaderCircle', Search: 'Search', X: 'X',
  };
  const Component = new Function(...Object.keys(bindings), js + ';return DuplicateOrderPanel;')(...Object.values(bindings));
  const props = { source: original, userId: 116, sessionSellerId: 123, sellerId, sellerName: 'Vendedor', online,
    offlineData: { seller: { sellerId: 123 }, clients: [{ CODPARC: 2, NOMEPARC: 'Cliente destino', CGCCPF: '12345678901' }] },
    onClose() { closed = true; }, onDuplicate,
  };
  return {
    original,
    render() { index = 0; const tree = Component(props); tree.props.ref.current = dialog; while (effects.length) { const cleanup = effects.shift()(); if (cleanup) callbacks.push(cleanup); } return tree; },
    get closed() { return closed; },
  };
}

test('same-client copy requires explicit confirmation and cancellation does not save anything', async () => {
  const copies = [], ui = panel({ onDuplicate: async copy => copies.push(copy) });
  let tree = ui.render();
  assert.equal(button(tree, 'Duplicar e revisar').props.disabled, true);
  button(tree, 'Mesmo cliente').props.onClick(); tree = ui.render();
  assert.equal(button(tree, 'Duplicar e revisar').props.disabled, false);
  button(tree, 'Cancelar').props.onClick(); assert.equal(ui.closed, true); assert.equal(copies.length, 0);
});

test('selecting another client uses only the portfolio and preserves all source items', async () => {
  const copies = [], ui = panel({ onDuplicate: async copy => copies.push(copy) });
  button(ui.render(), 'Outro cliente da carteira').props.onClick(); ui.render();
  let tree = ui.render();
  assert.equal(button(tree, 'Duplicar e revisar').props.disabled, true);
  find(tree, n => n.type === 'input').props.onChange({ target: { value: '2' } }); tree = ui.render();
  find(tree, n => n.type === 'button' && find(n, c => c.type === 'strong' && c.children.includes('Cliente destino'))).props.onClick();
  tree = ui.render(); button(tree, 'Duplicar e revisar').props.onClick(); await tick();
  assert.equal(copies.length, 1); assert.equal(copies[0].partner.CODPARC, 2);
  assert.deepEqual(copies[0].cart, ui.original.cart); assert.equal(ui.original.partner.CODPARC, 1);
  assert.equal(copies[0].priceCode, 0);
});

test('double click and a failed-save retry reuse a single copy identity', async () => {
  const ids = []; let release;
  const ui = panel({ onDuplicate: copy => { ids.push(copy.id); return new Promise((_resolve, reject) => { release = () => reject(new Error('Storage unavailable')); }); } });
  button(ui.render(), 'Mesmo cliente').props.onClick(); let tree = ui.render();
  const confirm = button(tree, 'Duplicar e revisar'); confirm.props.onClick(); confirm.props.onClick();
  assert.equal(ids.length, 1); release(); await tick();
  tree = ui.render(); assert.ok(find(tree, n => n.props.role === 'alert'));
  button(tree, 'Duplicar e revisar').props.onClick(); assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]);
  release(); await tick();
});

test('offline portfolio from another seller is never offered as a destination', () => {
  const ui = panel({ sellerId: 999 });
  button(ui.render(), 'Outro cliente da carteira').props.onClick(); ui.render();
  const tree = ui.render();
  assert.equal(find(tree, n => n.type === 'strong' && n.children.includes('Cliente destino')), undefined);
  assert.equal(button(tree, 'Duplicar e revisar').props.disabled, true);
});
