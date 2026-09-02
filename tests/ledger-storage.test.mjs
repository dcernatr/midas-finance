import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { ensureLedgerSchema } from "../scripts/ledger-schema.mjs";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.endsWith("/lib/auth")) return { url: "midas-test:auth", shortCircuit: true };
  if (specifier === "next/headers") return next("next/headers.js", context);
  if (context.parentURL?.endsWith(".ts") && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
}, load(url, context, next) {
  if (url === "midas-test:auth") return { format: "module", shortCircuit: true, source: `
    let context;
    export const setContext = value => { context = value; };
    export const ensureContext = async () => context;
    export const newLogId = () => crypto.randomUUID();
    export const authErrorResponse = error => Response.json({ error: error.message }, { status: 500 });
  ` };
  return next(url, context);
} });
const { withMovementCode, ensureMovementCodes } = await import("../lib/ledger-store.ts");
const { APPWRITE_TABLES: T } = await import("../lib/appwrite/server.ts");
const conflict = () => Object.assign(new Error("Conflict"), { code: 409 });

// Optimistic transactions: the increment and row changes become visible only on
// commit. Concurrent stale snapshots fail and must be retried by production code.
class MemoryTables {
  rows = new Map();
  transactions = new Map();
  revision = 0;
  serial = 0;
  key(table, row) { return table + ":" + row; }
  store(transactionId) { return transactionId ? this.transactions.get(transactionId).rows : this.rows; }
  async createRow({ tableId, rowId, data, transactionId }) {
    const store = this.store(transactionId), key = this.key(tableId, rowId);
    if (store.has(key)) throw conflict();
    const row = { $id: rowId, $createdAt: "2026-09-02T00:00:00Z", ...data };
    store.set(key, row);
    if (!transactionId) this.revision++;
    return structuredClone(row);
  }
  async getRow({ tableId, rowId, transactionId }) {
    const row = this.store(transactionId).get(this.key(tableId, rowId));
    if (!row) throw Object.assign(new Error("Not found"), { code: 404 });
    return structuredClone(row);
  }
  async listRows({ tableId, queries = [] }) {
    let rows = [...this.rows.entries()].filter(([key]) => key.startsWith(tableId + ":")).map(([, row]) => row);
    let limit = 500;
    for (const query of queries.map(item => JSON.parse(item))) {
      if (query.method === "equal") rows = rows.filter(row => query.values.includes(row[query.attribute]));
      if (query.method === "limit") limit = query.values[0];
      if (query.method === "cursorAfter") rows = rows.slice(rows.findIndex(row => row.$id === query.values[0]) + 1);
    }
    return { rows: structuredClone(rows.slice(0, limit)) };
  }
  async updateRow({ tableId, rowId, data, transactionId }) {
    const store = this.store(transactionId), key = this.key(tableId, rowId);
    const current = await this.getRow({ tableId, rowId, transactionId });
    store.set(key, { ...current, ...data });
    if (!transactionId) this.revision++;
    return structuredClone(store.get(key));
  }
  async createTransaction() {
    const $id = "tx" + ++this.serial;
    this.transactions.set($id, { rows: structuredClone(this.rows), revision: this.revision });
    return { $id };
  }
  async incrementRowColumn({ column, value, ...args }) {
    const row = await this.getRow(args);
    return this.updateRow({ ...args, data: { [column]: row[column] + value } });
  }
  async updateTransaction({ transactionId, commit }) {
    const tx = this.transactions.get(transactionId);
    if (commit) {
      if (tx.revision !== this.revision) throw conflict();
      this.rows = tx.rows;
      this.revision++;
    }
    this.transactions.delete(transactionId);
  }
}

function add(tables, id, source, date = "2026-09-02", type = "expense", user = "u1") {
  return withMovementCode(tables, user, date, type, (code, transactionId) => tables.createRow({
    tableId: T.transactions, rowId: id, transactionId,
    data: { user_id: user, date, type, midas_code: code, source_type: source },
  }));
}

test("manual and spreadsheet saves share durable numbering; period, type and user reset separately", async () => {
  const tables = new MemoryTables();
  assert.equal((await add(tables, "manual", "manual")).midas_code, "26-09-G-001");
  assert.equal((await add(tables, "import", "spreadsheet")).midas_code, "26-09-G-002");
  assert.equal((await add(tables, "income", "spreadsheet", "2026-09-02", "income")).midas_code, "26-09-I-001");
  assert.equal((await add(tables, "oct", "manual", "2026-10-02")).midas_code, "26-10-G-001");
  assert.equal((await add(tables, "u2", "manual", "2026-09-02", "expense", "u2")).midas_code, "26-09-G-001");
  tables.rows.delete(tables.key(T.transactions, "import"));
  assert.equal((await add(tables, "after-delete", "manual")).midas_code, "26-09-G-003");
});

test("concurrent manual/import saves retry conflicts and commit distinct codes", async () => {
  const tables = new MemoryTables();
  const rows = await Promise.all(Array.from({ length: 6 }, (_, i) => add(tables, "row" + i, i % 2 ? "manual" : "spreadsheet")));
  assert.deepEqual(rows.map(row => row.midas_code).sort(), [1, 2, 3, 4, 5, 6].map(n => "26-09-G-00" + n));
  assert.equal(tables.transactions.size, 0);
});

test("a failed financial write rolls back its sequence increment", async () => {
  const tables = new MemoryTables();
  await assert.rejects(withMovementCode(tables, "u1", "2026-09-02", "expense", async () => { throw new Error("Rejected row"); }), /Rejected row/);
  assert.equal((await add(tables, "valid", "manual")).midas_code, "26-09-G-001");
  assert.equal(tables.transactions.size, 0);
});

test("legacy movements get stable codes without losing either source or modifying another user", async () => {
  const tables = new MemoryTables();
  const rows = await Promise.all(["manual", "spreadsheet"].map((source, i) => tables.createRow({
    tableId: T.transactions, rowId: "legacy" + i, data: { user_id: "u1", date: "2026-08-28", type: "expense", source_type: source, amount: 4 },
  })));
  await ensureMovementCodes(tables, "u1", rows);
  assert.deepEqual(rows.map(row => row.midas_code), ["26-08-G-001", "26-08-G-002"]);
  await ensureMovementCodes(tables, "u1", rows);
  assert.equal((await add(tables, "next", "manual", "2026-08-28")).midas_code, "26-08-G-003");
  assert.equal((await tables.getRow({ tableId: T.transactions, rowId: "legacy1" })).amount, 4);
  const other = await tables.createRow({ tableId: T.transactions, rowId: "other", data: { user_id: "other", date: "2026-08-28", type: "expense" } });
  await assert.rejects(ensureMovementCodes(tables, "u1", [other]), /no existe/);
  assert.equal(other.midas_code, undefined);
});

test("schema migration is additive, idempotent and does not hide permission failures", async () => {
  let column, sequence;
  const tables = {
    async getColumn() { if (!column) throw { code: 404 }; return column; },
    async createVarcharColumn(args) { column = { ...args, status: "available" }; },
    async getTable() { if (!sequence) throw { code: 404 }; return sequence; },
    async createTable(args) { sequence = { ...args, columns: args.columns.map(column => ({ ...column, status: "available" })) }; },
  };
  await ensureLedgerSchema(tables, "midas");
  assert.equal(column.required, false);
  assert.equal(sequence.columns.length, 4);
  assert.deepEqual(sequence.permissions, []);
  assert.equal(sequence.tableId, T.sequences);
  tables.createTable = () => { throw new Error("Must not recreate"); };
  tables.createVarcharColumn = () => { throw new Error("Must not recreate"); };
  await ensureLedgerSchema(tables, "midas");
  await assert.rejects(ensureLedgerSchema({ getColumn: async () => { throw { code: 403 }; } }, "midas"), error => error.code === 403);
});

test("sync route preserves manual rows, skips repeat imports, and scopes duplicates to the selected tab", async () => {
  const { setContext } = await import("midas-test:auth");
  const { POST } = await import("../app/api/spreadsheet/route.ts");
  const tables = new MemoryTables();
  setContext({ user: { id: "u1" }, tables });
  const mapping = { date: "Fecha", description: "Nombre", income: "Ingreso", expense: "Gasto", category: "Categoria" };
  await tables.createRow({ tableId: T.categories, rowId: "category", data: { user_id: "u1", name: "Prueba" } });
  await add(tables, "manual-match", "manual", "2026-08-28");
  await tables.updateRow({ tableId: T.transactions, rowId: "manual-match", data: { description: "Compra", amount: 4, category_id: "category" } });
  const sourceUrl = "https://docs.google.com/spreadsheets/d/book/edit?sheet=Set%2026";
  await tables.createRow({ tableId: T.sources, rowId: "source", data: {
    user_id: "u1", source_name: "Google Spreadsheet book · Set 26", source_url: sourceUrl, column_mapping: JSON.stringify(mapping),
  } });
  let csv = "Fecha,Nombre,Ingreso,Gasto,Categoria\n28/08/26,Compra,,4,Prueba\n28/08/26,Compra,,4,Prueba\n28/08/26,Ingreso,100,,Prueba";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.match(String(url), /sheet=(?:Set|Oct)%2026/);
    return new Response(csv, { headers: { "content-type": "text/csv" } });
  };
  const sync = async () => {
    const response = await POST(new Request("https://midas.test/api/spreadsheet", { method: "POST", body: JSON.stringify({ action: "sync" }) }));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.failed, 0, JSON.stringify(body.errors));
    return body;
  };
  try {
    assert.equal((await sync()).inserted, 3);
    assert.equal((await sync()).ignored, 3);
    let rows = (await tables.listRows({ tableId: T.transactions })).rows;
    assert.equal(rows.length, 4);
    assert.equal(rows.filter(row => row.source_type === "manual").length, 1);
    assert.equal(new Set(rows.map(row => row.midas_code)).size, 4);
    await tables.updateRow({ tableId: T.sources, rowId: "source", data: { source_url: sourceUrl.replace("Set", "Oct"), source_name: "Google Spreadsheet book · Oct 26" } });
    assert.equal((await sync()).inserted, 3);
    await tables.updateRow({ tableId: T.sources, rowId: "source", data: { source_url: sourceUrl, source_name: "Google Spreadsheet book · Set 26" } });
    csv = "Fecha,Nombre,Ingreso,Gasto,Categoria\n28/08/26,Ingreso,100,,Prueba\n28/08/26,Compra,,4,Prueba\n28/08/26,Compra,,4,Prueba\n28/08/26,Taxi,,20,Prueba";
    const result = await sync();
    assert.equal(result.inserted, 1);
    assert.equal(result.ignored, 3);
    rows = (await tables.listRows({ tableId: T.transactions })).rows;
    assert.equal(rows.length, 8);
    assert.equal(new Set(rows.map(row => row.midas_code)).size, 8);
  } finally { globalThis.fetch = originalFetch; }
});
