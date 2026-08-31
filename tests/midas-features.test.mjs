import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  normalizeAmount,
  normalizeDate,
  parseCsv,
  parseWorkbookSheetNames,
  toPublishedCsvUrls,
  withSpreadsheetSheet,
} from "../lib/spreadsheet.ts";

test("accepts Drive SDK Spreadsheet links without a gid", () => {
  const urls = toPublishedCsvUrls(
    "https://docs.google.com/spreadsheets/d/1gPD6U1mnxQpYxZYHi1HgmqqzQU8qVDFO/edit?usp=drivesdk&ouid=111105228673320607260&rtpof=true&sd=true",
  );
  assert.deepEqual(urls, [
    "https://docs.google.com/spreadsheets/d/1gPD6U1mnxQpYxZYHi1HgmqqzQU8qVDFO/gviz/tq?tqx=out:csv",
    "https://docs.google.com/spreadsheets/d/1gPD6U1mnxQpYxZYHi1HgmqqzQU8qVDFO/export?format=csv&gid=0",
  ]);
});

test("selects a named tab and uses it for CSV queries", () => {
  const selected = withSpreadsheetSheet(
    "https://docs.google.com/spreadsheets/d/abc123/edit?usp=drivesdk#gid=42",
    "Gastos Agosto",
  );
  assert.equal(selected, "https://docs.google.com/spreadsheets/d/abc123/edit?sheet=Gastos%20Agosto");
  assert.deepEqual(toPublishedCsvUrls(selected), [
    "https://docs.google.com/spreadsheets/d/abc123/gviz/tq?tqx=out:csv&sheet=Gastos%20Agosto",
  ]);
});

test("extracts only visible tab names from an XLSX workbook", () => {
  const xml = `<?xml version="1.0"?><workbook><sheets>
    <sheet name="Gastos &amp; pagos" sheetId="1" state="visible" r:id="rId1"/>
    <sheet name="Oculta" sheetId="2" state="hidden" r:id="rId2"/>
    <sheet name="Resumen" sheetId="3" r:id="rId3"/>
  </sheets></workbook>`;
  assert.deepEqual(parseWorkbookSheetNames(xml), ["Gastos & pagos", "Resumen"]);
});

test("normalizes imported dates, amounts, and quoted CSV", () => {
  assert.equal(normalizeDate("30/08/2026"), "2026-08-30");
  assert.equal(normalizeAmount("S/ 1.500,50"), 1500.5);
  assert.deepEqual(parseCsv('ID,Descripción,Monto\n1,"Comida, oficina","45,50"'), [
    ["ID", "Descripción", "Monto"],
    ["1", "Comida, oficina", "45,50"],
  ]);
});

test("keeps program and category editing controls", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(source, /Editar gasto programado/);
  assert.match(source, /openCategory\(row\)/);
  assert.match(source, /type="color"/);
  assert.match(source, /Cerrar sesión/);
});
