import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.endsWith(".ts") && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const { financeMetrics, movementTotals, sumMoney } = await import("../lib/finance-metrics.ts");
const { emptyProfile, periodWindow, initialPlanReview } = await import("../lib/budgeting.ts");
const { filterLedger } = await import("../lib/ledger-view.ts");
const { StateOrder } = await import("../lib/state-order.ts");
const period = periodWindow("2026-09", { "2026-09": "2026-08-28", "2026-10": "2026-09-24" });
const categories = [{ id: "food", name: "Comidas", budget: 1000, color: "#54C7A0", archived: false, planned: true, kind: "variable", groupName: "Hogar" }];
const row = (id, date, type, amount, categoryId = "food") => ({ id, date, type, amount, categoryId, description: id, code: null, sourceName: null, periodKey: date < "2026-08-28" ? "2026-08" : date < "2026-09-24" ? "2026-09" : "2026-10" });
const transactions = [row("before", "2026-08-27", "expense", 99), row("salary", "2026-08-28", "income", 1000), row("manual", "2026-09-01", "expense", 0.1), row("sheet", "2026-09-01", "expense", 0.2), row("pending", "2026-09-02", "expense", 25, null), row("debt", "2026-09-03", "debt_payment", 100, null), row("next", "2026-09-24", "expense", 88)];
const state = { period, categories, transactions, month: { income: 5000, savingsTarget: 100 }, debts: [{ status: "active", currentBalance: 500, plannedPayment: 100 }] };

test("dashboard, category budget and filtered ledger reconcile to cents in the same salary period", () => {
  const m = financeMetrics(state, "2026-09-23");
  const ledger = movementTotals(filterLedger(transactions, categories, { period: "2026-09", type: "all", search: "" }));
  assert.equal(m.actualIncome, 1000); // Expected salary is not received income.
  assert.equal(m.budget, 1000);
  assert.equal(m.spent, 25.3);
  assert.equal(m.debtPaid, 100);
  assert.equal(m.outflow, ledger.outflow);
  assert.equal(m.available, ledger.balance);
  assert.equal(m.available, 874.7);
  assert.equal(sumMoney([...m.categoryRows.map(c => c.actual), m.pendingAmount]), m.spent);
  assert.equal(m.categoryRows[0].actual, 0.3);
  assert.equal(m.forecast, 125.3); // Debt already paid is retained, once.
});

test("metrics immediately follow changed budget, classification, addition and deletion snapshots", () => {
  const before = financeMetrics(state, "2026-09-02");
  const changed = { ...state, categories: [{ ...categories[0], budget: 1500 }], transactions: transactions.map(t => t.id === "pending" ? { ...t, categoryId: "food" } : t) };
  const after = financeMetrics(changed, "2026-09-02");
  assert.equal(after.budget, 1500);
  assert.equal(before.pendingAmount, 25);
  assert.equal(after.pendingAmount, 0);
  assert.equal(after.categoryRows[0].actual, before.spent);
  const added = { ...changed, transactions: [...changed.transactions, row("new", "2026-09-02", "expense", 10)] };
  assert.equal(financeMetrics(added, "2026-09-02").outflow, 135.3);
  const deleted = { ...added, transactions: added.transactions.filter(t => t.id !== "new") };
  assert.equal(financeMetrics(deleted, "2026-09-02").outflow, after.outflow);
});

test("empty and historical periods do not invent transactions or future debt outflows", () => {
  const empty = financeMetrics({ ...state, categories: [], transactions: [], debts: [] }, "2026-09-02");
  assert.equal(empty.score, null); assert.equal(empty.outflow, 0); assert.equal(empty.budget, 0);
  const historical = financeMetrics({ ...state, debts: [{ status: "active", currentBalance: 500, plannedPayment: 500 }] }, "2026-10-02");
  assert.equal(historical.forecast, historical.outflow);
});

test("initial plan review distinguishes missing categories, budget conflicts, extras and confirmed dates", () => {
  const cats = [{ ...categories[0], name: "Alimentación" }, { ...categories[0], id: "extra", name: "Reserva", budget: 50 }];
  const profile = emptyProfile(cats, "2026-09");
  let review = initialPlanReview(cats, profile);
  assert.equal(review.missing.length, 8); assert.equal(review.conflicts.length, 0); assert.equal(review.extras.length, 1);
  profile.budgets["2026-09"] = { food: 2000 };
  profile.starts["2026-09"] = "2026-08-29";
  review = initialPlanReview(cats, profile);
  assert.equal(review.conflicts[0].name, "Alimentación"); assert.equal(review.dateConflict, true);
});

test("old reads cannot overwrite a write; new reads wait until all queued writes finish", async () => {
  const order = new StateOrder(), token = order.beginRead();
  assert.equal(order.accepts(token), true);
  let release;
  const first = order.enqueue(() => new Promise(resolve => { release = resolve; }));
  await Promise.resolve();
  assert.equal(order.accepts(token), false); assert.equal(order.beginRead(), null);
  release("saved"); await first;
  const current = order.beginRead(); assert.equal(order.accepts(current), true);
  order.invalidate(); assert.equal(order.accepts(current), false);
});

test("rapid writes execute in order and a failed write does not prevent the next save", async () => {
  const order = new StateOrder(), events = [];
  const a = order.enqueue(async () => { events.push("first"); throw new Error("failed"); });
  const b = order.enqueue(async () => { events.push("second"); return "latest"; });
  await assert.rejects(a, /failed/);
  assert.equal(await b, "latest"); assert.deepEqual(events, ["first", "second"]); assert.equal(order.pending, false);
});
