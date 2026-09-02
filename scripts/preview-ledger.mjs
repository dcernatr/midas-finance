// Local-only visual fixture. No authentication, production APIs or financial data.
// Build first, then run: node scripts/preview-ledger.mjs
import http from "node:http";
import { registerHooks } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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
const { ExpenseLedger } = await import("../components/expense-ledger.tsx");
const { emptyProfile } = await import("../lib/budgeting.ts");
const categories = [{ id: "food", name: "Alimentación de ejemplo", budget: 800, color: "#54C7A0", archived: false }];
const profile = emptyProfile(categories, "2026-09");
const rows = Array.from({ length: 30 }, (_, n) => ({ id: "t" + n, date: "2026-09-02", description: n === 1 ? "Compra de ejemplo con un nombre suficientemente largo para probar el ajuste de texto y la altura de fila" : n === 0 ? "Ingreso de ejemplo" : "Movimiento de prueba " + n, amount: n === 0 ? 12345.67 : 12.34, type: n === 0 ? "income" : "expense", code: "26-09-G-" + n, categoryId: n === 2 ? null : "food", sourceCategory: n === 2 ? "Categoría sin equivalencia" : "Alimentación de ejemplo", periodKey: "2026-09", sourceType: n % 2 ? "spreadsheet" : "manual", sourceName: n % 2 ? "Hoja de prueba · Pestaña de ejemplo" : null, sourceId: null, debtId: null, categoryPending: n === 2 }));
const cssRoot = root + ".next/static/chunks/";
const css = readdirSync(cssRoot).filter(f => f.endsWith(".css")).map(f => readFileSync(cssRoot + f, "utf8")).join("\n");
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost:4186");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (url.pathname === "/") {
    const narrow = url.searchParams.get("size") === "mobile";
    const light = url.searchParams.get("theme") === "light";
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>MIDAS · revisión local</title></head><body style="margin:0;background:#222;color:white;font:14px sans-serif"><nav style="padding:12px"><a style="color:white" href="/?size=desktop&theme=dark">Escritorio oscuro</a> · <a style="color:white" href="/?size=desktop&theme=light">Escritorio claro</a> · <a style="color:white" href="/?size=mobile&theme=dark">Móvil oscuro</a> · <a style="color:white" href="/?size=mobile&theme=light">Móvil claro</a></nav><iframe title="Gastos efectivos de prueba" style="border:0;width:${narrow ? "375px" : "100%"};height:950px" src="/fixture?theme=${light ? "light" : "dark"}"></iframe></body></html>`);
  } else if (url.pathname === "/fixture") {
    const theme = url.searchParams.get("theme") === "light" ? "light" : "dark";
    const html = renderToStaticMarkup(React.createElement(ExpenseLedger, { rows, categories, profile, debts: [], disabled: false, theme, onSave: async () => false, onEdit() {}, onDelete() {} }));
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><main class="midas-app ${theme}" style="padding:16px"><h1>Gastos efectivos · Datos ficticios</h1><p>Vista visual sin conexión ni guardado. Solo Detalles funciona sin hidratación.</p><section class="panel ledger-panel">${html}</section></main></body></html>`);
  } else { res.statusCode = 404; res.end("Not found"); }
});
server.listen(4186, "0.0.0.0", () => console.log("MIDAS visual fixture: http://localhost:4186"));
