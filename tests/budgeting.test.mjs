import test from "node:test";
import assert from "node:assert/strict";
import { emptyProfile, INITIAL_PLAN, estimatedStart, confirmPeriod, periodWindow, periodForDate, periodProgress, planFor, categoryKey, resolveCategory, aliasKey, payrollCandidates } from "../lib/budgeting.ts";
import { filterLedger } from "../lib/ledger-view.ts";
const cats = [{ id: "food", name: "Alimentación", color: "#54C7A0", budget: 0, archived: false }, { id: "raw", name: "Comidas", budget: 0, color: "#000000", archived: false }];

test("confirmed September salary starts August 28 and intervals have exclusive ends", () => {
  const profile = emptyProfile(cats, "2026-09");
  assert.equal(estimatedStart("2026-09"), "2026-08-28");
  confirmPeriod(profile, "2026-09", "2026-08-28");
  confirmPeriod(profile, "2026-10", "2026-09-24");
  const p = periodWindow("2026-09", profile.starts);
  assert.equal(p.start, "2026-08-28"); assert.equal(p.end, "2026-09-24");
  assert.equal(p.confirmed, true); assert.equal(p.endConfirmed, true);
  assert.equal(periodForDate("2026-08-27", profile.starts), "2026-08");
  assert.equal(periodForDate("2026-08-28", profile.starts), "2026-09");
  assert.equal(periodForDate("2026-09-23", profile.starts), "2026-09");
  assert.equal(periodForDate("2026-09-24", profile.starts), "2026-10");
  assert.equal(periodProgress(p, "2026-09-02").elapsed, 6);
  assert.equal(periodProgress(p, "2026-09-02").days, 27);
});

test("estimates are explicit, year changes work, invalid or overlapping starts fail", () => {
  const profile = emptyProfile(cats, "2026-09");
  assert.equal(periodWindow("2026-09").confirmed, false);
  assert.equal(estimatedStart("2027-01"), "2026-12-25"); // No invented holiday adjustment.
  assert.equal(periodForDate("2026-12-31"), "2027-01");
  for (const date of ["2026-02-31", "2026-07-31", "2026-10-01", "not-a-date"]) assert.throws(() => confirmPeriod(profile, "2026-09", date));
  assert.equal(Object.keys(profile.starts).length, 0);
});

test("initial template sums 13530 and budgets are independently keyed by period", () => {
  assert.equal(INITIAL_PLAN.length, 9);
  assert.equal(INITIAL_PLAN.reduce((sum, c) => sum + c.budget, 0), 13530);
  const profile = emptyProfile([{ ...cats[0], budget: 300 }], "2026-09");
  profile.budgets["2026-09"] = { food: 1000 };
  assert.equal(planFor(profile, "2026-08").food, 300);
  assert.equal(planFor(profile, "2026-09").food, 1000);
  assert.equal(planFor(profile, "2026-10").food, undefined);
});

test("unknown categories stay pending; normalization and scoped aliases only resolve planned categories", () => {
  const profile = emptyProfile(cats, "2026-09");
  const scope = "a".repeat(32), other = "b".repeat(32);
  const row = { date: "2026-08-28", type: "expense", categoryId: "raw", sourceCategory: "Comidas", sourceId: `v2:${scope}:abc:1` };
  assert.equal(resolveCategory(row, cats, profile).categoryPending, true);
  profile.budgets["2026-09"] = { food: 0 };
  assert.equal(categoryKey("  ALIMENTACIÓN  "), "alimentacion");
  assert.equal(resolveCategory({ ...row, sourceCategory: "ALIMENTACION" }, cats, profile).categoryId, "food");
  profile.aliases[aliasKey(scope, "Comidas")] = "food";
  assert.equal(resolveCategory(row, cats, profile).categoryPending, false);
  assert.equal(resolveCategory({ ...row, sourceId: `v2:${other}:abc:1` }, cats, profile).categoryPending, true);
  assert.equal(resolveCategory({ ...row, date: "2026-10-05" }, cats, profile).categoryPending, true);
  assert.equal(resolveCategory({ ...row, categoryOverride: true }, cats, profile).categoryId, "raw");
  assert.equal(row.categoryId, "raw");
  assert.equal(resolveCategory({ ...row, type: "income" }, cats, profile).categoryPending, false);
});

test("salary suggestions do not mutate periods or treat every income as salary", () => {
  const profile = emptyProfile(cats, "2026-09");
  const rows = [{ id: "salary", date: "2026-08-28", description: "Pago de sueldo", type: "income" },
    { id: "gift", date: "2026-08-28", description: "Regalo", type: "income" },
    { id: "expense", date: "2026-08-28", description: "Sueldo", type: "expense" }];
  assert.deepEqual(payrollCandidates(rows, profile, "2026-09").map(r => r.id), ["salary"]);
  assert.deepEqual(profile.starts, {});
});

test("ledger period filtering uses budget assignment, not calendar month", () => {
  const row = { date: "2026-08-28", periodKey: "2026-09", type: "expense", categoryId: "food", description: "Compra", code: "26-08-G-001", sourceName: "Set 26" };
  assert.equal(filterLedger([row], cats, { period: "2026-09", search: "", type: "all" }).length, 1);
  assert.equal(filterLedger([row], cats, { period: "2026-08", search: "", type: "all" }).length, 0);
  assert.equal(row.code, "26-08-G-001");
});
