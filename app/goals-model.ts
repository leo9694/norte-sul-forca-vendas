export type MonthlyGoal = { month: string; seller_id: number; target_cents: number; notes: string; version: number; updated_at: number };
export type GoalRow = { sellerId: number; sellerName: string; active: boolean; goal: MonthlyGoal | null; actual: number };
export type GoalsData = { month: string; canManage: boolean; rows: GoalRow[]; sellers: Array<{ CODVEND: number; APELIDO: string; ATIVO: string }> };
export function validGoalMonth(value: unknown): value is string {
  return typeof value==='string' && /^(20\d{2})-(0[1-9]|1[0-2])$/.test(value);
}
export function goalProgress(actual: number, targetCents: number) {
  const target=targetCents/100;
  return { percent:target>0?Math.max(0,actual/target*100):0, remaining:Math.max(0,target-actual) };
}
export function activeSellers<T extends { CODVEND: unknown; ATIVO?: unknown }>(rows: T[]): T[] {
  return rows.filter(row => Number(row.CODVEND)>0 && String(row.ATIVO ?? '').trim().toUpperCase()==='S');
}
export const currentGoalMonth = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Cuiaba',year:'numeric',month:'2-digit'}).format(new Date());
export function parseGoalAmount(input: string): number | null {
  const text=input.trim();let normalized:string;
  if (/^(\d+|\d{1,3}(\.\d{3})+),\d{1,2}$/.test(text)) normalized=text.replace(/\./g,'').replace(',','.');
  else if (/^\d+\.\d{1,2}$/.test(text)) normalized=text;
  else if (/^\d+$/.test(text)||/^\d{1,3}(\.\d{3})+$/.test(text)) normalized=text.replace(/\./g,'');
  else return null;
  const cents=Math.round(Number(normalized)*100);
  return Number.isSafeInteger(cents)&&cents>0&&cents<=1_000_000_000_000?cents:null;
}
