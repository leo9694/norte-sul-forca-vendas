// O cookie é compartilhado entre abas. Uma aba antiga não pode gravar o
// rascunho na conta que foi aberta depois em outra aba.
export function draftSessionConflict(request: Request, session: { userId: number; sellerId: number }) {
  const user = request.headers.get("X-FV-User-Id");
  const seller = request.headers.get("X-FV-Seller-Id");
  if ((user !== null && Number(user) !== session.userId) || (seller !== null && Number(seller) !== session.sellerId)) {
    return Response.json({ error: "A sessão mudou. Entre novamente para sincronizar seus rascunhos." }, { status: 409 });
  }
  return null;
}
