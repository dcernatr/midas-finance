import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { normalizeDate, parseSignedAmount, parseMappedRow, validateMapping, suggestMapping, sheetHeaders, rowObject } from "../lib/spreadsheet.ts";
import { sourceScope, movementFingerprint, importIdentity, nextOccurrence, formatCode } from "../lib/ledger.ts";

const headers = ["Fecha", "Nombre", "Ingreso", "Gasto", "Categoría"];
const mapping = validateMapping(suggestMapping(headers), headers);
const row = { Fecha: "28/08/26", Nombre: "Compra", Ingreso: "", Gasto: "-S/.4.00", Categoría: "Libre" };

test("maps exactly the five fields and never asks for a sheet ID", () => {
  assert.deepEqual(Object.keys(suggestMapping(headers)), ["date", "description", "category", "income", "expense"]);
  assert.equal(mapping.description, "Nombre");
  assert.throws(() => validateMapping({ source_id: "ID", date: "Fecha", description: "Nombre", amount: "Monto" }));
  assert.throws(() => validateMapping({ ...mapping, income: "Gasto" }));
  assert.throws(() => validateMapping(mapping, ["Fecha"]));
});

test("allows a sheet without an income column, but requires date, name and category", () => {
  const single = validateMapping({ date: "Fecha", description: "Nombre", category: "Categoría", expense: "Gasto" });
  assert.equal(parseMappedRow(row, single).amount, 4);
  assert.throws(() => validateMapping({ ...single, category: undefined }));
  assert.throws(() => validateMapping({ ...single, expense: undefined }));
});

test("parses the short dates and signed Peruvian currency in the screenshot", () => {
  assert.equal(normalizeDate("28/08/26"), "2026-08-28");
  assert.throws(() => normalizeDate("31/02/26"));
  assert.equal(parseSignedAmount("-S/.4.00"), -4);
  assert.equal(parseSignedAmount("S/.14,795.33"), 14795.33);
  assert.equal(parseSignedAmount("S/ 1.500,50"), 1500.5);
  assert.equal(parseSignedAmount("(S/ 20,00)"), -20);
  for (const value of ["NaN", "1e9", "12.3456", "1.2.3", "foo"]) assert.throws(() => parseSignedAmount(value));
});

test("separates income and expense and rejects ambiguous or empty rows", () => {
  assert.equal(parseMappedRow(row, mapping).type, "expense");
  assert.equal(parseMappedRow({ ...row, Gasto: "", Ingreso: "1500" }, mapping).type, "income");
  assert.throws(() => parseMappedRow({ ...row, Ingreso: "1500" }, mapping));
  assert.throws(() => parseMappedRow({ ...row, Gasto: "0" }, mapping));
  assert.throws(() => parseMappedRow({ ...row, Nombre: "" }, mapping));
  assert.throws(() => parseMappedRow({ ...row, Categoría: "" }, mapping));
  assert.throws(() => parseMappedRow({ ...row, Gasto: "", Ingreso: "-20" }, mapping));
});

test("explicit signed mode handles one mixed column without guessing from the name", () => {
  const signed = validateMapping({ ...mapping, income: undefined, signed: true });
  assert.equal(parseMappedRow(row, signed).type, "expense");
  assert.equal(parseMappedRow({ ...row, Gasto: "S/.14,795.33" }, signed).type, "income");
  assert.throws(() => validateMapping({ ...mapping, signed: true }));
});

test("filters empty headers while preserving positions and disambiguating repeated headers", () => {
  const h = sheetHeaders(["Fecha", "Nombre", "Gastos", "Categoria", "", "", "Nombre"]);
  assert.deepEqual(h.filter(Boolean), ["Fecha", "Nombre", "Gastos", "Categoria", "Nombre (2)"]);
  assert.deepEqual(rowObject(h, ["28/08/26", "Compra", "-4", "Libre", "ignored", "ignored", "Extra"]),
    { Fecha: "28/08/26", Nombre: "Compra", Gastos: "-4", Categoria: "Libre", "Nombre (2)": "Extra" });
});

const source = "https://docs.google.com/spreadsheets/d/book/edit?sheet=Set%2026";
const scope = sourceScope(source);
const movement = parseMappedRow(row, mapping);

test("deduplication distinguishes workbook, tab and user but ignores sharing parameters", () => {
  assert.equal(sourceScope(source + "&usp=drivesdk"), scope);
  assert.notEqual(sourceScope(source.replace("Set%2026", "Oct%2026")), scope);
  assert.notEqual(sourceScope(source.replace("/book/", "/other/")), scope);
  assert.notEqual(sourceScope(source.replace("/book/", "/e/published1/")), sourceScope(source.replace("/book/", "/e/published2/")));
  assert.throws(() => sourceScope(source.split("?")[0]));
  const fp = movementFingerprint(movement);
  assert.notEqual(importIdentity("u1", scope, fp, 1).rowId, importIdentity("u2", scope, fp, 1).rowId);
});

test("reordering and repeated syncs preserve identity, including identical legitimate rows", () => {
  const second = { ...movement, description: "Taxi", amount: 20 };
  const keys = movements => {
    const counts = new Map();
    return movements.map(item => { const fp = movementFingerprint(item); return importIdentity("u", scope, fp, nextOccurrence(counts, fp)).sourceId; });
  };
  const initial = keys([movement, movement, second]);
  assert.equal(new Set(initial).size, 3);
  assert.deepEqual(new Set(keys([second, movement, movement])), new Set(initial));
  assert.equal(keys([movement, movement, movement, second]).filter(key => !initial.includes(key)).length, 1);
  assert.equal(movementFingerprint({ ...movement, description: "  COMPRA  " }), movementFingerprint(movement));
});

test("codes use YY-MM-G/I-sequence and do not truncate after 999", () => {
  assert.equal(formatCode("2026-09-02", "expense", 1), "26-09-G-001");
  assert.equal(formatCode("2026-09-02", "income", 12), "26-09-I-012");
  assert.equal(formatCode("2026-09-02", "debt_payment", 3), "26-09-G-003");
  assert.equal(formatCode("2026-10-01", "expense", 1000), "26-10-G-1000");
  assert.throws(() => formatCode("2026-02-31", "expense", 1));
});

test("manual and imported entries remain together and export generated codes and origins", async () => {
  const state = await readFile(new URL("../app/api/state/route.ts", import.meta.url), "utf8");
  const sync = await readFile(new URL("../app/api/spreadsheet/route.ts", import.meta.url), "utf8");
  const ui = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(state, /listAllRows\(tables, APPWRITE_TABLES.transactions/);
  assert.match(sync, /sourceScope\(source.sourceUrl\)/);
  assert.match(sync, /Query.equal\("source_type", "spreadsheet"\)/);
  assert.doesNotMatch(sync, /deleteRow/);
  assert.match(ui, /t.code/);
  assert.match(ui, /"codigo", "origen", "fuente"/);
});
