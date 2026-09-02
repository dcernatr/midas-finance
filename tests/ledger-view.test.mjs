import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { DEFAULT_LEDGER_FILTERS, filterLedger, ledgerPeriods } from "../lib/ledger-view.ts";

const categories = [{ id: "food", name: "Alimentación" }];
const rows = [
  { id: "august", date: "2026-08-28", type: "expense", description: "Almuerzo", categoryId: "food", code: "26-08-G-001", sourceName: "Google Spreadsheet · Set 26", sourceType: "spreadsheet" },
  { id: "september", date: "2026-09-02", type: "income", description: "Sueldo", categoryId: null, code: "26-09-I-001", sourceName: null, sourceType: "manual" },
  { id: "october", date: "2026-10-02", type: "expense", description: "Reserva", categoryId: "food", code: "26-10-G-001", sourceName: "Google Spreadsheet · Oct 26", sourceType: "spreadsheet" },
];

test("ledger defaults show all months and both sources, independently from the monthly dashboard", () => {
  assert.deepEqual(filterLedger(rows, categories), rows);
  assert.deepEqual(rows.filter(row => row.date.startsWith("2026-09")).map(row => row.id), ["september"]);
  assert.deepEqual(ledgerPeriods(rows, "2026-09"), ["2026-10", "2026-09", "2026-08"]);
});

test("only explicit month, type and search filters hide stored movements", () => {
  assert.deepEqual(filterLedger(rows, categories, { ...DEFAULT_LEDGER_FILTERS, period: "2026-08" }).map(row => row.id), ["august"]);
  assert.deepEqual(filterLedger(rows, categories, { ...DEFAULT_LEDGER_FILTERS, type: "income" }).map(row => row.id), ["september"]);
  for (const search of ["  ALMUERZO  ", "26-08-G-001", "Set 26"]) {
    assert.deepEqual(filterLedger(rows, categories, { ...DEFAULT_LEDGER_FILTERS, search }).map(row => row.id), ["august"]);
  }
  assert.equal(filterLedger(rows, categories, { ...DEFAULT_LEDGER_FILTERS, search: "Alimentación" }).length, 2);
  assert.equal(filterLedger(rows, categories, { ...DEFAULT_LEDGER_FILTERS, period: "2025-01" }).length, 0);
  assert.equal(filterLedger(rows, categories, DEFAULT_LEDGER_FILTERS).length, 3);
});

test("successful sync opens the full ledger and a failed refresh can be retried without reimporting", async () => {
  const ui = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(ui, /filterLedger\(data.transactions/);
  assert.doesNotMatch(ui, /const filtered = metrics.monthTx/);
  assert.match(ui, /aria-label="Mes de los movimientos"/);
  assert.match(ui, /const refreshed = await load\(\);\s*setSyncRefreshPending\(!refreshed\);\s*showAllMovements\(\)/);
  assert.match(ui, /cache: "no-store"/);
  assert.match(ui, /onClick=\{viewSyncedMovements\}/);
  const show = ui.slice(ui.indexOf("function showAllMovements"), ui.indexOf("async function viewSyncedMovements"));
  for (const field of ["search", "type", "period"]) assert.ok(show.includes("DEFAULT_LEDGER_FILTERS." + field));
  const view = ui.slice(ui.indexOf("async function viewSyncedMovements"), ui.indexOf("  return (\n    <TooltipProvider>"));
  assert.match(view, /await load\(\)/);
  assert.doesNotMatch(view, /spreadsheetRequest|action: "sync"/);
});
