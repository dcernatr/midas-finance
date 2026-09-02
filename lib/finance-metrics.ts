import { periodProgress, type BudgetPeriod } from "./budgeting";

export type MetricCategory = { id: string; name: string; groupName: string; budget: number; color: string; kind: string; archived: boolean; planned: boolean };
export type MetricMovement = { date: string; type: string; amount: number; categoryId: string | null; categoryPending?: boolean };
export type MetricDebt = { status: string; currentBalance: number; plannedPayment: number };
const cents = (value: number) => Math.round(value * 100);
export const sumMoney = (values: number[]) => values.reduce((sum, value) => sum + cents(value), 0) / 100;
export function movementTotals(rows: MetricMovement[]) {
  const income = sumMoney(rows.filter(t => t.type === "income").map(t => t.amount));
  const expenses = sumMoney(rows.filter(t => t.type === "expense").map(t => t.amount));
  const debtPaid = sumMoney(rows.filter(t => t.type === "debt_payment").map(t => t.amount));
  const outflow = sumMoney([expenses, debtPaid]);
  return { income, expenses, debtPaid, outflow, balance: sumMoney([income, -outflow]) };
}
export function expenseStatus(percent: number) {
  if (!Number.isFinite(percent)) return { label: "Sin presupuesto", tone: "neutral" };
  if (percent > 100) return { label: "Desviación", tone: "danger" };
  if (percent >= 80) return { label: "Atención", tone: "warning" };
  return { label: "Óptimo", tone: "success" };
}
// Dashboard, plan and ledger share the same date interval and currency arithmetic.
export function financeMetrics<T extends MetricMovement>(data: {
  categories: MetricCategory[]; transactions: T[]; debts: MetricDebt[];
  period: BudgetPeriod; month: { savingsTarget: number };
}, today: string) {
  const categories = data.categories.filter(c => !c.archived && c.planned);
  const monthTx = data.transactions.filter(t => t.date >= data.period.start && t.date < data.period.end);
  const expenseTx = monthTx.filter(t => t.type === "expense");
  const totals = movementTotals(monthTx);
  const { expenses: spent, income: actualIncome, debtPaid, outflow, balance: available } = totals;
  const budget = sumMoney(categories.map(c => c.budget));
  const activeDebts = data.debts.filter(d => d.status === "active");
  const totalDebt = sumMoney(activeDebts.map(d => d.currentBalance));
  const categoryRows = categories.map(c => {
    const actual = sumMoney(expenseTx.filter(t => t.categoryId === c.id).map(t => t.amount));
    const percent = c.budget > 0 ? actual / c.budget * 100 : actual > 0 ? Infinity : 0;
    return { ...c, actual, available: sumMoney([c.budget, -actual]), percent, status: expenseStatus(percent) };
  });
  const ids = new Set(categories.map(c => c.id));
  const pendingMovements = expenseTx.filter(t => !t.categoryId || !ids.has(t.categoryId));
  const pendingAmount = sumMoney(pendingMovements.map(t => t.amount));
  const { elapsed, days } = periodProgress(data.period, today);
  const debtPlan = sumMoney(activeDebts.map(d => d.plannedPayment));
  const pendingDebt = today >= data.period.end ? 0 : Math.max(0, debtPlan - debtPaid);
  const forecast = sumMoney([spent / elapsed * days, debtPaid, pendingDebt]);
  const projectedSavings = Math.max(0, sumMoney([actualIncome, -forecast]));
  const setupComplete = actualIncome > 0 && budget > 0;
  const overrun = sumMoney([pendingAmount, ...categoryRows.map(c => Math.max(0, -c.available))]);
  const budgetFactor = budget > 0 ? 40 * Math.max(0, 1 - overrun / budget) : 0;
  const savingsFactor = data.month.savingsTarget > 0 ? 25 * Math.min(1, projectedSavings / data.month.savingsTarget) : 0;
  const discretionary = categoryRows.filter(c => c.kind === "discretionary");
  const discretionBudget = sumMoney(discretionary.map(c => c.budget));
  const discretionSpent = sumMoney(discretionary.map(c => c.actual));
  const discretionFactor = discretionBudget > 0 ? 15 * Math.max(0, 1 - Math.max(0, discretionSpent - discretionBudget) / discretionBudget) : 15;
  const debtFactor = debtPlan > 0 ? 20 * Math.min(1, debtPaid / debtPlan) : 20;
  return { monthTx, spent, actualIncome, debtPaid, outflow, available, budget, totalDebt, forecast, projectedSavings,
    setupComplete, categoryRows, pendingMovements, pendingAmount,
    score: setupComplete ? Math.round(Math.min(100, budgetFactor + savingsFactor + discretionFactor + debtFactor)) : null,
    factors: { budget: budgetFactor, savings: savingsFactor, discretion: discretionFactor, debt: debtFactor },
  };
}
