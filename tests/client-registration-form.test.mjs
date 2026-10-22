import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { cleanDocument, digits, emptyClientRegistration, emptyContact, validateClientStep } from '../app/client-registration-model.ts';

const source = await readFile(new URL('../app/client-registration-form.tsx', import.meta.url), 'utf8');
const js = ts.transpileModule(source.replace(/^import[^\n]+\n/gm, ''), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText.replace(/export /g, '');
const key = 'norte-sul-vendas:client-registration:116:123';
const find = (node, predicate) => {
  if (!node || typeof node !== 'object') return;
  if (predicate(node)) return node;
  for (const child of (node.children || []).flat(Infinity)) { const result = find(child, predicate); if (result) return result; }
};

function form(storage, fetcher = async () => Response.json({ rows: [] })) {
  const hooks = [], pending = [], cleanups = []; let cursor = 0, didClose = false;
  const bindings = {
    React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
    useState: initial => { const i = cursor++; if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial; return [hooks[i], value => { hooks[i] = typeof value === 'function' ? value(hooks[i]) : value; }]; },
    useRef: initial => { const i = cursor++; return hooks[i] ||= { current: initial }; },
    useEffect: (effect, deps) => { const i = cursor++; if (!hooks[i] || deps.some((v, j) => v !== hooks[i][j])) { hooks[i] = deps; pending.push(effect); } },
    cleanDocument, digits, emptyClientRegistration, emptyContact, validateClientStep,
    RegistrationFeedbackPanel: 'RegistrationFeedbackPanel',
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    fetch: fetcher,
    ...Object.fromEntries(['ArrowLeft', 'Check', 'LoaderCircle', 'Plus', 'Search', 'Trash2', 'X'].map(name => [name, name])),
  };
  const Component = new Function(...Object.keys(bindings), js + ';return ClientRegistrationForm;')(...Object.values(bindings));
  return {
    render() {
      cursor = 0;
      const tree = Component({ userId: 116, sessionSellerId: 123, sellerId: 123, sellerName: 'Teste', online: true, onClose: () => { didClose = true; }, onCreated() {} });
      while (pending.length) { const cleanup = pending.shift()(); if (cleanup) cleanups.push(cleanup); }
      return tree;
    },
    close(tree) { find(tree, n => n.props['aria-label'] === 'Fechar e limpar cadastro').props.onClick(); for (const cleanup of cleanups) cleanup(); },
    get didClose() { return didClose; },
  };
}

test('closing discards the customer form and reopening starts blank with a new request id', () => {
  const data = { ...emptyClientRegistration(123, crypto.randomUUID()), tradeName: 'Nome anterior', document: '11111111000111' };
  const storage = new Map([[key, JSON.stringify({ data, step: 0, partnerId: 0, uncertain: false })], ['unrelated-order-draft', 'preserve']]);
  const screen = form(storage); const tree = screen.render(); screen.close(tree);
  assert.equal(screen.didClose, true); assert.equal(storage.has(key), false);
  const reopened = form(storage); reopened.render();
  const saved = JSON.parse(storage.get(key));
  assert.equal(saved.data.tradeName, ''); assert.equal(saved.data.document, ''); assert.equal(saved.step, 0);
  assert.notEqual(saved.data.requestId, data.requestId);
  assert.equal(storage.get('unrelated-order-draft'), 'preserve');
});

test('a lookup finishing after close cannot refill the form or recreate its storage', async () => {
  let resolveLookup;
  const data = { ...emptyClientRegistration(123, crypto.randomUUID()), document: '11111111000111' };
  const storage = new Map([[key, JSON.stringify({ data, step: 0 })]]);
  const screen = form(storage, url => url.includes('cnpj') ? new Promise(resolve => { resolveLookup = resolve; }) : Promise.resolve(Response.json({ rows: [] })));
  const tree = screen.render();
  find(tree, n => n.props.label === 'CNPJ').props.onBlur();
  screen.close(tree);
  resolveLookup(Response.json({ tradeName: 'Resposta atrasada' }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(storage.has(key), false);
  form(storage).render();
  assert.equal(JSON.parse(storage.get(key)).data.tradeName, '');
});

test('interrupted submissions are retained separately for explicit recovery, not automatic refill', () => {
  for (const partial of [{ partnerId: 8000, uncertain: false }, { partnerId: 0, uncertain: true }]) {
    const data = { ...emptyClientRegistration(123, crypto.randomUUID()), tradeName: 'Envio anterior' };
    const storage = new Map([[key, JSON.stringify({ data, step: 2, ...partial })]]);
    const screen = form(storage); screen.close(screen.render());
    assert.equal(storage.has(key), false);
    assert.equal(JSON.parse(storage.get(`${key}:recovery`)).data.requestId, data.requestId);
    const reopened = form(storage); const tree = reopened.render();
    assert.equal(JSON.parse(storage.get(key)).data.tradeName, '');
    const resume = find(tree, n => n.children.includes('Retomar envio anterior'));
    assert.ok(resume); resume.props.onClick(); reopened.render();
    const recovered = JSON.parse(storage.get(key));
    assert.equal(recovered.data.requestId, data.requestId);
    assert.equal(recovered.partnerId, partial.partnerId); assert.equal(recovered.uncertain, partial.uncertain);
  }
});

test('validation errors open a dismissible panel without clearing entered customer data', () => {
  const data = { ...emptyClientRegistration(123, crypto.randomUUID()), tradeName: 'Preservar cliente' };
  const storage = new Map([[key, JSON.stringify({ data, step: 0 })]]);
  const screen = form(storage); const tree = screen.render();
  find(tree, n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  const panel = find(screen.render(), n => n.type === 'RegistrationFeedbackPanel');
  assert.equal(panel.props.kind, 'error'); assert.ok(panel.props.message);
  panel.props.onClose();
  assert.equal(find(screen.render(), n => n.type === 'RegistrationFeedbackPanel'), undefined);
  assert.equal(JSON.parse(storage.get(key)).data.tradeName, 'Preservar cliente');
});

test('hides ICMS classification and returns to basic data when the ERP requires IE', async () => {
  const data = { ...emptyClientRegistration(123, crypto.randomUUID()), tradeName: 'Cliente', legalName: 'Cliente Ltda', phone: '66999991234', profileId: 1,
    contacts: [{ name: 'Contato', phone: '66999991234', mobile: '', email: 'contato@example.com', role: 'Comprador' }],
    postalCode: '87485000', street: 'Rodovia Teste', number: 'SN', neighborhood: 'Centro', city: 'Douradina', cityId: 2304, state: 'PR' };
  const storage = new Map([[key, JSON.stringify({ data, step: 1 })]]);
  let screen = form(storage);
  assert.equal(find(screen.render(), n => n.props.label === 'Classificação ICMS padrão'), undefined);
  storage.set(key, JSON.stringify({ data, step: 3 }));
  screen = form(storage, async (_url, init) => init?.method === 'POST'
    ? Response.json({ code: 'STATE_REGISTRATION_REQUIRED', error: 'Informe a inscrição estadual nos dados básicos.' }, { status: 400 }) : Response.json({ rows: [] }));
  const tree = screen.render();
  await find(tree, n => n.type === 'form').props.onSubmit({ preventDefault() {} });
  const next = screen.render();
  assert.equal(JSON.parse(storage.get(key)).step, 0);
  assert.equal(JSON.parse(storage.get(key)).data.cityId, 2304);
  assert.match(find(next, n => n.type === 'RegistrationFeedbackPanel').props.message, /inscrição estadual/);
  assert.ok(find(next, n => n.props.label === 'Inscrição estadual'));
});

test('error and success panels use a modal dialog, accessible labels and explicit dismissal', async () => {
  const panelSource = await readFile(new URL('../app/registration-feedback-panel.tsx', import.meta.url), 'utf8');
  const panelJs = ts.transpileModule(panelSource.replace(/^import[^\n]+\n/gm, ''), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText.replace(/export /g, '');
  for (const kind of ['error', 'success']) {
    let opened = false, closed = false, dismissed = 0, focused = false, id = 0;
    class Element { isConnected = true; focus() { focused = true; } }
    const effects = [], dialog = { showModal() { opened = true; }, close() { closed = true; } };
    const bindings = {
      React: { createElement: (type, props, ...children) => ({ type, props, children }) },
      useRef: () => ({ current: dialog }), useId: () => `panel-${++id}`, useEffect: effect => effects.push(effect),
      document: { activeElement: new Element() }, HTMLElement: Element, Check: 'Check', X: 'X',
    };
    const Panel = new Function(...Object.keys(bindings), panelJs + ';return RegistrationFeedbackPanel;')(...Object.values(bindings));
    const tree = Panel({ kind, message: 'Mensagem do cadastro', onClose: () => dismissed++ });
    const cleanup = effects[0]();
    assert.equal(opened, true); assert.equal(tree.type, 'dialog'); assert.equal(tree.props.role, 'alertdialog');
    assert.ok(find(tree, n => n.props?.id === tree.props['aria-describedby']));
    const button = find(tree, n => n.type === 'button');
    assert.equal(button.props.autoFocus, true); button.props.onClick();
    assert.equal(dismissed, 1);
    let prevented = false; tree.props.onCancel({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.equal(dismissed, 2);
    cleanup(); assert.equal(closed, true); assert.equal(focused, true);
  }
});
