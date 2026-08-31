import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const setupUrl = new URL("../scripts/setup-appwrite.mjs", import.meta.url);

test("defines an isolated nine-table MIDAS database", async () => {
  const source = await readFile(setupUrl, "utf8");
  const tables = [
    "midas_users", "midas_financial_months", "midas_categories", "midas_debts",
    "midas_transactions", "midas_spreadsheet_sources", "midas_spreadsheet_sync_logs",
    "midas_activity_logs", "midas_system_settings",
  ];
  for (const table of tables) assert.match(source, new RegExp(`id: "${table}"`));
  assert.match(source, /permissions: \[\], rowSecurity: false/);
  assert.doesNotMatch(source, /terran|pomoboxing/i);
});

test("keeps the Appwrite key server-only", async () => {
  const files = [
    "../lib/appwrite/server.ts", "../lib/auth.ts", "../app/api/auth/session/route.ts",
    "../app/api/state/route.ts", "../app/api/admin/route.ts", "../app/api/spreadsheet/route.ts",
  ];
  const source = (await Promise.all(files.map(file => readFile(new URL(file, import.meta.url), "utf8")))).join("\n");
  assert.match(source, /process\.env\.APPWRITE_API_KEY/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_APPWRITE_API_KEY/);
  assert.match(source, /httpOnly: true/);
  assert.match(source, /sameSite: "strict"/);
});

test("scopes financial operations to the authenticated Appwrite user", async () => {
  const state = await readFile(new URL("../app/api/state/route.ts", import.meta.url), "utf8");
  const spreadsheet = await readFile(new URL("../app/api/spreadsheet/route.ts", import.meta.url), "utf8");
  assert.match(state, /Query\.equal\("user_id", user\.id\)/);
  assert.match(state, /row\.user_id !== user\.id/);
  assert.match(spreadsheet, /Query\.equal\("user_id", user\.id\)/);
  assert.match(state, /createTransaction\(\)/);
  assert.match(state, /rollback: true/);
});

test("contains no runtime dependency on Supabase or direct PostgreSQL", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  for (const name of ["@supabase/ssr", "@supabase/supabase-js", "supabase", "drizzle-orm", "drizzle-kit", "postgres"]) {
    assert.equal(dependencies[name], undefined);
  }
});
