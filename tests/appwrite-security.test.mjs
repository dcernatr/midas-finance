import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const setupUrl = new URL("../scripts/setup-appwrite.mjs", import.meta.url);

test("defines nine isolated base tables plus a private MIDAS code sequence", async () => {
  const source = await readFile(setupUrl, "utf8");
  const tables = [
    "midas_users", "midas_financial_months", "midas_categories", "midas_debts",
    "midas_transactions", "midas_spreadsheet_sources", "midas_spreadsheet_sync_logs",
    "midas_activity_logs", "midas_system_settings",
  ];
  for (const table of tables) assert.match(source, new RegExp(`id: "${table}"`));
  assert.match(source, /permissions: \[\], rowSecurity: false/);
  assert.doesNotMatch(source, /terran|pomoboxing/i);
  const migration = await readFile(new URL("../scripts/ledger-schema.mjs", import.meta.url), "utf8");
  assert.match(source, /ensureLedgerSchema\(tables, databaseId\)/);
  assert.match(migration, /tableId: "midas_transaction_sequences"/);
  assert.match(migration, /permissions: \[\], rowSecurity: false/);
});

test("keeps Neon database credentials server-only and delegates cookies to Neon Auth", async () => {
  const files = [
    "../lib/postgres/pool.ts", "../lib/neon-auth.ts", "../lib/auth-diagnostics.ts", "../lib/auth.ts", "../app/api/auth/session/route.ts",
    "../app/api/state/route.ts", "../app/api/admin/route.ts", "../app/api/spreadsheet/route.ts",
  ];
  const source = (await Promise.all(files.map(file => readFile(new URL(file, import.meta.url), "utf8")))).join("\n");
  assert.match(source, /process\.env\.DATABASE_URL/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_DATABASE_URL|APPWRITE_API_KEY/);
  assert.match(source, /createNeonAuth/);
  assert.match(source, /NEON_AUTH_COOKIE_SECRET/);
  assert.match(source, /identity\.emailVerified/);
  assert.match(source, /MIDAS_ADMIN_EMAIL/);
});

test("scopes financial operations to the authenticated user", async () => {
  const state = await readFile(new URL("../app/api/state/route.ts", import.meta.url), "utf8");
  const spreadsheet = await readFile(new URL("../app/api/spreadsheet/route.ts", import.meta.url), "utf8");
  assert.match(state, /Query\.equal\("user_id", user\.id\)/);
  assert.match(state, /row\.user_id !== user\.id/);
  assert.match(spreadsheet, /Query\.equal\("user_id", user\.id\)/);
  assert.match(state, /createTransaction\(\)/);
  assert.match(state, /rollback: true/);
});

test("uses PostgreSQL and Neon Auth without Supabase", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  for (const name of ["@supabase/ssr", "@supabase/supabase-js", "supabase"]) {
    assert.equal(dependencies[name], undefined);
  }
  for (const name of ["drizzle-orm", "drizzle-kit", "pg", "@neondatabase/auth"]) assert.ok(dependencies[name]);
  assert.equal(packageJson.scripts.prebuild, undefined, "build must never mutate Appwrite or Neon");
});
