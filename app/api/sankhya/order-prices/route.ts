import { executeQuery, requireSession, canAnalyzeOtherSellers } from '../../_lib/sankhya';
import { readAllQueryRows } from '../../_lib/query-pagination';
import { orderPricesSql } from '../../_lib/order-prices';

export async function POST(request: Request) {
  try {
    const session = await requireSession(request);
    const body = await request.json();
    const seller = Number(body.seller || session.sellerId), partner = Number(body.partner), company = Number(body.company || 0);
    if (![seller,partner].every(n => Number.isSafeInteger(n) && n>0) || !Number.isSafeInteger(company) || company<0
      || !Array.isArray(body.products) || !body.products.length || !body.products.every((n: unknown) => Number.isSafeInteger(n) && Number(n)>0)) {
      return Response.json({ error: 'Informe cliente, empresa e produtos válidos.' }, { status: 400 });
    }
    if (seller!==session.sellerId && !await canAnalyzeOtherSellers(session)) return Response.json({ error: 'Sem permissão.' }, { status: 403 });
    const bindings = await executeQuery(session, `SELECT E.CODEMP,E.CODTAB,N.NOMETAB FROM TGFPAR P
      JOIN TGFPAEM E ON E.CODPARC=P.CODPARC JOIN TGFNTA N ON N.CODTAB=E.CODTAB
      WHERE P.CODPARC=${partner} AND P.CODVEND=${seller} AND P.CLIENTE='S' AND P.ATIVO='S'
        AND N.ATIVO='S' AND NVL(N.AD_MOBILIDADE,'N')='S' ${company ? `AND E.CODEMP=${company}` : ''}
      ORDER BY E.CODEMP`);
    const binding = bindings[0];
    if (!binding) return Response.json({ error: 'Cliente fora da carteira ou sem tabela habilitada nesta empresa.' }, { status: 403 });
    const priceCode = Number(binding.CODTAB), companyCode = Number(binding.CODEMP);
    const products = [...new Set<number>(body.products)];
    const rows = [];
    for (let start=0; start<products.length; start+=1000) {
      const sql = orderPricesSql(`SELECT ${companyCode} CODEMP,${priceCode} CODTAB FROM DUAL`, products.slice(start,start+1000));
      rows.push(...await readAllQueryRows(page => executeQuery(session,page),sql));
    }
    const found = new Set(rows.map(row => Number(row.CODPROD)));
    const missing = products.filter(code => !found.has(code));
    if (missing.length) return Response.json({ error: `Produto(s) ${missing.join(', ')} sem preço válido na tabela do cliente. O pedido original foi mantido.` }, { status: 409 });
    return Response.json({ company: companyCode, priceCode, priceName: String(binding.NOMETAB), rows }, { headers: { 'Cache-Control':'private, no-store' } });
  } catch (error) {
    const auth = error instanceof Error && error.message==='AUTH_REQUIRED';
    return Response.json({ error: auth ? 'Sessão expirada.' : 'Não foi possível atualizar os preços da tabela. Os itens foram mantidos; tente novamente.' }, { status: auth ? 401 : 503 });
  }
}
