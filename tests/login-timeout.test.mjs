import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const compile = source => ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
const timeout = () => new DOMException('deadline','TimeoutError');
const loginResponse = id => Response.json({ status:'1',responseBody:{jsessionid:{$:id},idusu:{$:btoa('7')}} });
const profileResponse = (active='S') => Response.json({ status:'1',responseBody:{fieldsMetadata:[{name:'CODVEND'},{name:'ATIVO'}],rows:[[4,active]]} });
const waitUntilAborted = signal => new Promise((_resolve,reject) => {
  if (signal?.aborted) reject(signal.reason);
  else signal?.addEventListener('abort',()=>reject(signal.reason),{once:true});
});

const integration = compile(await readFile(new URL('../app/api/_lib/sankhya.ts',import.meta.url),'utf8')).replace(/^export /gm,'');
function harness({onLogin, onProfile, onLogout}={}) {
  const calls=[], timers=[];
  const fetch=async (_url,init)=>{
    const {serviceName,requestBody}=JSON.parse(init.body);
    calls.push({serviceName,signal:init.signal,cookie:init.headers.Cookie});
    if (serviceName==='MobileLoginSP.login') {
      const technical=requestBody.NOMUSU.$==='technical-fixture';
      return onLogin ? onLogin(technical,init.signal) : loginResponse(technical?'tech-session':'user-session');
    }
    if (serviceName==='DbExplorerSP.executeQuery') return onProfile ? onProfile(init.signal) : profileResponse();
    if (serviceName==='MobileLoginSP.logout') return onLogout ? onLogout(init.signal) : Response.json({status:'1'});
    throw Error('Unexpected service');
  };
  const signals={timeout(ms){const controller=new AbortController();timers.push({ms,controller});return controller.signal;}};
  const env={SANKHYA_OM_BASE_URL:'https://fixture.invalid/mge/',SANKHYA_ACCESS_USER:'technical-fixture',SANKHYA_ACCESS_PASSWORD:'fixture'};
  const create=new Function('fetch','AbortSignal','process',integration+';return createApplicationSession;')(fetch,signals,{env});
  const abort = (ms,index=0) => timers.filter(timer=>timer.ms===ms)[index].controller.abort(timeout());
  return {calls,timers,create,abort};
}

test('login returns the technical session even while temporary logout is stalled, and bounds its cleanup', {timeout:5000}, async()=>{
  const h=harness({onLogout:waitUntilAborted});
  const session=await h.create('fixture','fixture');
  assert.equal(session.sellerId,4);assert.equal(session.jsessionid,'tech-session');
  const logout=h.calls.find(call=>call.serviceName==='MobileLoginSP.logout');
  assert.equal(logout.cookie,'JSESSIONID=user-session');assert.equal(logout.signal.aborted,false);
  h.abort(3000); await tick(); assert.equal(logout.signal.aborted,true);
});

test('the login deadline aborts both stalled authentication and stalled seller lookup', {timeout:5000}, async()=>{
  for (const stage of ['auth','profile']) {
    const h=harness(stage==='auth' ? {onLogin:(_technical,signal)=>waitUntilAborted(signal)} : {onProfile:waitUntilAborted});
    const pending=assert.rejects(h.create('fixture','fixture'),{name:'TimeoutError'});
    await tick(); h.abort(20000); await pending;
    assert.equal(h.calls.some(call=>call.serviceName==='MobileLoginSP.logout'),stage==='profile');
  }
});

test('one login deadline does not cancel the shared technical login for other attempts', {timeout:5000}, async()=>{
  let resolveTechnical;
  const h=harness({onLogin:(technical)=>technical?new Promise(resolve=>{resolveTechnical=resolve;}):loginResponse('user-session')});
  const first=assert.rejects(h.create('first','fixture'),{name:'TimeoutError'});
  const second=h.create('second','fixture');
  await tick(); h.abort(20000); await first;
  assert.equal(h.timers.filter(t=>t.ms===12000).length,1);
  assert.equal(h.timers.find(t=>t.ms===12000).controller.signal.aborted,false);
  resolveTechnical(loginResponse('tech-session'));
  assert.equal((await second).sellerId,4);
});

test('a failed technical login clears the shared pending promise so retry can recover', {timeout:5000}, async()=>{
  let attempts=0;
  const h=harness({onLogin:(technical,signal)=>!technical?loginResponse('user-session'):++attempts===1?waitUntilAborted(signal):loginResponse('tech-session')});
  const pending=assert.rejects(h.create('fixture','fixture'),{name:'TimeoutError'});
  await tick();h.abort(12000);await pending;
  assert.equal((await h.create('fixture','fixture')).sellerId,4);assert.equal(attempts,2);
});

test('seller permission checks still reject an inactive seller without waiting for logout', {timeout:5000}, async()=>{
  const h=harness({onProfile:()=>profileResponse('N'),onLogout:waitUntilAborted});
  await assert.rejects(h.create('fixture','fixture'),/inativo no Sankhya/);
  h.abort(3000);
});

test('login API distinguishes timeout from invalid credentials without setting a session cookie', async()=>{
  const source=await readFile(new URL('../app/api/auth/login/route.ts',import.meta.url),'utf8');
  const js=compile(source.replace(/^import \{[\s\S]*?\} from "[^\"]+";\s*/,'')).replace('export async function POST','return async function POST');
  for (const [error,status,expected] of [[timeout(),504,/demorou.*Tente novamente/],[new DOMException('aborted','AbortError'),504,/demorou.*Tente novamente/],[Error('Usuário ou senha inválidos.'),401,/inválidos/]]) {
    const POST=new Function('createApplicationSession',js)(async()=>{throw error;});
    const response=await POST(new Request('http://local',{method:'POST',body:JSON.stringify({username:'fixture',password:'fixture'})}));
    assert.equal(response.status,status);assert.equal(response.headers.get('set-cookie'),null);assert.match((await response.json()).error,expected);
  }
});

test('client timeout releases the login button and a later attempt can succeed', async()=>{
  const source=await readFile(new URL('../app/sales-app.tsx',import.meta.url),'utf8');
  const ast=ts.createSourceFile('sales-app.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const login=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='LoginScreen');
  const declaration=login.body.statements.find(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>d.name.getText(ast)==='submit'));
  const js=compile(declaration.getText(ast));
  const loading=[],errors=[],logins=[];let controller, attempts=0;
  const submit=new Function('api','AbortSignal','username','password','onLogin','setLoading','setError',js+';return submit;')(
    async (_url,init)=>++attempts===1?waitUntilAborted(init.signal):{user:'fixture',userId:7,sellerId:4,sellerName:'Vendedor'},
    {timeout(ms){assert.equal(ms,25000);controller=new AbortController();return controller.signal;}},'fixture','fixture',data=>logins.push(data),value=>loading.push(value),value=>errors.push(value));
  const event={preventDefault(){}};
  const pending=submit(event);assert.equal(loading.at(-1),true);controller.abort(timeout());await pending;
  assert.equal(loading.at(-1),false);assert.match(errors.at(-1),/demorou.*Tente novamente/);assert.equal(logins.length,0);
  await submit(event);assert.equal(loading.at(-1),false);assert.equal(logins[0].sellerId,4);
});
