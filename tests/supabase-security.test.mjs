import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260830174317_initial_midas_shared_terran.sql",
  import.meta.url,
);
const dataApiMigrationUrl = new URL(
  "../supabase/migrations/20260830181525_data_api_backend.sql",
  import.meta.url,
);

test("enables RLS on every exposed MIDAS table", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const tables = [
    "users", "financial_months", "categories", "debts", "transactions",
    "spreadsheet_sources", "spreadsheet_sync_logs", "activity_logs", "system_settings",
  ];
  for (const table of tables) {
    assert.match(sql, new RegExp(`alter table public\\.midas_${table} enable row level security;`));
  }
  assert.doesNotMatch(sql, /revoke all on all tables in schema public/i);
  assert.match(sql, /revoke all on table\s+public\.midas_users,/);
});

test("scopes user-owned rows and protects admin lookup", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /user_id = \(select auth\.uid\(\)\)/);
  assert.match(sql, /create or replace function midas_private\.is_admin\(\)/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /revoke all on function midas_private\.is_admin\(\) from public, anon;/);
  assert.doesNotMatch(sql, /auth\.role\(\)/);
});

test("namespaces every MIDAS database object away from TERRAN", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.doesNotMatch(sql, /create table public\.(?!midas_)/i);
  assert.doesNotMatch(sql, /\b(?:alter|drop|truncate) table public\.(?!midas_)/i);
  assert.doesNotMatch(sql, /\b(?:insert into|update|delete from) public\.(?!midas_)/i);
});

test("exposes only authenticated MIDAS RPC operations", async () => {
  const sql = await readFile(dataApiMigrationUrl, "utf8");
  assert.match(sql, /midas_register_current_user[\s\S]+security definer[\s\S]+set search_path = ''/i);
  assert.match(sql, /revoke all on function public\.midas_register_current_user\(text\) from public, anon;/i);
  assert.match(sql, /grant execute on function public\.midas_register_current_user\(text\) to authenticated;/i);
  assert.match(sql, /midas_record_debt_payment[\s\S]+security invoker/i);
  assert.match(sql, /midas_delete_transaction[\s\S]+security invoker/i);
  assert.doesNotMatch(sql, /service_role|database_url|postgres(?:ql)?:\/\//i);
});

test("uses the Supabase Data API without a database password", async () => {
  const files = [
    "../lib/auth.ts",
    "../app/api/state/route.ts",
    "../app/api/admin/route.ts",
    "../app/api/spreadsheet/route.ts",
  ];
  const source = (await Promise.all(files.map(file => readFile(new URL(file, import.meta.url), "utf8")))).join("\n");
  assert.match(source, /supabase\.from\(|supabase\.rpc\(/);
  assert.doesNotMatch(source, /getDb|SUPABASE_DB_URL|POSTGRES_URL|service_role/i);
});
