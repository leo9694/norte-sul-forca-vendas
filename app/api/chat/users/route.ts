import { executeQuery, requireSession } from "../../_lib/sankhya";

const safeSearch = (value: string | null) =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N} ._-]/gu, "")
    .trim()
    .toUpperCase()
    .slice(0, 60);

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    const query = safeSearch(new URL(request.url).searchParams.get("q"));
    if (!query) return Response.json({ rows: [] });
    const rows = await executeQuery(session, `
      SELECT * FROM (
        SELECT U.CODUSU,
               NVL(NULLIF(TRIM(U.NOMEUSUCPLT), ''), U.NOMEUSU) NOME,
               U.NOMEUSU LOGIN,
               U.CODVEND
          FROM TSIUSU U
         WHERE U.CODUSU <> ${session.userId}
           AND (
             TRANSLATE(
               UPPER(NVL(U.NOMEUSUCPLT, U.NOMEUSU)),
               'ÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇ',
               'AAAAAEEEEIIIIOOOOOUUUUC'
             ) LIKE '%${query}%'
             OR TRANSLATE(
               UPPER(U.NOMEUSU),
               'ÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇ',
               'AAAAAEEEEIIIIOOOOOUUUUC'
             ) LIKE '%${query}%'
             OR TO_CHAR(U.CODUSU) LIKE '%${query}%'
           )
         ORDER BY NVL(NULLIF(TRIM(U.NOMEUSUCPLT), ''), U.NOMEUSU)
      ) WHERE ROWNUM <= 50
    `);
    return Response.json({ rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível pesquisar os usuários.";
    return Response.json({ error: message }, { status: message === "AUTH_REQUIRED" ? 401 : 500 });
  }
}
