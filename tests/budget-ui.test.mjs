import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const root = fileURLToPath(new URL("../", import.meta.url));
registerHooks({ resolve(specifier, context, next) {
  let path;
  if (specifier.startsWith("@/")) path = root + specifier.slice(2);
  else if (specifier.startsWith(".") && /\.tsx?$/.test(context.parentURL || "")) path = fileURLToPath(new URL(specifier, context.parentURL));
  if (path && !/\.[a-z]+$/i.test(path)) {
    const found = [path + ".ts", path + ".tsx"].find(existsSync);
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
  }
  return next(specifier, context);
}, load(url, context, next) {
  if (/\.tsx?$/.test(url)) return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }, fileName: fileURLToPath(url),
  }).outputText };
  return next(url, context);
} });
const { SpreadsheetMapping } = await import("../components/spreadsheet-mapping.tsx");
const { BudgetPeriodSettings } = await import("../components/budget-period-settings.tsx");
const { emptyProfile, periodWindow } = await import("../lib/budgeting.ts");
const categories = [{ id: "food", name: "Alimentación", budget: 1000, color: "#54C7A0", archived: false }];
const profile = emptyProfile(categories, "2026-09");
profile.starts["2026-09"] = "2026-08-28";
profile.budgets["2026-09"] = { food: 1000 };

test("rendered preview includes expense category choices but no income classification selector", () => {
  const html = renderToStaticMarkup(React.createElement(SpreadsheetMapping, {
    headers: ["Fecha", "Nombre", "Gasto", "Categoría"],
    mapping: { date: "Fecha", description: "Nombre", expense: "Gasto", category: "Categoría" }, onChange() {},
    preview: [{ Fecha: "28/08/26", Nombre: "Sueldo", Gasto: "1000", Categoría: "Ingreso" }, { Fecha: "28/08/26", Nombre: "Almuerzo", Gasto: "10", Categoría: "Comidas" }],
    budgetContext: { profile, categories, sourceUrl: "https://docs.google.com/spreadsheets/d/book/edit?sheet=Set", scope: "a".repeat(32), theme: "dark", onSave: async () => true },
  }));
  assert.match(html, /Agregar actual: Comidas/);
  assert.match(html, /Agregar nueva/);
  assert.match(html, /Programadas · 2026-09/);
  assert.match(html, /Pendiente de vincular/);
  assert.match(html, /<td>1000.00<\/td><td>—<\/td><td>Ingreso<\/td>/);
  assert.doesNotMatch(html, /Categoría de Ingreso|type="checkbox"/);
});

test("rendered period settings expose salary boundaries, uncertainty and confirmed initial plan action", () => {
  const html = renderToStaticMarkup(React.createElement(BudgetPeriodSettings, { profile, period: periodWindow("2026-09", profile.starts), transactions: [], disabled: false, theme: "light", onSave: async () => true }));
  assert.match(html, /2026-08-28/);
  assert.match(html, /Inicio confirmado/);
  assert.match(html, /Fin estimado/);
  assert.match(html, /no incluye feriados/);
  assert.match(html, /13,530/);
});
