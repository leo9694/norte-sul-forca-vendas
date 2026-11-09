import { executeQuery, type SankhyaSession } from './sankhya';
import { readAllQueryRows } from './query-pagination';
import type { Promotions, PromotionRow } from '../../promotional-prices';

export async function loadPromotions(session: SankhyaSession, seller = session.sellerId): Promise<Promotions> {
  const query = async (sql: string) => await readAllQueryRows(page => executeQuery(session, page), sql) as PromotionRow[];
  const scope = `D.DTFINAL >= TRUNC(SYSDATE) AND (NVL(D.CODVEND,0)=0 OR D.CODVEND=${seller})
    AND EXISTS (SELECT 1 FROM TGFPAR P LEFT JOIN TGFCPL C ON C.CODPARC=P.CODPARC
      WHERE P.CODVEND=${seller} AND P.CLIENTE='S' AND P.ATIVO='S'
        AND (NVL(D.CODPARC,0)=0 OR D.CODPARC=P.CODPARC)
        AND (NVL(TRIM(D.GRUPODESCPARC),'***************')='***************'
          OR UPPER(TRIM(D.GRUPODESCPARC))=UPPER(TRIM(C.GRUPODESCPARC))))`;
  const [rules, bands, partners, products, negotiations, parameters, sellers] = await Promise.all([
    query(`SELECT D.* FROM TGFDES D WHERE ${scope} ORDER BY D.NUPROMOCAO`),
    query(`SELECT Q.NUPROMOCAO,Q.QTDE,Q.PERCDESC,Q.TIPDESC FROM TGFDPQ Q JOIN TGFDES D ON D.NUPROMOCAO=Q.NUPROMOCAO WHERE ${scope} ORDER BY Q.NUPROMOCAO,Q.QTDE`),
    query(`SELECT P.CODPARC,UPPER(TRIM(C.GRUPODESCPARC)) GRUPODESCPARC FROM TGFPAR P LEFT JOIN TGFCPL C ON C.CODPARC=P.CODPARC WHERE P.CODVEND=${seller} AND P.CLIENTE='S' AND P.ATIVO='S' ORDER BY P.CODPARC`),
    // O grupo é metadado de preço, não uma autorização de venda. Um item de
    // pedido antigo também precisa desse vínculo ao ser duplicado; estoque e
    // mobilidade continuam sendo validados nas consultas e no envio do pedido.
    query(`SELECT CODPROD,UPPER(TRIM(GRUPODESCPROD)) GRUPODESCPROD FROM TGFPRO WHERE GRUPODESCPROD IS NOT NULL ORDER BY CODPROD`),
    query(`SELECT V.CODTIPVENDA,V.DESCPROM FROM TGFTPV V WHERE V.DHALTER=(SELECT MAX(X.DHALTER) FROM TGFTPV X WHERE X.CODTIPVENDA=V.CODTIPVENDA) AND V.ATIVO='S' ORDER BY V.CODTIPVENDA`),
    query(`SELECT CHAVE,LOGICO,INTEIRO,TEXTO FROM TSIPAR WHERE CHAVE IN ('USAMAIDESCPROMO','REGRAEXCDESCQTD') ORDER BY CHAVE`),
    query(`SELECT UPPER(TRIM(GRUPODESCVEND)) GRUPODESCVEND FROM TGFVEN WHERE CODVEND=${seller}`),
  ]);
  return { rules, bands, partners, products, negotiations, parameters, sellerGroup: String(sellers[0]?.GRUPODESCVEND ?? ''), seller };
}
