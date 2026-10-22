import { executeQuery, type SankhyaSession } from './sankhya';
import { readAllQueryRows } from './query-pagination';

export async function loadClientDetails(session: SankhyaSession, partnerId: number, sellerId: number) {
  const [client] = await executeQuery(session, `
    SELECT P.CODPARC,P.NOMEPARC,P.RAZAOSOCIAL,P.CGC_CPF CGCCPF,P.TIPPESSOA,
           P.IDENTINSCESTAD INSCESTAD,P.TELEFONE,P.FAX CELULAR,P.EMAIL,P.EMAILNFE,
           P.CODVEND,V.APELIDO VENDEDOR,P.CODTIPPARC,T.DESCRTIPPARC PERFIL,
           EN.TIPO TIPOEND,EN.NOMEEND ENDERECO,P.NUMEND,P.COMPLEMENTO,B.NOMEBAI BAIRRO,
           P.CEP,CI.NOMECID,U.UF,CI.CODMUNFIS
      FROM TGFPAR P
      LEFT JOIN TGFVEN V ON V.CODVEND=P.CODVEND
      LEFT JOIN TGFTPP T ON T.CODTIPPARC=P.CODTIPPARC
      LEFT JOIN TSIEND EN ON EN.CODEND=P.CODEND
      LEFT JOIN TSIBAI B ON B.CODBAI=P.CODBAI
      LEFT JOIN TSICID CI ON CI.CODCID=P.CODCID
      LEFT JOIN TSIUFS U ON U.CODUF=CI.UF
     WHERE P.CODPARC=${partnerId} AND P.CODVEND=${sellerId} AND P.CLIENTE='S' AND P.ATIVO='S'
  `);
  if (!client) return null;
  const query = (sql: string) => readAllQueryRows(page => executeQuery(session, page), sql);
  const [contacts, orders] = await Promise.all([
    query(`SELECT CODCONTATO,NOMECONTATO,TELEFONE,CELULAR,EMAIL,CARGO FROM TGFCTT
            WHERE CODPARC=${partnerId} AND ATIVO='S' ORDER BY NOMECONTATO,CODCONTATO`),
    query(`SELECT C.NUNOTA,C.NUMNOTA,C.CODPARC,C.CODTIPOPER,C.DTNEG,C.VLRNOTA,C.STATUSNOTA,C.PENDENTE,
             (SELECT MAX(F.DTENTSAI) FROM TGFVAR V JOIN TGFCAB F ON F.NUNOTA=V.NUNOTA AND F.TIPMOV<>'P'
               WHERE V.NUNOTAORIG=C.NUNOTA) DTFAT,
             CASE WHEN EXISTS (SELECT 1 FROM TGFVAR V JOIN TGFCAB F ON F.NUNOTA=V.NUNOTA AND F.TIPMOV<>'P'
               WHERE V.NUNOTAORIG=C.NUNOTA) THEN 'S' ELSE 'N' END FATURADO
            FROM TGFCAB C WHERE C.CODPARC=${partnerId} AND C.CODVEND=${sellerId}
             AND C.CODTIPOPER IN (5,6) AND C.TIPMOV='P' ORDER BY C.NUNOTA DESC`),
  ]);
  return { client, contacts, orders, savedAt: Date.now() };
}
