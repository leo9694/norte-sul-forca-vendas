export type PromotionRow = Record<string, string | number | null>;
export type Promotions = { rules: PromotionRow[]; bands: PromotionRow[]; partners: PromotionRow[]; products: PromotionRow[]; negotiations: PromotionRow[]; parameters: PromotionRow[]; sellerGroup: string; seller: number };
export type PromotionContext = { partner: number; company: number; table: number; negotiation: number; operation?: number; date?: string };
type Item = { CODPROD: number; CODLOCAL: number; CONTROLE: string; CODVOL: string; VLRVENDA: number; quantity: number; adjustmentPercent?: number; promotionId?: number; promotionalPrice?: number; promotionError?: string };
const value = (v: unknown) => String(v ?? '').trim();
const groupKey = (v: unknown) => value(v).toUpperCase();
const sameGroup = (left: unknown, right: unknown) => groupKey(left) === groupKey(right);
const anyGroup = (v: unknown) => !value(v) || /^\*+$/.test(value(v));
const dateKey = (v: unknown) => {
  const s = value(v), m = s.match(/^(\d{2})(\d{2})(\d{4})/) ?? s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s.slice(0, 10);
};
export const promotionDate = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Cuiaba' }).format(new Date());

// Sempre parte do preço de tabela, nunca do resultado da aplicação anterior.
export function applyPromotions<T extends Item>(items: T[], data: Promotions, context: PromotionContext): T[] {
  const today = context.date ?? promotionDate();
  const partnerGroup = data.partners.find(p => Number(p.CODPARC) === context.partner)?.GRUPODESCPARC;
  const mode = value(data.negotiations.find(n => Number(n.CODTIPVENDA) === context.negotiation)?.DESCPROM) || 'N';
  const biggest = data.parameters.some(p => p.CHAVE === 'USAMAIDESCPROMO' && p.LOGICO === 'S');
  let changed = false;
  const next = items.map(item => {
    const group = data.products.find(p => Number(p.CODPROD) === item.CODPROD)?.GRUPODESCPROD;
    const rules = mode === 'N' ? [] : data.rules.filter(r => dateKey(r.DTINICIAL) <= today && dateKey(r.DTFINAL) >= today
      && (!Number(r.CODPARC) || Number(r.CODPARC) === context.partner)
      && (anyGroup(r.GRUPODESCPARC) || sameGroup(r.GRUPODESCPARC, partnerGroup))
      && (!Number(r.CODPROD) || Number(r.CODPROD) === item.CODPROD)
      && (anyGroup(r.GRUPODESCPROD) || sameGroup(r.GRUPODESCPROD, group))
      && (!Number(r.CODEMP) || Number(r.CODEMP) === context.company)
      && (!Number(r.CODTAB) || Number(r.CODTAB) === context.table)
      && (!Number(r.CODVEND) || Number(r.CODVEND) === data.seller)
      && (anyGroup(r.GRUPODESCVEND) || sameGroup(r.GRUPODESCVEND, data.sellerGroup))
      && (!Number(r.CODLOCAL) || Number(r.CODLOCAL) === item.CODLOCAL)
      && (!value(r.CODVOL) || value(r.CODVOL) === item.CODVOL)
      && (r.USADESCCTRL !== 'S' || !value(r.CONTROLE) || value(r.CONTROLE) === ([5, 6].includes(Number(context.operation)) ? '' : value(item.CONTROLE))));
    const candidates = rules.map(rule => {
      let percent = Number(rule.PERCENTUAL || 0), fixed = Number(rule.VLRVENDA || 0), error = '';
      if (Number(rule.VLRDESC)) error = 'Esta promoção em valor de desconto precisa ser revisada no Sankhya antes do envio.';
      if (!['S', 'D'].includes(mode)) error = 'Esta modalidade de negociação promocional precisa ser revisada no Sankhya antes do envio.';
      if (rule.USADESCESP === 'S') error = 'Esta promoção especial precisa ser lançada no Sankhya.';
      if (['S', 'P', 'G'].includes(value(rule.USADESCQTD)) && ['D', 'Q'].includes(mode)) {
        const quantity = rule.USADESCQTD === 'G' ? items.filter(i => sameGroup(data.products.find(p => Number(p.CODPROD) === i.CODPROD)?.GRUPODESCPROD, group)).reduce((sum, i) => sum + i.quantity, 0) : items.filter(i => i.CODPROD === item.CODPROD).reduce((sum, i) => sum + i.quantity, 0);
        const bands = data.bands.filter(b => Number(b.NUPROMOCAO) === Number(rule.NUPROMOCAO)).sort((a, b) => Number(a.QTDE) - Number(b.QTDE));
        if (!bands.length) error = 'Promoção por quantidade sem faixas válidas. Revise o cadastro no Sankhya.';
        const excess = data.parameters.find(p => p.CHAVE === 'REGRAEXCDESCQTD');
        const band = bands.find(b => quantity <= Number(b.QTDE)) ?? (Number(excess?.INTEIRO || 0) === 0 ? bands.at(-1) : undefined);
        percent = band?.TIPDESC === 'P' ? Number(band.PERCDESC) : 0;
        fixed = band?.TIPDESC === 'V' ? Number(band.PERCDESC) : 0;
      }
      const price = fixed > 0 ? fixed : Number(item.VLRVENDA) * (1 - percent / 100);
      if (!Number.isFinite(price) || price <= 0) error = 'Preço promocional inválido. Revise a promoção no Sankhya.';
      return { rule, price, error };
    });
    candidates.sort((a, b) => {
      if (biggest && a.price !== b.price) return a.price - b.price;
      for (const field of ['CODPARC', 'GRUPODESCPARC', 'CODPROD', 'GRUPODESCPROD', 'CODEMP', 'CODLOCAL']) {
        const rank = (r: PromotionRow) => field.startsWith('GRUPO') ? Number(!anyGroup(r[field])) : Number(Number(r[field]) > 0);
        const diff = rank(b.rule) - rank(a.rule); if (diff) return diff;
      }
      return dateKey(b.rule.DTINICIAL).localeCompare(dateKey(a.rule.DTINICIAL)) || Number(b.rule.NUPROMOCAO) - Number(a.rule.NUPROMOCAO);
    });
    const selected = candidates[0];
    const promotionId = Number(selected?.rule.NUPROMOCAO || 0);
    const promotionalPrice = selected?.price ?? Number(item.VLRVENDA);
    const promotionError = selected?.error || '';
    if (item.promotionId === promotionId && item.promotionalPrice === promotionalPrice && item.promotionError === promotionError) return item;
    changed = true;
    return { ...item, promotionId, promotionalPrice, promotionError };
  });
  return changed ? next : items;
}

export const promotionUnitPrice = (item: { VLRVENDA: number; promotionalPrice?: number }) => Number(item.promotionalPrice ?? item.VLRVENDA);

type UnitPriceItem = Pick<Item, 'VLRVENDA' | 'promotionalPrice' | 'adjustmentPercent'>;
export const itemAdjustment = (item: Pick<Item, 'adjustmentPercent'>) => {
  const value = Number(item.adjustmentPercent || 0);
  return Number.isFinite(value) ? value : 0;
};
export const adjustedUnitPrice = (item: UnitPriceItem) => promotionUnitPrice(item) * (1 + itemAdjustment(item) / 100);

export function displayedAdjustment(item: UnitPriceItem) {
  const table = Number(item.VLRVENDA), final = adjustedUnitPrice(item);
  const percent = table > 0 && Number.isFinite(final) ? (final / table - 1) * 100 : 0;
  return (Math.abs(percent) < 0.005 ? 0 : percent).toLocaleString('pt-BR', { maximumFractionDigits: 2, useGrouping: false });
}

// O campo mostra a diferença total contra a tabela. Só o ajuste adicional é
// armazenado, para não aplicar a promoção outra vez ao desfocar/editar o campo.
export function manualAdjustmentFromDisplay(item: UnitPriceItem, input: string): number | undefined {
  const text = input.trim().replace(',', '.');
  const percent = Number(text), promo = promotionUnitPrice(item), table = Number(item.VLRVENDA);
  if (!text || !Number.isFinite(percent) || percent <= -100 || !Number.isFinite(promo) || promo <= 0 || !Number.isFinite(table) || table <= 0) return;
  if (percent === Number(displayedAdjustment(item).replace(',', '.'))) return;
  const manual = ((1 + percent / 100) * table / promo - 1) * 100;
  return Math.max(-99.99, Math.min(999.99, Math.abs(manual) < 1e-8 ? 0 : manual));
}
