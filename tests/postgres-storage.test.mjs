import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { registerHooks } from "node:module";
import { PGlite } from "@electric-sql/pglite";

registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.endsWith(".ts") && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
} });
const { MidasTables, TABLES: T, Query, listAllRows } = await import("../lib/postgres/server.ts");
const { withMovementCode } = await import("../lib/ledger-store.ts");

async function setup(t) {
  // Embedded PostgreSQL only: these tests never open a network connection.
  const db = new PGlite();
  t.after(() => db.close());
  for (const file of (await readdir(new URL("../drizzle-neon/", import.meta.url))).filter(f => f.endsWith(".sql")).sort()) {
    await db.exec(await readFile(new URL("../drizzle-neon/" + file, import.meta.url), "utf8"));
  }
  const client = { query: (sql, values) => db.query(sql, values), release() {} };
  const pool = { query: client.query, connect: async () => client };
  return { db, alice: new MidasTables("alice", false, pool), bob: new MidasTables("bob", false, pool), admin: new MidasTables("admin", true, pool) };
}
const category = (tables, id, user = "alice") => tables.createRow({ tableId: T.categories, rowId: id, data: { user_id: user, name: id, budget: 0 } });

test("PostgreSQL isolates read/list/update/delete by owner, including unfiltered queries", async t => {
  const { alice, bob } = await setup(t);
  await category(alice, "food");
  for (const fn of [() => bob.getRow({ tableId: T.categories, rowId: "food" }), () => bob.updateRow({ tableId: T.categories, rowId: "food", data: { budget: 9 } }), () => bob.deleteRow({ tableId: T.categories, rowId: "food" })]) await assert.rejects(fn, e => e.code === 404);
  assert.deepEqual((await bob.listRows({ tableId: T.categories })).rows, []);
  await assert.rejects(() => category(bob, "stolen", "alice"), e => e.code === 403);
  await assert.rejects(() => alice.updateRow({ tableId: T.categories, rowId: "food", data: { user_id: "bob" } }), e => e.code === 400);
  assert.equal((await alice.getRow({ tableId: T.categories, rowId: "food" })).budget, 0);
});

test("PostgreSQL transactions roll back numbering and recover from expected duplicate errors", async t => {
  const { alice } = await setup(t);
  const save = (id, source) => withMovementCode(alice, "alice", "2026-09-03", "expense", (code, transactionId) => alice.createRow({ tableId: T.transactions, rowId: id, transactionId, data: { user_id: "alice", midas_code: code, source_type: source } }));
  assert.equal((await save("manual", "manual")).midas_code, "26-09-G-001");
  await assert.rejects(() => withMovementCode(alice, "alice", "2026-09-03", "expense", () => { throw new Error("cancelled"); }), /cancelled/);
  assert.equal((await save("sheet", "spreadsheet")).midas_code, "26-09-G-002");
  const tx = await alice.createTransaction();
  await assert.rejects(() => alice.createRow({ tableId: T.transactions, rowId: "manual", transactionId: tx.$id, data: { user_id: "alice" } }), e => e.code === 409);
  await alice.updateRow({ tableId: T.transactions, rowId: "manual", transactionId: tx.$id, data: { description: "saved after conflict" } });
  await alice.updateTransaction({ transactionId: tx.$id, commit: true });
  assert.equal((await alice.getRow({ tableId: T.transactions, rowId: "manual" })).description, "saved after conflict");
});

test("PostgreSQL pagination uses stable ties and parameterized filters", async t => {
  const { alice, bob } = await setup(t);
  for (let i = 0; i < 205; i++) await alice.createRow({ tableId: T.transactions, rowId: String(i).padStart(3, "0"), data: { user_id: "alice", date: i % 2 ? "2026-09-03" : "2026-09-02" } });
  await bob.createRow({ tableId: T.transactions, rowId: "foreign", data: { user_id: "bob", date: "2026-09-04" } });
  const rows = await listAllRows(alice, T.transactions, [Query.orderDesc("date")]);
  assert.equal(rows.length, 205);
  assert.equal(new Set(rows.map(r => r.$id)).size, 205);
  assert.equal(rows[0].date, "2026-09-03");
  assert.deepEqual((await alice.listRows({ tableId: T.transactions, queries: [Query.equal("date", "' OR TRUE --")] })).rows, []);
  await assert.rejects(() => alice.listRows({ tableId: T.transactions, queries: [Query.equal("date'); DROP TABLE records;--", "x")] }), e => e.code === 400);
});

test("PostgreSQL enforces unique codes and global settings are admin-only writes", async t => {
  const { alice, admin, db } = await setup(t);
  await assert.rejects(() => alice.upsertRow({ tableId: T.settings, rowId: "mode", data: { value: "true" } }), e => e.code === 403);
  await admin.upsertRow({ tableId: T.settings, rowId: "mode", data: { setting_key: "mode", value: "false" } });
  await admin.upsertRow({ tableId: T.settings, rowId: "mode", data: { value: "true" } });
  assert.equal((await alice.getRow({ tableId: T.settings, rowId: "mode" })).value, "true");
  const data = { user_id: "alice", midas_code: "26-09-G-001" };
  await alice.createRow({ tableId: T.transactions, rowId: "one", data });
  await assert.rejects(() => alice.createRow({ tableId: T.transactions, rowId: "two", data }), e => e.code === 409);
  assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='midas_private.records'::regclass")).rows[0].relrowsecurity, true);
});
