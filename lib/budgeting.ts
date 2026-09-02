export type BudgetCategory = { id: string; name: string; color: string; budget: number; archived: boolean; groupName?: string };
export type BudgetProfile = {
  version: 1; starts: Record<string, string>; budgets: Record<string, Record<string, number>>;
  aliases: Record<string, string>; payrollNames: string[]; initialApplied: boolean;
  legacyBudgets: Record<string, number>; legacyThrough: string;
};
export type BudgetPeriod = { key: string; start: string; end: string; confirmed: boolean; endConfirmed: boolean };
export const INITIAL_PLAN = [
  { name: "Colegio y universidades", budget: 6000, color: "#B879E0" },
  { name: "Deuda papás", budget: 2000, color: "#E77070" },
  { name: "Deuda amigo", budget: 1500, color: "#F09B62" },
  { name: "Alimentación", budget: 1000, color: "#54C7A0" },
  { name: "Gasolina", budget: 1000, color: "#55A7E8" },
  { name: "Servicios", budget: 700, color: "#CBA65B" },
  { name: "Pasajes + gastos de estudios hijos", budget: 600, color: "#6FCACD" },
  { name: "Otras obligaciones menores", budget: 230, color: "#9BA8BC" },
  { name: "Otros gastos personales considerados", budget: 500, color: "#DB82B1" },
] as const;
export const categoryKey = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
export function validPeriod(key: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key) || key < "1000-01" || key > "9998-12") throw new Error("Periodo inválido.");
  return key;
}
export function shiftPeriod(key: string, months: number) {
  validPeriod(key);
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 7);
}
// Estimate only: no holiday calendar is assumed. The confirmed pay date wins.
export function estimatedStart(key: string) {
  validPeriod(key);
  const [y, m] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, 0));
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 2) % 7);
  return date.toISOString().slice(0, 10);
}
export function periodWindow(key: string, starts: Record<string, string> = {}): BudgetPeriod {
  validPeriod(key);
  const next = shiftPeriod(key, 1);
  return { key, start: starts[key] || estimatedStart(key), end: starts[next] || estimatedStart(next), confirmed: !!starts[key], endConfirmed: !!starts[next] };
}
export function periodForDate(date: string, starts: Record<string, string> = {}) {
  const month = date.slice(0, 7);
  const keys = [-1, 0, 1, 2].map(n => shiftPeriod(month, n));
  return keys.find(key => { const p = periodWindow(key, starts); return date >= p.start && date < p.end; }) || month;
}
export function confirmPeriod(profile: BudgetProfile, key: string, start: string) {
  validPeriod(key);
  const parsed = new Date(start + "T12:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== start) throw new Error("Fecha inválida.");
  if (start < shiftPeriod(key, -1) + "-01" || start >= shiftPeriod(key, 1) + "-01") throw new Error("El sueldo debe iniciar el periodo en su mes o en el mes anterior.");
  const previous = periodWindow(shiftPeriod(key, -1), profile.starts).start;
  const end = periodWindow(key, profile.starts).end;
  if (start <= previous || start >= end) throw new Error("El inicio debe estar entre el inicio anterior y el siguiente. Confirma primero las fechas vecinas si cambiaron.");
  profile.starts[key] = start;
}
export function periodProgress(period: BudgetPeriod, today: string) {
  const days = Math.round((Date.parse(period.end) - Date.parse(period.start)) / 86400000);
  const elapsed = Math.min(days, Math.max(0, Math.floor((Date.parse(today) - Date.parse(period.start)) / 86400000) + 1));
  return { days, elapsed: Math.max(1, elapsed) };
}
export function emptyProfile(categories: BudgetCategory[], month: string): BudgetProfile {
  return { version: 1, starts: {}, budgets: {}, aliases: {}, payrollNames: ["sueldo", "salario"], initialApplied: false,
    legacyBudgets: Object.fromEntries(categories.filter(c => c.budget > 0 && !c.archived).map(c => [c.id, c.budget])), legacyThrough: month };
}
export function planFor(profile: BudgetProfile, key: string): Record<string, number> {
  return profile.budgets[key] ?? (key <= profile.legacyThrough ? profile.legacyBudgets : {});
}
export function isPlanned(profile: BudgetProfile, key: string, id: string | null | undefined) {
  return !!id && Object.hasOwn(planFor(profile, key), id);
}
export function originalScope(sourceId: string | null | undefined) {
  return sourceId?.match(/^v2:([a-f0-9]{32}):/)?.[1] || "";
}
export const aliasKey = (scope: string, name: string) => scope + ":" + categoryKey(name);
export type CategorizedMovement = { date: string; type: string; categoryId: string | null; sourceId?: string | null; sourceCategory?: string | null; categoryOverride?: boolean };
export function resolveCategory(row: CategorizedMovement, categories: BudgetCategory[], profile: BudgetProfile) {
  const periodKey = periodForDate(row.date, profile.starts);
  const original = row.sourceCategory || categories.find(c => c.id === row.categoryId)?.name || "";
  const usable = (id: string | null | undefined) => categories.some(c => c.id === id && !c.archived) && isPlanned(profile, periodKey, id);
  let categoryId = row.categoryId;
  if (row.type === "expense" && !row.categoryOverride && !usable(categoryId)) {
    const alias = profile.aliases[aliasKey(originalScope(row.sourceId), original)];
    const match = categories.find(c => !c.archived && categoryKey(c.name) === categoryKey(original) && usable(c.id));
    categoryId = (usable(alias) ? alias : match?.id) || categoryId;
  }
  return { categoryId, sourceCategory: original, periodKey, categoryPending: row.type === "expense" && !usable(categoryId) };
}
export function payrollCandidates<T extends { id: string; date: string; description: string; type: string }>(rows: T[], profile: BudgetProfile, key: string) {
  const names = profile.payrollNames.map(categoryKey).filter(Boolean);
  return rows.filter(r => r.type === "income" && r.date >= shiftPeriod(key, -1) + "-01" && r.date < shiftPeriod(key, 1) + "-01" &&
    names.some(name => (" " + categoryKey(r.description) + " ").includes(" " + name + " ")));
}
