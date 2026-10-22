// Não escolhe arbitrariamente uma IE quando o fornecedor retorna mais de uma ativa na UF.
export function companyStateRegistration(data: unknown, document: string, uf: string): string {
  if (!data || typeof data !== 'object') return '';
  const company = data as { estabelecimento?: { cnpj?: unknown; inscricoes_estaduais?: unknown } };
  const establishment = company.estabelecimento;
  if (String(establishment?.cnpj || '').replace(/[^A-Z0-9]/gi, '').toUpperCase() !== document || !Array.isArray(establishment?.inscricoes_estaduais)) return '';
  const registrations = new Set<string>();
  for (const item of establishment.inscricoes_estaduais) {
    if (item?.ativo !== true || item.estado?.sigla !== uf || typeof item.inscricao_estadual !== 'string') continue;
    const number = item.inscricao_estadual.replace(/[.\s/-]/g, '');
    if (/^\d{2,17}$/.test(number)) registrations.add(number);
  }
  return registrations.size === 1 ? [...registrations][0] : '';
}
